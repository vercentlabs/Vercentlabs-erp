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

export function createStorageAdapter(adapter) {
  for (const method of ["createUpload", "createDownload", "remove"]) if (typeof adapter?.[method] !== "function") throw new TypeError(`Storage adapter must implement ${method}.`);
  return Object.freeze({ createUpload: (...args) => adapter.createUpload(...args), createDownload: (...args) => adapter.createDownload(...args), remove: (...args) => adapter.remove(...args) });
}
