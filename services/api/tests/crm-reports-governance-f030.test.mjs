import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCrmReport } from "../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js";

// F030 — reports: validated periods, a reproducible fingerprint, and governed
// (audited) exports. No tenant SQL: only fixed report keys are served.

const context = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: [] };
const rows = [{ stage_id: "s1", name: "Proposal", count: 3, amount: "100" }];
const client = () => ({ async query() { return { rows: rows.map((row) => ({ ...row })) }; } });

test("F030: a malformed or inverted period is a clear 400, never a database cast error", async () => {
  await assert.rejects(getCrmReport(client(), context, "pipeline", { from: "'; DROP TABLE x" }), (e) => e.status === 400 && e.code === "CRM_REPORT_DATE_INVALID");
  await assert.rejects(getCrmReport(client(), context, "pipeline", { from: "2026-09-30", to: "2026-09-01" }), (e) => e.code === "CRM_REPORT_DATE_RANGE_INVALID");
});

test("F030: the same data, report and period give the same fingerprint; a different period does not", async () => {
  const a = await getCrmReport(client(), context, "pipeline", { from: "2026-09-01", to: "2026-09-30" });
  const b = await getCrmReport(client(), context, "pipeline", { from: "2026-09-01", to: "2026-09-30" });
  const c = await getCrmReport(client(), context, "pipeline", { from: "2026-08-01", to: "2026-09-30" });
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.ok(Date.parse(a.generatedAt));
});

test("F030: only fixed report keys run — an unknown key is a 404, there is no tenant-supplied SQL", async () => {
  await assert.rejects(getCrmReport(client(), context, "select * from tenant.crm_leads", {}), (e) => e.status === 404);
});

test("F030: every CSV export is audited and carries the fingerprint", () => {
  const route = readFileSync(new URL("../../../apps/web/src/app/api/crm/reports/[report]/export/route.ts", import.meta.url), "utf8");
  assert.match(route, /eventType: "crm\.report\.exported"/);
  assert.match(route, /"X-Report-Fingerprint"/);
  assert.match(route, /CRM_PERMISSIONS\.reportsView/);
});
