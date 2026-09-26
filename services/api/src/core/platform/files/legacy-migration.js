// Moving historical file bytes out of PostgreSQL, and proving object storage
// still holds what the metadata says. Both run as an operational Job with the
// migration authority (`pnpm files:migrate-legacy`, `pnpm files:reconcile`),
// never inside a request.
//
// Migration safety, one row at a time:
//   1. claim the row (FOR UPDATE SKIP LOCKED: parallel runners never collide)
//   2. verify the stored bytes against content_sha256 (a mismatch is reported
//      and the row is left untouched for a human to inspect)
//   3. upload to a DETERMINISTIC key (derived from the row id): a crash after
//      the upload but before the database update re-uploads to the same key,
//      so a retry never creates stray objects
//   4. read the object back (size + sha256 metadata) before trusting it
//   5. switch the row to object storage and clear the bytes in the SAME
//      statement, then write an audit event
// Re-running is idempotent: already-migrated rows are simply not selected.
import { attachmentStorageKey, sha256 } from "@vercentlabs/document-engine";

import { audit } from "../../security.js";
import { resolveObjectStorage } from "./storage.js";

const DEFAULT_BATCH = 50;
const MAX_BATCH = 500;

function bounded(value, fallback) {
  const number = Number(value ?? fallback);
  return Math.min(Math.max(Number.isInteger(number) ? number : fallback, 1), MAX_BATCH);
}

export async function countLegacyFileRows(queryable) {
  const { rows } = await queryable.query(`SELECT count(*)::int AS rows, COALESCE(sum(octet_length(content)), 0)::bigint AS bytes FROM public.attachments WHERE storage_mode = 'database_legacy' AND content IS NOT NULL`);
  return { rows: rows[0].rows, bytes: Number(rows[0].bytes) };
}

async function migrateOne(client, store, row, { dryRun }) {
  const bytes = Buffer.from(row.content);
  const digest = sha256(bytes);
  if (row.content_sha256 && row.content_sha256 !== digest) return { id: row.id, outcome: "hash_mismatch" };
  const key = attachmentStorageKey({ organizationId: row.organization_id, attachmentId: row.id, fileName: row.file_name });
  if (dryRun) return { id: row.id, outcome: "would_migrate", key, size: bytes.length };
  await store.put(key, bytes, { contentType: row.mime_type || "application/octet-stream", sha256: digest });
  const head = await store.head(key);
  if (!head || head.size !== bytes.length || (head.sha256 && head.sha256 !== digest)) return { id: row.id, outcome: "verify_failed", key };
  await client.query(
    `UPDATE public.attachments
        SET storage_mode='object', storage_provider=$3, storage_key=$4, content=NULL, content_sha256=$5
      WHERE id=$1 AND organization_id=$2 AND storage_mode='database_legacy'`,
    [row.id, row.organization_id, store.name, key, digest],
  );
  await audit(client, {
    organizationId: row.organization_id,
    actorUserId: null,
    eventType: "file.storage_migrated",
    entityType: "attachment",
    entityId: row.id,
    metadata: { provider: store.name, sizeBytes: bytes.length, sha256: digest },
  });
  return { id: row.id, outcome: "migrated", key, size: bytes.length };
}

/**
 * Migrates up to `batchSize` legacy rows per transaction, for at most
 * `maxBatches` batches. `withTransaction(work)` runs `work(client)` inside one
 * owner-role transaction (the script provides it).
 */
export async function migrateLegacyFiles(withTransaction, { batchSize, maxBatches = 20, dryRun = false, storage, env = process.env } = {}) {
  const store = storage || (await resolveObjectStorage(env));
  const size = bounded(batchSize, DEFAULT_BATCH);
  const summary = { migrated: 0, wouldMigrate: 0, hashMismatch: [], verifyFailed: [], batches: 0 };
  let cursor = "00000000-0000-0000-0000-000000000000";
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const results = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, organization_id, file_name, mime_type, content, content_sha256
           FROM public.attachments
          WHERE storage_mode='database_legacy' AND content IS NOT NULL AND id > $2::uuid
          ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [size, cursor],
      );
      const outcomes = [];
      for (const row of rows) outcomes.push(await migrateOne(client, store, row, { dryRun }));
      return outcomes;
    });
    if (!results.length) break;
    summary.batches += 1;
    cursor = results.at(-1).id;
    for (const result of results) {
      if (result.outcome === "migrated") summary.migrated += 1;
      else if (result.outcome === "would_migrate") summary.wouldMigrate += 1;
      else if (result.outcome === "hash_mismatch") summary.hashMismatch.push(result.id);
      else summary.verifyFailed.push(result.id);
    }
  }
  return summary;
}

/**
 * Checks object-backed rows against object storage: missing objects, size or
 * checksum drift. Expired artifacts whose content was purged are skipped.
 * Pages by id (resumable with `after`).
 */
export async function reconcileObjectStorage(queryable, { batchSize, maxRows = 10_000, after = null, storage, env = process.env } = {}) {
  const store = storage || (await resolveObjectStorage(env));
  const size = bounded(batchSize, 200);
  const report = { checked: 0, missing: [], sizeMismatch: [], hashMismatch: [], lastId: after };
  let cursor = after || "00000000-0000-0000-0000-000000000000";
  while (report.checked < maxRows) {
    const { rows } = await queryable.query(
      `SELECT id, storage_key, size_bytes, content_sha256 FROM public.attachments
        WHERE storage_mode='object' AND content_removed_at IS NULL AND id > $2::uuid
        ORDER BY id LIMIT $1`,
      [size, cursor],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const head = await store.head(row.storage_key);
      if (!head) report.missing.push(row.id);
      else if (Number(head.size) !== Number(row.size_bytes)) report.sizeMismatch.push(row.id);
      else if (head.sha256 && row.content_sha256 && head.sha256 !== row.content_sha256) report.hashMismatch.push(row.id);
      report.checked += 1;
    }
    cursor = rows.at(-1).id;
    report.lastId = cursor;
  }
  report.healthy = !report.missing.length && !report.sizeMismatch.length && !report.hashMismatch.length;
  return report;
}
