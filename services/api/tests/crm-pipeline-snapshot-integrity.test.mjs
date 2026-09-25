import assert from "node:assert/strict";
import test from "node:test";

import { capturePipelineSnapshots, listPipelineSnapshots } from "../src/modules/crm/opportunity-and-pipeline-governance/pipeline-snapshots.js";

// F010 integrity closeout: historical pipeline snapshots (dossier
// F010-CAP-002 / DEC-CRM-P1-F010, a REQUIRED enterprise-scope item). These
// tests prove capture's idempotency/scope/currency handling and
// retrieval's permission/company boundary — not just that the function
// runs without throwing.

const org = "11111111-1111-4111-8111-111111111111";
const pipelineA = "22222222-2222-4222-8222-222222222222";
const companyA = "33333333-3333-4333-8333-333333333333";
const companyB = "44444444-4444-4444-8444-444444444444";
const stageId = "55555555-5555-4555-8555-555555555555";

const systemContext = {
  organizationId: org,
  userId: null,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: [],
  roleSlugs: ["system_worker"],
};

function mockClient({ pipelines = [pipelineA], aggregatesByPipeline = {} } = {}) {
  const queries = [];
  const scheduledSeen = new Set();
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT id FROM tenant\.crm_pipelines/.test(sql)) {
        return { rows: pipelines.map((id) => ({ id })) };
      }
      if (/FROM tenant\.crm_opportunities record/.test(sql)) {
        const pipelineId = values[1];
        return { rows: aggregatesByPipeline[pipelineId] || [] };
      }
      if (/INSERT INTO tenant\.crm_pipeline_stage_snapshots/.test(sql)) {
        const [organizationId, pipelineId, companyId, stageIdValue, currencyCode, snapshotDate, , , , source] = values;
        if (source === "scheduled") {
          const key = [organizationId, pipelineId, companyId || "null", stageIdValue, currencyCode, snapshotDate].join("|");
          if (scheduledSeen.has(key)) return { rows: [] };
          scheduledSeen.add(key);
        }
        return { rows: [{ id: `snap-${queries.length}` }] };
      }
      if (/INSERT INTO tenant\.crm_outbox_events/.test(sql)) return { rows: [] };
      if (/^\s*SELECT snap\.\*/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

function aggregateRow(overrides = {}) {
  return {
    company_id: companyA,
    stage_id: stageId,
    currency_code: "INR",
    opportunity_count: 3,
    amount: "150000.00",
    weighted_amount: "45000.00",
    ...overrides,
  };
}

test("capturePipelineSnapshots: same scope/date captured twice produces one logical snapshot (no duplicate rows written the second time)", async () => {
  const client = mockClient({ aggregatesByPipeline: { [pipelineA]: [aggregateRow()] } });
  const first = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09" });
  const second = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09" });
  assert.equal(first.rowsWritten, 1);
  assert.equal(second.rowsWritten, 0, "the second capture for the same scope/date must write nothing new");
  assert.equal(second.rowsSkippedDuplicate, 1);
});

test("capturePipelineSnapshots: different dates produce independent snapshots", async () => {
  const client = mockClient({ aggregatesByPipeline: { [pipelineA]: [aggregateRow()] } });
  const day1 = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-08" });
  const day2 = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09" });
  assert.equal(day1.rowsWritten, 1);
  assert.equal(day2.rowsWritten, 1, "a different snapshot_date must not be treated as a duplicate of the prior day");
});

test("capturePipelineSnapshots: aggregates group by company — Company A and Company B rows are captured as distinct snapshot rows, never merged", async () => {
  const client = mockClient({
    aggregatesByPipeline: {
      [pipelineA]: [aggregateRow({ company_id: companyA }), aggregateRow({ company_id: companyB, opportunity_count: 2, amount: "20000.00", weighted_amount: "6000.00" })],
    },
  });
  const result = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09" });
  assert.equal(result.rowsWritten, 2);
  const inserts = client.queries.filter((q) => q.sql.includes("INSERT INTO tenant.crm_pipeline_stage_snapshots"));
  const companyIds = inserts.map((q) => q.values[2]);
  assert.deepEqual(new Set(companyIds), new Set([companyA, companyB]));
  // Confirms the aggregate itself is grouped by company_id in SQL, not
  // merged/re-aggregated in application code after the fact.
  const aggregateQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_opportunities record"));
  assert.match(aggregateQuery.sql, /GROUP BY record\.company_id, record\.stage_id/);
});

test("capturePipelineSnapshots: the underlying aggregate query has no LIMIT — correct for a pipeline with more than 500 open Opportunities, since the whole set is collapsed by GROUP BY before any row is persisted", async () => {
  const client = mockClient({ aggregatesByPipeline: { [pipelineA]: [aggregateRow({ opportunity_count: 812 })] } });
  await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09" });
  const aggregateQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_opportunities record"));
  assert.doesNotMatch(aggregateQuery.sql, /LIMIT/i);
});

test("capturePipelineSnapshots: multiple currencies for the same stage are persisted as separate rows, never summed together", async () => {
  const client = mockClient({
    aggregatesByPipeline: {
      [pipelineA]: [
        aggregateRow({ currency_code: "INR", amount: "150000.00" }),
        aggregateRow({ currency_code: "USD", amount: "2000.00", opportunity_count: 1, weighted_amount: "500.00" }),
      ],
    },
  });
  const result = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09" });
  assert.equal(result.rowsWritten, 2);
  const inserts = client.queries.filter((q) => q.sql.includes("INSERT INTO tenant.crm_pipeline_stage_snapshots"));
  const currencies = inserts.map((q) => q.values[4]).sort();
  assert.deepEqual(currencies, ["INR", "USD"]);
});

test("capturePipelineSnapshots: a manual capture on the same day as an existing scheduled snapshot is not deduplicated against it (deliberately separate identities)", async () => {
  const client = mockClient({ aggregatesByPipeline: { [pipelineA]: [aggregateRow()] } });
  const scheduled = await capturePipelineSnapshots(client, systemContext, { snapshotDate: "2026-09-09", source: "scheduled" });
  const salesHead = { ...systemContext, userId: "66666666-6666-4666-8666-666666666666", permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"] };
  const manual = await capturePipelineSnapshots(client, salesHead, { snapshotDate: "2026-09-09", source: "manual", capturedBy: "66666666-6666-4666-8666-666666666666" });
  assert.equal(scheduled.rowsWritten, 1);
  assert.equal(manual.rowsWritten, 1, "a manual capture must not be silently absorbed by the scheduled day's dedupe key");
});

test("capturePipelineSnapshots: a team-scoped manager cannot trigger a manual capture — it aggregates company-wide deals they cannot see", async () => {
  const client = mockClient({ aggregatesByPipeline: { [pipelineA]: [aggregateRow()] } });
  const manager = { ...systemContext, userId: "66666666-6666-4666-8666-666666666666", allowAllCompanies: false, activeCompanyId: null, roleSlugs: [], permissions: ["crm.view", "crm.opportunities.manage"] };
  await assert.rejects(capturePipelineSnapshots(client, manager, { source: "manual", pipelineId: pipelineA }), { code: "CRM_PIPELINE_SNAPSHOT_FORBIDDEN" });
});

test("listPipelineSnapshots: a caller who can view all CRM records (e.g. Sales Head) can retrieve snapshot history", async () => {
  const client = mockClient();
  const head = { ...systemContext, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"] };
  await assert.doesNotReject(listPipelineSnapshots(client, head, { pipelineId: pipelineA }));
});

test("listPipelineSnapshots: a team-scoped manager or seller with crm.opportunities.manage but not view-all is refused — company totals would leak", async () => {
  const client = mockClient();
  const manager = { ...systemContext, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.view", "crm.opportunities.manage"] };
  await assert.rejects(listPipelineSnapshots(client, manager, { pipelineId: pipelineA }), (error) => error.status === 403 && error.code === "CRM_PIPELINE_SNAPSHOT_FORBIDDEN");
});

test("listPipelineSnapshots: an unauthorized seller (crm.view only) cannot access pipeline history at all — 403, not a filtered/empty result", async () => {
  const client = mockClient();
  const seller = { ...systemContext, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.view"] };
  await assert.rejects(
    listPipelineSnapshots(client, seller, { pipelineId: pipelineA }),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, "CRM_PIPELINE_SNAPSHOT_FORBIDDEN");
      return true;
    },
  );
});

test("listPipelineSnapshots: a company-restricted view-all caller (Sales Head) is still scoped to their own company (or company-unassigned rows), not org-wide", async () => {
  const client = mockClient();
  const manager = {
    organizationId: org,
    userId: "77777777-7777-4777-8777-777777777777",
    activeCompanyId: companyA,
    activeBranchId: null,
    allowAllCompanies: false,
    permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"],
    roleSlugs: [],
  };
  await listPipelineSnapshots(client, manager, { pipelineId: pipelineA });
  const listQuery = client.queries.find((q) => q.sql.includes("SELECT snap.*"));
  assert.match(listQuery.sql, /snap\.company_id IS NULL OR snap\.company_id=\$/);
  assert.ok(listQuery.values.includes(companyA));
});
