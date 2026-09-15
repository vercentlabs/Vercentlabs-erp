import assert from "node:assert/strict";
import test from "node:test";

import {
  commitLeadImport,
  previewLeadImport,
  rollbackLeadImport,
} from "../src/modules/crm/prospect-and-relationship-master-data/lead-acquisition.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const batch = "55555555-5555-4555-8555-555555555555";
const importedLead = "66666666-6666-4666-8666-666666666666";

const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: branch, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.leads.manage"] };

const VALID_ROW = { firstName: "Priya", lastName: "Nair", email: "priya@example.com", companyName: "Acme" };

// A permissive fallback for queries this file doesn't assert on directly
// (duplicate-matching's identity lock, source resolution, assignment
// resolution) — each of those degrades gracefully to "nothing found" when
// given empty results, which is the real, intended behavior for a plain
// import row with no configured source/owner, not a shortcut around it.
function fallbackRows(sql) {
  // evaluateLeadDuplicateRisk's normalizeInput() — a real Postgres
  // function call (tenant.crm_normalize_email/phone/comparison_text)
  // that always returns exactly one row shaping its input; with no
  // strong identity signals normalized, its own early-return path
  // (classification: "none") applies without ever reaching the
  // duplicate-search SELECT below.
  if (sql.includes("crm_normalize_email")) return { rows: [{ email: null, mobile: null, business_phone: null, name: null, company: null }] };
  if (sql.includes("FROM tenant.crm_leads") && sql.includes("normalized_email")) return { rows: [] }; // duplicate match search
  if (sql.includes("dismissed")) return { rows: [] };
  return { rows: [] };
}

function createClient({ queries = {}, existingBatch = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      for (const [pattern, handler] of Object.entries(queries)) {
        if (sql.includes(pattern)) return handler(values);
      }
      if (sql.includes("FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND content_hash=$2"))
        return { rows: existingBatch ? [existingBatch] : [] };
      if (sql.includes("crm_leads") && !sql.includes("INSERT INTO")) return fallbackRows(sql);
      if (sql.includes("INSERT INTO tenant.crm_leads")) return { rows: [{ id: importedLead }] };
      return fallbackRows(sql);
    },
  };
}

test("F021: previewLeadImport validates rows via the real normalizeLeadFieldMapping/validateLeadImportRows contract — a row missing firstName is invalid, not silently dropped", async () => {
  const client = createClient({
    queries: {
      "INSERT INTO tenant.crm_lead_import_batches": (values) => ({ rows: [{ id: batch, status: "previewed", total_rows: values[7], valid_rows: values[8], invalid_rows: values[9] }] }),
      "INSERT INTO tenant.crm_lead_import_rows": () => ({ rows: [], rowCount: 1 }),
    },
  });
  const result = await previewLeadImport(client, context, { rows: [VALID_ROW, { lastName: "NoFirstName" }], fieldMapping: {} });
  assert.equal(result.batch.total_rows, 2);
  assert.equal(result.batch.valid_rows, 1);
  assert.equal(result.batch.invalid_rows, 1);
  assert.equal(result.rows[1].valid, false);
  assert.ok(result.rows[1].errors.some((e) => e.field === "firstName"));
});

test("F021: previewLeadImport persists NO Lead records — only batch/row staging tables", async () => {
  const client = createClient({
    queries: {
      "INSERT INTO tenant.crm_lead_import_batches": () => ({ rows: [{ id: batch, status: "previewed", total_rows: 1, valid_rows: 1, invalid_rows: 0 }] }),
      "INSERT INTO tenant.crm_lead_import_rows": () => ({ rows: [], rowCount: 1 }),
    },
  });
  await previewLeadImport(client, context, { rows: [VALID_ROW], fieldMapping: {} });
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_leads")), "preview must never create a real Lead row");
});

test("F021: previewLeadImport is idempotent by content hash — the SAME rows/mapping/strategy replay the SAME batch instead of creating a second one", async () => {
  const existingBatch = { id: batch, status: "previewed", total_rows: 1, valid_rows: 1, invalid_rows: 0, content_hash: "replay" };
  const client = createClient({ existingBatch });
  const result = await previewLeadImport(client, context, { rows: [VALID_ROW], fieldMapping: {} });
  assert.equal(result.idempotent, true);
  assert.equal(result.batch.id, batch);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_lead_import_batches")), "a content-hash replay must not create a second batch");
});

test("F021: previewLeadImport rejects a batch larger than 5,000 rows before any query runs", async () => {
  const client = createClient();
  const rows = Array.from({ length: 5001 }, () => VALID_ROW);
  await assert.rejects(() => previewLeadImport(client, context, { rows, fieldMapping: {} }));
  assert.equal(client.calls.length, 0);
});

test("F021: commitLeadImport only accepts a batch in 'previewed' status", async () => {
  const client = createClient({
    queries: {
      "SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE": () => ({ rows: [{ id: batch, status: "completed", duplicate_strategy: "skip", company_id: company, branch_id: branch }] }),
    },
  });
  await assert.rejects(() => commitLeadImport(client, context, batch), /Only a previewed import can be committed/);
});

test("F021: commitLeadImport 404s for a nonexistent batch", async () => {
  const client = createClient({
    queries: {
      "SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE": () => ({ rows: [] }),
    },
  });
  await assert.rejects(() => commitLeadImport(client, context, batch), /not found/i);
});

test("F021: commitLeadImport creates a real Lead per valid row through the real createLead command (not a bulk INSERT that bypasses it) and records import provenance", async () => {
  const client = createClient({
    queries: {
      "SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE": () => ({ rows: [{ id: batch, status: "previewed", duplicate_strategy: "skip", company_id: company, branch_id: branch, created_rows: 0 }] }),
      "SELECT * FROM tenant.crm_lead_import_rows WHERE organization_id=$1 AND batch_id=$2": () => ({
        rows: [{ id: "77777777-7777-4777-8777-777777777777", row_number: 1, action: "pending", normalized_data: VALID_ROW, raw_data: VALID_ROW }],
      }),
      "UPDATE tenant.crm_lead_import_rows SET action=$3,result_lead_id=$4": () => ({ rows: [], rowCount: 1 }),
      "INSERT INTO tenant.crm_lead_provenance": () => ({ rows: [], rowCount: 1 }),
      "UPDATE tenant.crm_lead_import_batches SET status=$3,created_rows=$4": (values) => ({ rows: [{ id: batch, status: values[2], created_rows: values[3], updated_rows: values[4], skipped_rows: values[5] }] }),
    },
  });
  const result = await commitLeadImport(client, context, batch);
  assert.equal(result.status, "completed");
  assert.equal(result.created_rows, 1);
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_leads")), "each valid row must go through the real governed lead-creation path");
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_lead_provenance")), "a created Lead must be traceable back to this import batch");
});

test("F021: commitLeadImport counts an already-'error' row as failed without attempting to create a Lead for it", async () => {
  const client = createClient({
    queries: {
      "SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE": () => ({ rows: [{ id: batch, status: "previewed", duplicate_strategy: "skip", company_id: company, branch_id: branch, created_rows: 0 }] }),
      "SELECT * FROM tenant.crm_lead_import_rows WHERE organization_id=$1 AND batch_id=$2": () => ({
        rows: [{ id: "88888888-8888-4888-8888-888888888888", row_number: 2, action: "error", normalized_data: {}, raw_data: {} }],
      }),
      "UPDATE tenant.crm_lead_import_batches SET status=$3,created_rows=$4": (values) => ({ rows: [{ id: batch, status: values[2], created_rows: values[3], updated_rows: values[4], skipped_rows: values[5] }] }),
    },
  });
  const result = await commitLeadImport(client, context, batch);
  assert.equal(result.status, "completed_with_errors");
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_leads")));
});

test("F021: rollbackLeadImport only accepts a completed (or completed_with_errors) batch", async () => {
  const client = createClient({
    queries: {
      "SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE": () => ({ rows: [{ id: batch, status: "previewed" }] }),
    },
  });
  await assert.rejects(() => rollbackLeadImport(client, context, batch), /Only a completed import can be rolled back/);
});

test("F021: rollbackLeadImport deletes only the leads this batch created (via provenance), and protects any that already have recorded activity", async () => {
  const client = createClient({
    queries: {
      "SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE": () => ({ rows: [{ id: batch, status: "completed", created_rows: 3 }] }),
      "DELETE FROM tenant.crm_leads lead USING tenant.crm_lead_provenance provenance": () => ({ rows: [{ id: importedLead }] }),
      "UPDATE tenant.crm_lead_import_batches SET status='rolled_back'": () => ({ rows: [], rowCount: 1 }),
    },
  });
  const result = await rollbackLeadImport(client, context, batch);
  assert.equal(result.rolledBack, 1);
  assert.equal(result.protected, 2, "batch claimed 3 created leads but only 1 was actually deletable — the other 2 must be reported as protected, not silently lost from the count");
  const del = client.calls.find(({ sql }) => sql.includes("DELETE FROM tenant.crm_leads"));
  assert.ok(del.sql.includes("NOT EXISTS"), "rollback must exclude leads with recorded activity, not delete unconditionally");
});
