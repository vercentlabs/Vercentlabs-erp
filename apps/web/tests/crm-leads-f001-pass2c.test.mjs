import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 Pass 2C web: large Lead selections use a stable filter snapshot and retry-stable idempotency identity", () => {
  const workspace = read("src/modules/crm/components/leads-workspace.tsx");
  assert.match(workspace, /Select all \{total\} matching/);
  assert.match(workspace, /selectionMode === "filter"/);
  assert.match(workspace, /filters: \{ search, status, \.\.\.filters \}/);
  assert.match(workspace, /bulkRetryIdentity/);
  assert.match(workspace, /fingerprint: asyncFingerprint/);
  assert.match(workspace, /lead-bulk:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(workspace, /bulkRetryIdentity\.current\?\.fingerprint === asyncFingerprint/);
});

test("F001 Pass 2C web: synchronous bulk sends optimistic versions and preserves partial failures for retry", () => {
  const workspace = read("src/modules/crm/components/leads-workspace.tsx");
  assert.match(workspace, /expectedVersions/);
  assert.match(workspace, /String\(row\.updatedAt \|\| ""\)/);
  assert.match(workspace, /item\.status !== "applied"/);
  assert.match(workspace, /setSelected\(new Set\(retryIds\)\)/);
  assert.match(workspace, /Bulk update: \$\{applied\} applied/);
});

test("F001 Pass 2C web: asynchronous bulk exposes live progress without blocking the workspace", () => {
  const workspace = read("src/modules/crm/components/leads-workspace.tsx");
  const route = read("src/app/api/crm/leads/operations/route.ts");
  assert.match(workspace, /\/api\/crm\/leads\/operations\?jobId=/);
  assert.match(workspace, /window\.setInterval\(refresh, 2_000\)/);
  assert.match(workspace, /Bulk job queued/);
  assert.match(workspace, /Bulk job completed/);
  assert.match(route, /LEAD_BULK_SYNC_LIMIT/);
  assert.match(route, /enqueueLeadBulkUpdateJob/);
  assert.match(route, /getLeadBulkJob/);
  assert.match(route, /assertSameOrigin\(request\)/);
});

test("F001 Pass 2C web: Lead list sorting has a deterministic id tie-breaker", () => {
  const core = read("../../services/api/src/modules/crm/index.js");
  assert.match(core, /orderBy: "updated_at DESC, created_at DESC, id DESC"/);
});
