// Google Cloud Storage adapter (production). Credentials come from
// Application Default Credentials: GKE Workload Identity maps the pod's
// Kubernetes service account to a Google service account, so no JSON key
// exists anywhere. The bucket is private (uniform bucket-level access, public
// access prevention enforced); objects are never made public and no signed or
// public URL is generated: every read goes through the application's
// authorization and is streamed by the server.
import { defineObjectStorage, STORAGE_PROBE_KEY } from "./index.js";

const notFound = () => Object.assign(new Error("Object not found."), { code: "OBJECT_NOT_FOUND" });
const isNotFound = (error) => error?.code === 404 || error?.code === "404";

// apiEndpoint: an explicit Cloud Storage endpoint (private/restricted Google
// API endpoints in production; a local stand-in in tests). Unset = the
// default public endpoint.
export async function createGcsObjectStorage({ bucket, prefix = "", projectId, apiEndpoint, client } = {}) {
  if (!bucket) throw new TypeError("A Cloud Storage bucket is required.");
  const normalizedPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  if (normalizedPrefix && (!/^[A-Za-z0-9/_-]+$/.test(normalizedPrefix) || normalizedPrefix.includes("//"))) throw new TypeError("Invalid storage prefix.");
  const options = { ...(projectId ? { projectId } : {}), ...(apiEndpoint ? { apiEndpoint } : {}) };
  const storage = client ?? new (await import("@google-cloud/storage")).Storage(options);
  const target = storage.bucket(bucket);
  const objectName = (key) => (normalizedPrefix ? `${normalizedPrefix}/${key}` : key);

  return defineObjectStorage({
    name: "gcs",
    async put(key, bytes, { contentType = "application/octet-stream", sha256 = null } = {}) {
      await target.file(objectName(key)).save(bytes, {
        resumable: false,
        validation: "crc32c",
        contentType,
        metadata: { cacheControl: "private, no-store", metadata: sha256 ? { sha256 } : {} },
      });
      return { key, size: bytes.length };
    },
    async get(key) {
      try {
        const [data] = await target.file(objectName(key)).download({ validation: "crc32c" });
        return data;
      } catch (error) {
        if (isNotFound(error)) throw notFound();
        throw error;
      }
    },
    async remove(key) {
      await target.file(objectName(key)).delete({ ignoreNotFound: true });
    },
    async head(key) {
      try {
        const [metadata] = await target.file(objectName(key)).getMetadata();
        return { size: Number(metadata.size), contentType: metadata.contentType ?? null, sha256: metadata.metadata?.sha256 ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    // Object-level metadata read on a sentinel: proves the bucket is reachable
    // and the runtime identity is authorized without needing bucket-admin rights.
    async probe() {
      try {
        await target.file(objectName(STORAGE_PROBE_KEY)).getMetadata();
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return true;
    },
  });
}
