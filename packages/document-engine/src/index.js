import { createHash, randomUUID } from "node:crypto";

const DEFAULT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeFileName(value) {
  const name = String(value || "file").normalize("NFKC").replace(/[\\/\0-\x1f\x7f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 180);
  return name && ![".", ".."].includes(name) ? name : "file";
}

export function validateAttachment(input, options = {}) {
  const maximumBytes = options.maximumBytes || 10 * 1024 * 1024;
  const allowedTypes = new Set(options.allowedTypes || DEFAULT_TYPES);
  const sizeBytes = Number(input?.sizeBytes);
  const mimeType = String(input?.mimeType || "").toLowerCase();
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maximumBytes) throw new RangeError(`Attachment size must be between 1 and ${maximumBytes} bytes.`);
  if (!allowedTypes.has(mimeType)) throw new TypeError("Attachment type is not allowed.");
  return Object.freeze({ fileName: sanitizeFileName(input.fileName), mimeType, sizeBytes });
}

export function attachmentStorageKey({ organizationId, attachmentId = randomUUID(), fileName }) {
  if (!UUID.test(String(organizationId)) || !UUID.test(String(attachmentId))) throw new TypeError("Valid organization and attachment identifiers are required.");
  const extension = sanitizeFileName(fileName).split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return `organizations/${organizationId}/attachments/${attachmentId}${extension ? `.${extension}` : ""}`;
}

export function sha256(content) { return createHash("sha256").update(content).digest("hex"); }

export function assertAttachmentTransition(current, next) {
  const transitions = { pending: ["uploaded", "archived"], uploaded: ["quarantined", "clean", "rejected", "archived"], quarantined: ["clean", "rejected", "archived"], clean: ["archived"], rejected: ["archived"], archived: [] };
  if (!(transitions[current] || []).includes(next)) throw new RangeError(`Attachment transition from ${current} to ${next} is not allowed.`);
  return next;
}

// ------------------------------------------------------------ Object storage
//
// PostgreSQL stores file metadata; bytes live behind this contract. Keys are
// opaque internal identifiers, never public URLs: every download goes through
// the application's authorization first. The production provider (S3-style)
// is selected in Prompt 6; it implements the same four methods.
const STORAGE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,400}$/i;

export function assertStorageKey(key) {
  const value = String(key || "");
  if (!STORAGE_KEY.test(value) || value.includes("..") || value.includes("//")) throw new TypeError("Invalid storage key.");
  return value;
}

export function defineObjectStorage(adapter) {
  for (const method of ["put", "get", "remove", "head"]) if (typeof adapter?.[method] !== "function") throw new TypeError(`Object storage must implement ${method}.`);
  if (!adapter.name) throw new TypeError("Object storage must have a name.");
  return Object.freeze({
    name: adapter.name,
    // Always asynchronous: an invalid key is a rejected promise, never a sync throw.
    put: async (key, bytes, options = {}) => adapter.put(assertStorageKey(key), Buffer.from(bytes), options),
    get: async (key) => adapter.get(assertStorageKey(key)),
    remove: async (key) => adapter.remove(assertStorageKey(key)),
    head: async (key) => adapter.head(assertStorageKey(key)),
  });
}

// Tests and single-process tools only (bytes vanish with the process).
export function createMemoryObjectStorage() {
  const objects = new Map();
  return defineObjectStorage({
    name: "memory",
    async put(key, bytes, { contentType = "application/octet-stream" } = {}) {
      objects.set(key, { bytes: Buffer.from(bytes), contentType });
      return { key, size: bytes.length };
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error("Object not found."), { code: "OBJECT_NOT_FOUND" });
      return Buffer.from(object.bytes);
    },
    async remove(key) {
      objects.delete(key);
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { size: object.bytes.length, contentType: object.contentType } : null;
    },
  });
}

// Local development: files under one root directory shared by the web app and
// the worker on the same machine. Never used in production.
export async function createLocalObjectStorage({ root }) {
  const { mkdir, readFile, rm, stat, writeFile, rename } = await import("node:fs/promises");
  const path = await import("node:path");
  const base = path.resolve(String(root || ""));
  if (!root) throw new TypeError("A local storage root is required.");
  const resolve = (key) => {
    const target = path.resolve(base, key);
    if (!target.startsWith(base + path.sep)) throw new TypeError("Invalid storage key.");
    return target;
  };
  return defineObjectStorage({
    name: "local",
    async put(key, bytes) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.partial`;
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
      return { key, size: bytes.length };
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch (error) {
        if (error?.code === "ENOENT") throw Object.assign(new Error("Object not found."), { code: "OBJECT_NOT_FOUND" });
        throw error;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
    async head(key) {
      try {
        const info = await stat(resolve(key));
        return { size: info.size, contentType: null };
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
  });
}
