import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrmLeadExportCsv,
  completeCrmLeadExportJob,
  enqueueCrmLeadExportJob,
  getCrmLeadExportJob,
  LEAD_EXPORT_JOB_TYPE,
} from "../src/modules/crm/prospect-and-relationship-master-data/lead-export.js";

const org = "11111111-1111-4111-8111-111111111111";
const requester = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";
const ownerId = "66666666-6666-4666-8666-666666666666";

const context = { organizationId: org, userId: requester, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.manage"] };

function createClient({ leadRows = [], ownerRows = [], jobRow = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT INTO tenant.background_jobs")) return { rows: [{ id: jobId, organization_id: org, job_type: LEAD_EXPORT_JOB_TYPE, status: "pending", payload: JSON.parse(values[2]) }] };
      if (sql.includes("FROM tenant.background_jobs")) return { rows: jobRow ? [jobRow] : [] };
      if (sql.startsWith("SELECT count(*)::int AS total FROM tenant.crm_leads")) return { rows: [{ total: leadRows.length }] };
      if (sql.startsWith("SELECT record.* FROM tenant.crm_leads")) return { rows: leadRows };
      if (sql.includes("FROM public.users WHERE id = ANY")) return { rows: ownerRows };
      if (sql.startsWith("UPDATE tenant.background_jobs")) return { rows: [{ id: jobId }] };
      return { rows: [] };
    },
  };
}

// F021 Stage A2 §9. Real, async job-based export — replaces the prior
// client-side "fetch every page then build CSV in the browser" approach,
// which had no formula-injection protection at all (its local csvField
// helper only escaped quotes/commas/newlines, never neutralized a
// leading =/+/-/@). buildCrmLeadExportCsv now uses rowsToCsv/csvCell
// (@vercentlabs/reporting-engine), the correctly-neutralizing shared
// writer already used elsewhere in the platform for exactly this reason.

test("F021: enqueueCrmLeadExportJob inserts a background_jobs row with the real job type and a filters snapshot, not a caller-trusted permission set", async () => {
  const client = createClient();
  const job = await enqueueCrmLeadExportJob(client, context, { filters: { status: "open", evil: "dropped" } });
  assert.equal(job.job_type, LEAD_EXPORT_JOB_TYPE);
  const insert = client.calls.find(({ sql }) => sql.startsWith("INSERT INTO tenant.background_jobs"));
  const payload = JSON.parse(insert.values[2]);
  assert.equal(payload.requesterUserId, requester);
  assert.deepEqual(payload.filters, { status: "open" });
  assert.equal(payload.filters.evil, undefined, "only the allowlisted filter keys may be snapshotted into the job payload");
});

test("F021: getCrmLeadExportJob allows the requester but rejects a different org member without view_all", async () => {
  const jobRow = { id: jobId, organization_id: org, job_type: LEAD_EXPORT_JOB_TYPE, requested_by: requester, status: "completed" };
  const client = createClient({ jobRow });
  const job = await getCrmLeadExportJob(client, context, jobId);
  assert.equal(job.id, jobId);
  const strangerContext = { ...context, userId: other, permissions: ["crm.leads.manage"] };
  await assert.rejects(() => getCrmLeadExportJob(client, strangerContext, jobId), /do not have access/);
});

test("F021: getCrmLeadExportJob allows a view_all holder to read someone else's export job", async () => {
  const jobRow = { id: jobId, organization_id: org, job_type: LEAD_EXPORT_JOB_TYPE, requested_by: requester, status: "completed" };
  const client = createClient({ jobRow });
  const viewAllContext = { ...context, userId: other, permissions: ["crm.leads.manage", "crm.records.view_all"] };
  const job = await getCrmLeadExportJob(client, viewAllContext, jobId);
  assert.equal(job.id, jobId);
});

test("F021: buildCrmLeadExportCsv reuses listCrmRecords's real query shape, resolves owner display names, and neutralizes a formula-injection payload via the shared csvCell writer", async () => {
  const client = createClient({
    leadRows: [
      { id: leadId, code: "LD-0001", first_name: "=cmd|'/c calc'!A1", last_name: "Rao", email: "rao@example.com", status: "open", priority: "high", rating: "hot", owner_user_id: ownerId, estimated_value: "1000.00", currency_code: "INR", city: "Pune", state: "MH", country_code: "IN", created_at: "2026-09-01T00:00:00.000Z" },
    ],
    ownerRows: [{ id: ownerId, full_name: "Asha Mehta" }],
  });
  const { csv, rowCount, truncated } = await buildCrmLeadExportCsv(client, context, {});
  assert.equal(rowCount, 1);
  assert.equal(truncated, false);
  assert.match(csv, /Asha Mehta/, "owner name must be resolved, not left as a raw ownerUserId");
  // The malicious firstName cell must be prefixed with a leading apostrophe
  // (OWASP CSV-injection mitigation) — never emitted as a live formula.
  assert.match(csv, /'=cmd/);
  assert.doesNotMatch(csv, /(?<!')=cmd/);
});

test("F021: completeCrmLeadExportJob writes a light summary to progress and the full manifest (including csv) to result_manifest, not the same payload twice", async () => {
  const client = createClient();
  await completeCrmLeadExportJob(client, jobId, org, { csv: "a,b\n1,2\n", rowCount: 1, truncated: false });
  const update = client.calls.find(({ sql }) => sql.startsWith("UPDATE tenant.background_jobs"));
  const [, , progressJson, manifestJson] = update.values;
  const progress = JSON.parse(progressJson);
  const manifest = JSON.parse(manifestJson);
  assert.equal(progress.csv, undefined, "progress must stay small — no file content, for cheap status polling");
  assert.equal(manifest.csv, "a,b\n1,2\n");
  assert.equal(manifest.rowCount, 1);
  assert.ok(manifest.expiresAt, "an export must carry a real expiry, not be downloadable forever");
});
