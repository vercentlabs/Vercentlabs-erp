import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  OPPORTUNITY_BULK_JOB_TYPE,
  OPPORTUNITY_BULK_MAX_ITEMS,
  enqueueOpportunityBulkUpdateJob,
  getOpportunityBulkJob,
  normalizeOpportunityBulkChanges,
  resolveOpportunityBulkExecutionContext,
} from "../src/modules/crm/opportunity-operations.js";

// F029 (Bulk actions) — LAST PROMPT 1/3 closeout: Opportunities previously
// had no async bulk-job path at all (a selection above the synchronous
// 200-record cap in bulkUpdateOpportunities was rejected outright). This
// mirrors crm-leads-f001-pass2c.test.mjs's coverage shape for the
// equivalent Lead functionality.

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
  permissions: ["crm.view", "crm.opportunities.manage"],
};

function noQueryClient() {
  return { query: async (sql) => { throw new Error(`Unexpected query: ${sql}`); } };
}

test("F029: bulk mutation surface allows only the same fields/values the synchronous path allows", async () => {
  assert.equal(OPPORTUNITY_BULK_JOB_TYPE, "crm.opportunities.bulk_update");
  assert.equal(OPPORTUNITY_BULK_MAX_ITEMS, 50_000);
  await assert.rejects(
    () => normalizeOpportunityBulkChanges(noQueryClient(), scopedContext, { probability: 90 }),
    (error) => error?.code === "CRM_OPPORTUNITY_BULK_FIELD_UNSUPPORTED",
  );
  await assert.rejects(
    () => normalizeOpportunityBulkChanges(noQueryClient(), scopedContext, { forecastCategory: "sure_thing" }),
    (error) => error?.code === "CRM_OPPORTUNITY_BULK_FORECAST_CATEGORY_INVALID",
  );
  await assert.rejects(
    () => normalizeOpportunityBulkChanges(noQueryClient(), scopedContext, { expectedCloseDate: "not-a-date" }),
    (error) => error?.code === "CRM_OPPORTUNITY_BULK_CLOSE_DATE_INVALID",
  );
  await assert.rejects(
    () => normalizeOpportunityBulkChanges(noQueryClient(), scopedContext, {}),
    (error) => error?.code === "CRM_OPPORTUNITY_BULK_CHANGES_EMPTY",
  );
});

test("F029: a large filter-snapshot selection is snapshotted under record scope before the worker is queued", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/INSERT INTO tenant\.background_jobs/.test(sql)) {
        return {
          rows: [{
            id: jobId,
            job_type: OPPORTUNITY_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            progress: {},
            result_manifest: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (/SELECT count\(\*\)::int AS total FROM tenant\.crm_opportunities record/.test(sql)) {
        return { rows: [{ total: 350 }], rowCount: 1 };
      }
      if (/INSERT INTO tenant\.crm_opportunity_bulk_job_items/.test(sql)) {
        return { rows: [], rowCount: 350 };
      }
      if (/UPDATE tenant\.background_jobs\s+SET progress=/.test(sql)) {
        return {
          rows: [{
            id: jobId,
            job_type: OPPORTUNITY_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            progress: { requested: 350 },
            result_manifest: { requested: 350 },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await enqueueOpportunityBulkUpdateJob(client, scopedContext, {
    selection: { type: "filter", filters: { ownerId: "me" } },
    changes: { forecastCategory: "best_case" },
    idempotencyKey: "opportunity-bulk:test-f029-0001",
  });

  assert.equal(result.mode, "asynchronous");
  assert.equal(result.deduped, false);
  assert.equal(result.job.progress.requested, 350);
  const snapshotCount = calls.find((call) => /SELECT count\(\*\)::int AS total FROM tenant\.crm_opportunities record/.test(call.sql));
  assert.ok(snapshotCount);
  assert.match(snapshotCount.sql, /record\.status = 'open'/);
  assert.match(snapshotCount.sql, /record\.company_id IS NULL OR record\.company_id\s*=/);
  assert.match(snapshotCount.sql, /record\.owner_user_id IS NULL OR record\.owner_user_id\s*=/);
  const itemInsert = calls.find((call) => /INSERT INTO tenant\.crm_opportunity_bulk_job_items/.test(call.sql));
  assert.match(itemInsert.sql, /record\.updated_at/);
  assert.match(itemInsert.sql, /ORDER BY record\.id/);
});

test("F029: an explicit selection over the 200-sync-cap is accepted asynchronously (the gap this pass closes)", async () => {
  const ids = Array.from({ length: 500 }, (_, index) => `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`);
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/INSERT INTO tenant\.background_jobs/.test(sql))
        return { rows: [{ id: jobId, job_type: OPPORTUNITY_BULK_JOB_TYPE, status: "pending", requested_by: user, progress: {}, result_manifest: {} }] };
      if (/SELECT count\(\*\)::int AS total FROM tenant\.crm_opportunities record/.test(sql))
        return { rows: [{ total: 500 }] };
      if (/INSERT INTO tenant\.crm_opportunity_bulk_job_items/.test(sql))
        return { rows: [], rowCount: 500 };
      if (/UPDATE tenant\.background_jobs\s+SET progress=/.test(sql))
        return { rows: [{ id: jobId, job_type: OPPORTUNITY_BULK_JOB_TYPE, status: "pending", requested_by: user, progress: { requested: 500 }, result_manifest: { requested: 500 } }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await enqueueOpportunityBulkUpdateJob(client, scopedContext, {
    selection: { type: "explicit", ids },
    changes: { nextStep: "Re-engage" },
    idempotencyKey: "opportunity-bulk:test-f029-explicit-500",
  });
  assert.equal(result.mode, "asynchronous");
  assert.equal(result.job.progress.requested, 500);
});

test("F029: idempotency replay is bound to the normalized command fingerprint", async () => {
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
            job_type: OPPORTUNITY_BULK_JOB_TYPE,
            status: "pending",
            requested_by: user,
            payload: insertedPayload,
            progress: { requested: 10 },
            result_manifest: { requested: 10 },
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const replay = await enqueueOpportunityBulkUpdateJob(sameCommandClient, scopedContext, {
    selection: { type: "filter", filters: { ownerId: "me" } },
    changes: { nextStep: "Re-engage" },
    idempotencyKey: "opportunity-bulk:test-f029-replay",
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
            job_type: OPPORTUNITY_BULK_JOB_TYPE,
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
      enqueueOpportunityBulkUpdateJob(conflictingClient, scopedContext, {
        selection: { type: "filter", filters: { ownerId: "me" } },
        changes: { nextStep: "Re-engage" },
        idempotencyKey: "opportunity-bulk:test-f029-replay",
      }),
    (error) => error?.code === "CRM_OPPORTUNITY_BULK_IDEMPOTENCY_CONFLICT",
  );
});

test("F029: worker execution context rehydrates current authorization and fails closed", async () => {
  const ownerClient = {
    async query(sql) {
      if (/FROM public\.organization_memberships/.test(sql)) {
        return {
          rows: [{
            user_id: user,
            role_slugs: ["organization_owner"],
            permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"],
          }],
        };
      }
      throw new Error(`Owner path should not require scoped company lookup: ${sql}`);
    },
  };
  const context = await resolveOpportunityBulkExecutionContext(ownerClient, org, {
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
    await resolveOpportunityBulkExecutionContext(revokedClient, org, {
      requesterUserId: user,
      activeCompanyId: company,
      activeBranchId: branch,
    }),
    null,
  );
});

test("F029: getOpportunityBulkJob scopes to the requester unless they can view all", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: jobId, job_type: OPPORTUNITY_BULK_JOB_TYPE, status: "processing", requested_by: user, progress: {}, result_manifest: {} }] };
    },
  };
  await getOpportunityBulkJob(client, scopedContext, jobId);
  const jobSelect = calls.find((call) => call.sql.includes("FROM tenant.background_jobs"));
  assert.match(jobSelect.sql, /requested_by=\$4/);

  const managerContext = { ...scopedContext, permissions: [...scopedContext.permissions, "crm.records.view_all"] };
  const managerCalls = [];
  const managerClient = {
    async query(sql, values) {
      managerCalls.push({ sql, values });
      return { rows: [{ id: jobId, job_type: OPPORTUNITY_BULK_JOB_TYPE, status: "processing", requested_by: user, progress: {}, result_manifest: {} }] };
    },
  };
  await getOpportunityBulkJob(managerClient, managerContext, jobId);
  const managerSelect = managerCalls.find((call) => call.sql.includes("FROM tenant.background_jobs"));
  assert.doesNotMatch(managerSelect.sql, /requested_by=/);
});

test("F029: synchronous updates and durable jobs share identical field/value validation", () => {
  const operations = read("src/modules/crm/opportunity-operations.js");
  const core = read("src/modules/crm/index.js");
  const migration = read("../../database/tenant/migrations/111_f029_opportunity_bulk_scale.sql");
  assert.match(operations, /normalizeOpportunityBulkChanges\(\s*client,\s*context,\s*input\.changes,?\s*\)/);
  assert.match(core, /snapshotOpportunityBulkJobSelection/);
  assert.match(core, /record\.status = 'open'/);
  assert.match(core, /ORDER BY record\.id/);
  assert.match(migration, /crm_opportunity_bulk_job_items/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});
