// Selects the object store for this process from trusted configuration.
//
//   FILE_STORAGE_DRIVER=gcs     production: Google Cloud Storage bucket
//                               FILE_STORAGE_GCS_BUCKET (optional
//                               FILE_STORAGE_GCS_PREFIX), Workload Identity.
//   FILE_STORAGE_DRIVER=local   files under FILE_STORAGE_LOCAL_ROOT (default:
//                               <os temp>/vercentlabs-object-storage), shared
//                               by the web app and worker on one machine.
//   FILE_STORAGE_DRIVER=memory  single-process tests only.
//   (unset)                     local outside production; production refuses
//                               to start without gcs (@vercentlabs/config).
// Never falls back to storing bytes in PostgreSQL.
import os from "node:os";
import path from "node:path";

import { createLocalObjectStorage, createMemoryObjectStorage } from "@vercentlabs/document-engine";

export class FileStorageError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "FileStorageError";
    this.status = status;
    this.code = code;
  }
}

let cached = null;
let cachedKey = null;
let override = null;

// Tests inject a store (e.g. createMemoryObjectStorage()) for the process.
export function setObjectStorageForTests(storage) {
  override = storage;
}

export async function resolveObjectStorage(env = process.env) {
  if (override) return override;
  const production = env.NODE_ENV === "production";
  const driver = String(env.FILE_STORAGE_DRIVER || (production ? "" : "local")).trim().toLowerCase();
  const root = String(env.FILE_STORAGE_LOCAL_ROOT || path.join(os.tmpdir(), "vercentlabs-object-storage"));
  const bucket = String(env.FILE_STORAGE_GCS_BUCKET || "").trim();
  const prefix = String(env.FILE_STORAGE_GCS_PREFIX || "").trim();
  const apiEndpoint = String(env.FILE_STORAGE_GCS_API_ENDPOINT || "").trim();
  const key = `${driver}|${root}|${bucket}|${prefix}|${apiEndpoint}`;
  if (cached && cachedKey === key) return cached;
  if (!driver) throw new FileStorageError(503, "File storage is not configured for this environment.", "FILE_STORAGE_NOT_CONFIGURED");
  if (driver === "memory") {
    if (production) throw new FileStorageError(503, "In-memory file storage cannot be used in production.", "FILE_STORAGE_NOT_CONFIGURED");
    cached = createMemoryObjectStorage();
  } else if (driver === "local") {
    if (production) throw new FileStorageError(503, "Local file storage cannot be used in production.", "FILE_STORAGE_NOT_CONFIGURED");
    cached = await createLocalObjectStorage({ root });
  } else if (driver === "gcs") {
    if (!bucket) throw new FileStorageError(503, "FILE_STORAGE_GCS_BUCKET is required for Cloud Storage.", "FILE_STORAGE_NOT_CONFIGURED");
    const { createGcsObjectStorage } = await import("@vercentlabs/document-engine/gcs");
    cached = await createGcsObjectStorage({ bucket, prefix, projectId: String(env.GOOGLE_CLOUD_PROJECT || "").trim() || undefined, apiEndpoint: apiEndpoint || undefined });
  } else {
    throw new FileStorageError(503, `File storage driver "${driver}" is not available.`, "FILE_STORAGE_NOT_CONFIGURED");
  }
  cachedKey = key;
  return cached;
}
