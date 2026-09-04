import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  LEAD_BULK_JOB_TYPE,
  LEAD_BULK_SYNC_LIMIT,
  enqueueLeadBulkUpdateJob,
  getLeadOperationsDashboard,
  normalizeLeadBulkChanges,
  normalizeLeadBulkFilters,
  resolveLeadBulkExecutionContext,
} from "../src/modules/crm/lead-operations.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const company = "33333333-3333-4333-8333-333333333333";
const branch = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";

const scopedContext = {
  organizationId: org,
  userId: user,
  activeCompanyId: company,
  activeBranchId: branch,
  allowAllCompanies: false,
  roleSlugs: [],
  permissions: ["crm.view", "crm.leads.manage"],
};

test("F001 Pass 2C: bulk mutation surface allows only safe non-lifecycle fields", () => {
  assert.equal(LEAD_BULK_SYNC_LIMIT, 50);
  assert.equal(LEAD_BULK_JOB_TYPE, "crm.leads.bulk_update");
  assert.deepEqual(
    normalizeLeadBulkChanges({ priority: "HIGH", rating: "hot", sourceId: "" }),
    { priority: "high", rating: "hot", sourceId: null },
  );
  assert.throws(
    () => normalizeLeadBulkChanges({ status: "working" }),
    (error) => error?.code === "CRM_LEAD_STAGE_ACTION_REQUIRED",
  );
  assert.throws(
    () => normalizeLeadBulkChanges({ ownerUserId: user }),
    (error) => error?.code === "CRM_LEAD_ASSIGNMENT_REQUIRED",
  );
  assert.throws(
    () => normalizeLeadBulkChanges({ email: "bulk@example.invalid" }),
    (error) => error?.code === "CRM_LEAD_BULK_FIELD_UNSUPPORTED",
  );
});

test("F001 Pass 2C: filter snapshots are normalized before becoming durable job membership", () => {
  assert.deepEqual(
    normalizeLeadBulkFilters({
      search: "  Acme  ",
      status: "working",
      ownerId: "me",
      priority: "HIGH",
      rating: "HOT",
      followup: "OVERDUE",
      qualification: "QUALIFIED",
    }),
    {
      search: "Acme",
      status: "working",
      ownerId: "me",
      sourceId: "",
      priority: "high",
      rating: "hot",
      followup: "overdue",
      qualification: "qualified",
    },
  );
  assert.throws(
    () => normalizeLeadBulkFilters({ status: "converted" }),
    (error) => error?.code === "CRM_LEAD_BULK_RECORD_CLOSED",
  );
});

test("F001 Pass 2C: large selection is snapshotted under record scope before the worker is queued", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/INSERT INTO tenant\.background_jobs/.test(sql)) {
        return {
          rows: [{
            id: jobId,
            job_type: LEAD_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            progress: {},
            result_manifest: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (/SELECT count\(\*\)::int AS total FROM tenant\.crm_leads record/.test(sql)) {
        return { rows: [{ total: 120 }], rowCount: 1 };
      }
      if (/INSERT INTO tenant\.crm_lead_bulk_job_items/.test(sql)) {
        return { rows: [], rowCount: 120 };
      }
      if (/UPDATE tenant\.background_jobs\s+SET progress=/.test(sql)) {
        return {
          rows: [{
            id: jobId,
            job_type: LEAD_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            progress: { requested: 120 },
            result_manifest: { requested: 120 },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await enqueueLeadBulkUpdateJob(client, scopedContext, {
    selection: {
      type: "filter",
      filters: { status: "working", ownerId: "me", priority: "high" },
    },
    changes: { priority: "urgent" },
    idempotencyKey: "lead-bulk:test-pass2c-0001",
  });

  assert.equal(result.mode, "asynchronous");
  assert.equal(result.deduped, false);
  assert.equal(result.job.progress.requested, 120);
  const snapshotCount = calls.find((call) => /SELECT count\(\*\)::int AS total FROM tenant\.crm_leads record/.test(call.sql));
  assert.ok(snapshotCount);
  assert.match(snapshotCount.sql, /record\.company_id IS NULL OR record\.company_id\s*=/);
  assert.match(snapshotCount.sql, /record\.branch_id IS NULL OR record\.branch_id\s*=/);
  assert.match(snapshotCount.sql, /record\.owner_user_id IS NULL OR record\.owner_user_id\s*=/);
  assert.match(snapshotCount.sql, /record\.record_status = 'active'/);
  const itemInsert = calls.find((call) => /INSERT INTO tenant\.crm_lead_bulk_job_items/.test(call.sql));
  assert.match(itemInsert.sql, /record\.updated_at/);
  assert.match(itemInsert.sql, /ORDER BY record\.id/);
});

test("F001 Pass 2C: idempotency replay is bound to the normalized command fingerprint", async () => {
  let insertedPayload = null;
  const sameCommandClient = {
    async query(sql, values) {
      if (/INSERT INTO tenant\.background_jobs/.test(sql)) {
        insertedPayload = JSON.parse(values[2]);
        return { rows: [] };
      }
      if (/SELECT \* FROM tenant\.background_jobs/.test(sql)) {
        return {
          rows: [{
            id: jobId,
            job_type: LEAD_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            payload: insertedPayload,
            progress: { requested: 120 },
            result_manifest: { requested: 120 },
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const replay = await enqueueLeadBulkUpdateJob(sameCommandClient, scopedContext, {
    selection: { type: "filter", filters: { status: "working" } },
    changes: { priority: "urgent" },
    idempotencyKey: "lead-bulk:test-pass2c-replay",
  });
  assert.equal(replay.deduped, true);
  assert.match(insertedPayload.commandFingerprint, /^[0-9a-f]{64}$/);

  const conflictingClient = {
    async query(sql) {
      if (/INSERT INTO tenant\.background_jobs/.test(sql)) return { rows: [] };
      if (/SELECT \* FROM tenant\.background_jobs/.test(sql)) {
        return {
          rows: [{
            id: jobId,
            job_type: LEAD_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            payload: { commandFingerprint: "0".repeat(64) },
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () =>
      enqueueLeadBulkUpdateJob(conflictingClient, scopedContext, {
        selection: { type: "filter", filters: { status: "working" } },
        changes: { priority: "urgent" },
        idempotencyKey: "lead-bulk:test-pass2c-replay",
      }),
    (error) => error?.code === "CRM_LEAD_BULK_IDEMPOTENCY_CONFLICT",
  );
});

test("F001 Pass 2C: worker execution context rehydrates current authorization and fails closed", async () => {
  const ownerClient = {
    async query(sql) {
      if (/FROM public\.organization_memberships/.test(sql)) {
        return {
          rows: [{
            user_id: user,
            role_slugs: ["organization_owner"],
            permissions: ["crm.view", "crm.leads.manage", "crm.records.view_all"],
          }],
        };
      }
      throw new Error(`Owner path should not require scoped company lookup: ${sql}`);
    },
  };
  const context = await resolveLeadBulkExecutionContext(ownerClient, org, {
    requesterUserId: user,
    activeCompanyId: null,
    activeBranchId: null,
  });
  assert.equal(context?.allowAllCompanies, true);
  assert.equal(context?.userId, user);

  const revokedClient = {
    async query(sql) {
      if (/FROM public\.organization_memberships/.test(sql)) {
        return { rows: [{ user_id: user, role_slugs: [], permissions: ["crm.view"] }] };
      }
      throw new Error(`Revoked path must stop before resource access: ${sql}`);
    },
  };
  assert.equal(
    await resolveLeadBulkExecutionContext(revokedClient, org, {
      requesterUserId: user,
      activeCompanyId: company,
      activeBranchId: branch,
    }),
    null,
  );
});

test("F001 Pass 2C: Lead operations dashboard is a scoped SQL aggregate, not an O(n) Node materialization", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [{ total: 100, ready: 80, overdue: 7, fresh: 60, aging: 20, stale: 13 }],
      };
    },
  };
  const result = await getLeadOperationsDashboard(client, scopedContext);
  assert.deepEqual(result, {
    total: 100,
    ready: 80,
    overdue: 7,
    aging: { fresh: 60, aging: 20, stale: 13, overdue: 7 },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /count\(\*\)::int AS total/);
  assert.match(calls[0].sql, /count\(\*\) FILTER/);
  assert.match(calls[0].sql, /lead\.company_id IS NULL OR lead\.company_id\s*=/);
  assert.match(calls[0].sql, /lead\.branch_id IS NULL OR lead\.branch_id\s*=/);
  assert.match(calls[0].sql, /lead\.owner_user_id IS NULL OR lead\.owner_user_id\s*=/);
  assert.doesNotMatch(calls[0].sql, /SELECT lead\.id/);
});

test("F001 Pass 2C: synchronous updates and durable jobs preserve canonical per-record invariants", () => {
  const operations = read("src/modules/crm/lead-operations.js");
  const core = read("src/modules/crm/index.js");
  const migration = read("../../database/tenant/migrations/074_f001_lead_bulk_scale.sql");
  assert.match(operations, /SAVEPOINT crm_lead_bulk_item/);
  assert.match(operations, /updateCrmRecord\(client, context, "leads", id, changes/);
  assert.match(operations, /expectedUpdatedAt: expectedVersions\[id\]/);
  assert.doesNotMatch(operations, /UPDATE tenant\.crm_leads SET source_id=/);
  assert.match(core, /snapshotLeadBulkJobSelection/);
  assert.match(core, /expected_updated_at/);
  assert.match(core, /ORDER BY record\.id/);
  assert.doesNotMatch(core, /ON CONFLICT \(organization_id,job_id,lead_id\) DO NOTHING\s+RETURNING lead_id/);
  assert.match(migration, /crm_lead_bulk_job_items/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /crm_leads_f001_active_queue_idx/);
});
