import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/sales/quotation-governance.js",
  "services/api/src/sales/quotation-governance.d.ts",
  "services/api/tests/sales-quotation-governance-stage4.test.mjs",
  "database/tenant/migrations/020_sales_quotation_governance.sql",
  "apps/web/src/app/api/sales/quotations/operations/route.ts",
  "apps/web/src/app/(app)/sales/quotations/page.tsx",
  "apps/web/scripts/verify-sales-quotation-governance-live.mjs",
  "docs/implementation/stages/STAGE_4_SALES_QUOTATION_GOVERNANCE.md",
];

for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is missing`);

const service = fs.readFileSync(
  "services/api/src/sales/quotation-governance.js",
  "utf8",
);
for (const symbol of [
  "evaluateQuotationHealth",
  "buildQuotationGovernanceSummary",
  "getQuotationGovernanceDashboard",
  "assessQuotationReadiness",
  "captureQuotationGovernanceSnapshot",
  "getQuotationGovernanceTimeline",
  "compareQuotationVersions",
  "bulkUpdateQuotations",
  "listQuotationSavedViews",
  "saveQuotationView",
  "deleteQuotationSavedView",
])
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));

const migration = fs.readFileSync(
  "database/tenant/migrations/020_sales_quotation_governance.sql",
  "utf8",
);
for (const table of [
  "sales_quotation_governance_policies",
  "sales_quotation_saved_views",
  "sales_quotation_governance_snapshots",
])
  assert.match(migration, new RegExp(`tenant\\.${table}`));
assert.match(migration, /FORCE ROW LEVEL SECURITY/);

const actions = fs.readFileSync(
  "apps/web/src/app/api/sales/quotations/[id]/actions/route.ts",
  "utf8",
);
assert.match(actions, /captureQuotationGovernanceSnapshot/);

const quotationsPage = fs.readFileSync(
  "apps/web/src/app/(app)/sales/quotations/page.tsx",
  "utf8",
);
assert.match(quotationsPage, /getQuotationGovernanceDashboard/);

const mobileParity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobileParity, /web: "\/sales\/quotations"/);
assert.match(mobileParity, /web: "\/sales\/quotations\/\[id\]"/);

console.log("Stage 4 Sales quotation governance contract verified.");
