// The one Shared Platform file service. It owns file metadata (identity,
// versions, storage reference, SHA-256, scan status, lifecycle, retention);
// the owning module owns who may see or change a parent record's files.
//
// Upload pipeline (never weakened): validateAttachment (name sanitising,
// MIME allow-list, size) -> scanAttachmentForUpload (magic bytes vs declared
// type, EICAR, external scanner, fail-closed in production) -> SHA-256 ->
// object storage -> metadata row. Bytes go to object storage only; rows
// written before migration 063 ("database_legacy") stay readable.
import { attachmentStorageKey, sha256, validateAttachment } from "@vercentlabs/document-engine";

import { AttachmentSecurityError, scanAttachmentForUpload } from "../../attachment-security.js";
import { getFileEntityType } from "./registry.js";
import { resolveObjectStorage } from "./storage.js";
import { createLogger } from "@vercentlabs/observability";

const filesLogger = createLogger("files");

// Object storage failures are operational signals (alert storage-failure);
// only the operation and error code are logged, never file names or bytes.
function storageFailed(operation, organizationId, error) {
  filesLogger.event("files.storage.failed", { operation, organizationId, code: error?.code || null, error: String(error?.message || error) }, "error");
}

export class FileError extends Error {
  constructor(status, message, code = "FILE_ERROR") {
    super(message);
    this.name = "FileError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METADATA = `id, logical_id, version, is_current, entity_type, entity_id, file_name, mime_type, size_bytes, content_sha256,
  lifecycle_status, scan_status, classification, purpose, storage_mode, expires_at, content_removed_at, uploaded_by, created_at`;

function camel(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()), value]));
}

function uuid(value, label) {
  if (!UUID.test(String(value || ""))) throw new FileError(400, `${label} is invalid.`, "FILE_REFERENCE_INVALID");
  return String(value);
}

function registered(entityType, purpose) {
  const definition = getFileEntityType(entityType);
  if (!definition) throw new FileError(400, "Files cannot be attached to this kind of record.", "FILE_ENTITY_TYPE_UNREGISTERED");
  if (purpose && !definition.purposes.includes(purpose)) throw new FileError(400, "This kind of file cannot be attached to this record.", "FILE_PURPOSE_INVALID");
  return definition;
}

/**
 * Validates, scans and hashes an upload. Runs OUTSIDE any database
 * transaction (the scanner may be a network call).
 */
export async function prepareFileUpload({ fileName, mimeType, bytes, maximumBytes, allowedTypes }, env = process.env) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  let validated;
  try {
    validated = validateAttachment({ fileName, mimeType, sizeBytes: content.length }, { maximumBytes, allowedTypes });
  } catch (error) {
    throw new FileError(400, error instanceof Error ? error.message : "The file could not be validated.", "FILE_INVALID");
  }
  try {
    const { scanStatus } = await scanAttachmentForUpload(content, validated.mimeType, env);
    return Object.freeze({ ...validated, bytes: content, contentSha256: sha256(content), scanStatus });
  } catch (error) {
    if (error instanceof AttachmentSecurityError) throw new FileError(error.status, error.message, error.code);
    throw error;
  }
}

/**
 * Stores a prepared upload for a registered parent record and records its
 * metadata. With replacesLogicalId the upload becomes the next version of an
 * existing file on the same record (the previous version is kept).
 * The object is written before the row; a rolled-back transaction leaves an
 * unreferenced object, never a row that points at missing bytes.
 */
export async function storeFile(client, input, { storage, env = process.env } = {}) {
  const { organizationId, entityType, entityId, prepared, uploadedBy = null, purpose = "attachment", replacesLogicalId = null, expiresAt = null, classification = "internal" } = input;
  registered(entityType, purpose);
  uuid(organizationId, "Organization");
  if (!prepared?.bytes || !prepared.contentSha256) throw new FileError(500, "The upload was not prepared.", "FILE_NOT_PREPARED");
  const store = storage || (await resolveObjectStorage(env));

  let logicalId = null;
  let version = 1;
  if (replacesLogicalId) {
    const current = (
      await client.query(
        `SELECT logical_id, version FROM public.attachments
          WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND logical_id=$4 AND is_current
          LIMIT 1 FOR UPDATE`,
        [organizationId, entityType, String(entityId), uuid(replacesLogicalId, "File")],
      )
    ).rows[0];
    if (!current) throw new FileError(404, "The file being replaced could not be found.", "FILE_NOT_FOUND");
    logicalId = current.logical_id;
    const latest = (await client.query(`SELECT max(version)::int AS version FROM public.attachments WHERE organization_id=$1 AND logical_id=$2`, [organizationId, logicalId])).rows[0];
    version = Number(latest.version) + 1;
    await client.query(`UPDATE public.attachments SET is_current=false WHERE organization_id=$1 AND logical_id=$2 AND is_current`, [organizationId, logicalId]);
  }

  const id = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
  const storageKey = attachmentStorageKey({ organizationId, attachmentId: id, fileName: prepared.fileName });
  try {
    await store.put(storageKey, prepared.bytes, { contentType: prepared.mimeType, sha256: prepared.contentSha256 });
  } catch (error) {
    storageFailed("put", organizationId, error);
    throw error;
  }
  const row = (
    await client.query(
      `INSERT INTO public.attachments (
         id, organization_id, entity_type, entity_id, file_name, storage_key, mime_type, size_bytes, uploaded_by,
         content_sha256, lifecycle_status, scan_status, logical_id, version, is_current,
         storage_mode, storage_provider, purpose, expires_at, classification
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'clean',$11,COALESCE($12::uuid,$1),$13,true,'object',$14,$15,$16,$17)
       RETURNING ${METADATA}`,
      [id, organizationId, entityType, String(entityId), prepared.fileName, storageKey, prepared.mimeType, prepared.sizeBytes, uploadedBy,
        prepared.contentSha256, prepared.scanStatus, logicalId, version, store.name, purpose, expiresAt, classification],
    )
  ).rows[0];
  return camel(row);
}

export async function listFiles(client, { organizationId, entityType, entityId }) {
  registered(entityType);
  const { rows } = await client.query(
    `SELECT ${METADATA} FROM public.attachments
      WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND is_current AND lifecycle_status <> 'archived'
      ORDER BY created_at DESC LIMIT 200`,
    [organizationId, entityType, String(entityId)],
  );
  return rows.map(camel);
}

export async function listFileVersions(client, { organizationId, entityType, entityId, logicalId }) {
  registered(entityType);
  const { rows } = await client.query(
    `SELECT ${METADATA} FROM public.attachments
      WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND logical_id=$4 AND lifecycle_status <> 'archived'
      ORDER BY version DESC`,
    [organizationId, entityType, String(entityId), uuid(logicalId, "File")],
  );
  return rows.map(camel);
}

export async function getFileMetadata(client, { organizationId, fileId }) {
  const { rows } = await client.query(`SELECT ${METADATA} FROM public.attachments WHERE organization_id=$1 AND id=$2`, [organizationId, uuid(fileId, "File")]);
  return camel(rows[0]) || null;
}

/**
 * Bytes for one file version, after the caller has authorized the parent
 * record. Quarantined/rejected/archived files answer exactly like a missing
 * file (404); an expired artifact answers 410.
 */
export async function readFileContent(client, { organizationId, entityType, entityId, fileId }, { storage, env = process.env } = {}) {
  registered(entityType);
  const row = (
    await client.query(
      `SELECT id, file_name, mime_type, size_bytes, storage_mode, storage_key, content_sha256, lifecycle_status, scan_status, purpose, expires_at, content_removed_at
         FROM public.attachments WHERE organization_id=$1 AND id=$2 AND entity_type=$3 AND entity_id=$4`,
      [organizationId, uuid(fileId, "File"), entityType, String(entityId)],
    )
  ).rows[0];
  const notFound = () => new FileError(404, "File not found.", "FILE_NOT_FOUND");
  if (!row || !["clean", "not_applicable"].includes(row.scan_status)) throw notFound();
  // An artifact past its expiry is gone for good (the row is kept as evidence).
  if (row.expires_at && (row.content_removed_at || new Date(row.expires_at).getTime() <= Date.now())) throw new FileError(410, "This file has expired.", "FILE_EXPIRED");
  if (row.lifecycle_status !== "clean") throw notFound();
  let body;
  if (row.storage_mode === "database_legacy") {
    // Historical bytes, until `pnpm files:migrate-legacy` moves them (the
    // contract migration that drops the column requires zero such rows).
    const legacy = (await client.query("SELECT content FROM public.attachments WHERE organization_id=$1 AND id=$2", [organizationId, row.id])).rows[0];
    if (!legacy?.content) throw notFound();
    body = Buffer.from(legacy.content);
  } else {
    const store = storage || (await resolveObjectStorage(env));
    try {
      body = await store.get(row.storage_key);
    } catch (error) {
      if (error?.code === "OBJECT_NOT_FOUND") {
        // Metadata says the object exists: a missing object is a storage
        // integrity problem (files:reconcile), not a user error.
        filesLogger.event("files.object.missing", { organizationId, attachmentId: row.id }, "error");
        throw notFound();
      }
      storageFailed("get", organizationId, error);
      throw error;
    }
  }
  return { id: row.id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), contentSha256: row.content_sha256, body };
}

/**
 * Removes one version from use (never a hard delete: the row stays as
 * evidence). When it was the current version, the newest remaining version
 * becomes current again.
 */
export async function archiveFile(client, { organizationId, entityType, entityId, fileId, actorUserId = null }) {
  registered(entityType);
  const current = (
    await client.query(
      `SELECT id, logical_id, is_current FROM public.attachments
        WHERE organization_id=$1 AND id=$2 AND entity_type=$3 AND entity_id=$4 AND lifecycle_status <> 'archived' FOR UPDATE`,
      [organizationId, uuid(fileId, "File"), entityType, String(entityId)],
    )
  ).rows[0];
  if (!current) throw new FileError(404, "File not found.", "FILE_NOT_FOUND");
  const row = (
    await client.query(
      `UPDATE public.attachments SET lifecycle_status='archived', archived_at=now(), archived_by=$2, is_current=false WHERE id=$1 RETURNING ${METADATA}`,
      [current.id, actorUserId],
    )
  ).rows[0];
  if (current.is_current) {
    await client.query(
      `UPDATE public.attachments SET is_current=true
        WHERE id = (SELECT id FROM public.attachments WHERE organization_id=$1 AND logical_id=$2 AND lifecycle_status <> 'archived' ORDER BY version DESC LIMIT 1)`,
      [organizationId, current.logical_id],
    );
  }
  return { ...camel(row), wasCurrent: current.is_current };
}

/**
 * Worker maintenance: deletes the bytes of expired artifacts (exports,
 * report outputs). The metadata row, its hash and its audit trail remain.
 */
// One organisation at a time, inside that organisation's context (attachments
// are organisation-RLS protected); the worker walks the organisations.
export async function purgeExpiredFileContent(client, { organizationId, storage, env = process.env, limit = 100 } = {}) {
  const store = storage || (await resolveObjectStorage(env));
  const { rows } = await client.query(
    `SELECT id, storage_key FROM public.attachments
      WHERE organization_id=$2 AND storage_mode='object' AND expires_at IS NOT NULL AND expires_at <= now() AND content_removed_at IS NULL
      ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit, organizationId],
  );
  for (const row of rows) {
    await store.remove(row.storage_key);
    await client.query(`UPDATE public.attachments SET content_removed_at=now(), lifecycle_status='archived', archived_at=COALESCE(archived_at, now()) WHERE id=$1`, [row.id]);
  }
  return { removed: rows.length };
}
