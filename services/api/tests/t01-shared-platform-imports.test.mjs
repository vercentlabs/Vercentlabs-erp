import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const service = read("services/api/src/core/master-data.js");
const types = read("services/api/src/index.d.ts");
const migration = read("database/tenant/migrations/075_t01_import_idempotency.sql");

test("T01 SP023 service: import idempotency is transaction-owned, conflict-aware and durable", () => {
  const start = service.indexOf("export async function beginImportJob");
  const end = service.indexOf("export async function createImportJob", start);
  assert.ok(start >= 0 && end > start);
  const block = service.slice(start, end);
  assert.match(block, /idempotencyKey/);
  assert.match(block, /requestFingerprint/);
  assert.match(block, /ON CONFLICT \(organization_id, resource, idempotency_key\)/);
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /BUSINESS_DATA_IMPORT_IDEMPOTENCY_CONFLICT/);
});

test("T01 SP023 service: completed import persists the replay payload atomically", () => {
  const start = service.indexOf("export async function completeImportJob");
  const end = service.indexOf("export async function seedBusinessDataFoundation", start);
  const block = service.slice(start, end);
  assert.match(block, /result_payload = \$8::jsonb/);
  assert.match(block, /completed_at = now\(\)/);
  assert.match(types, /beginImportJob/);
  assert.match(types, /resultPayload\?: unknown/);
});

test("T01 SP023 migration: only non-null per-resource idempotency keys are unique", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS idempotency_key text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS request_fingerprint char\(64\)/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS master_data_import_jobs_idempotency_uidx|CREATE UNIQUE INDEX IF NOT EXISTS master_data_import_jobs_idempotency_uidx/);
  assert.match(migration, /WHERE idempotency_key IS NOT NULL/);
});
