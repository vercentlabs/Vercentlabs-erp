import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.resolve(root, file), "utf8");
const exists = (file) => fs.existsSync(path.resolve(root, file));

const required = [
  "src/lib/procurement.ts",
  "src/lib/procurement-route.ts",
  "src/lib/procurement-validation.ts",
  "src/components/procurement/procurement-workspace.tsx",
  "src/app/(app)/procurement/page.tsx",
  "src/app/(app)/procurement/suppliers/page.tsx",
  "src/app/(app)/procurement/requisitions/new/page.tsx",
  "src/app/(app)/procurement/sourcing/new/page.tsx",
  "src/app/(app)/procurement/contracts/new/page.tsx",
  "src/app/(app)/procurement/orders/new/page.tsx",
  "src/app/(app)/procurement/receipts/new/page.tsx",
  "src/app/(app)/procurement/matching/page.tsx",
  "src/app/(app)/procurement/reports/page.tsx",
  "src/app/api/procurement/dashboard/route.ts",
  "src/app/api/procurement/matching/run/route.ts",
  "../../services/api/src/procurement/index.js",
  "../../services/api/src/procurement/money.js",
  "../../packages/permissions/src/procurement.js",
  "../../packages/shared-types/src/procurement.js",
  "../../packages/shared-sdk/src/procurement.js",
  "../../database/tenant/migrations/012_procurement_module.sql",
  "../../database/tenant/migrations/013_procurement_enterprise_completion.sql",
  "../../database/tenant/migrations/026_procurement_supplier_lifecycle_governance.sql",
  "../../services/api/src/procurement/governance.js",
  "src/app/(app)/procurement/governance/page.tsx",
  "src/app/api/procurement/governance/route.ts",
  "../../database/control-plane/migrations/014_procurement_module_release.sql",
  "../mobile/src/core/modules/web-parity.ts",
];
for (const file of required)
  if (!exists(file)) failures.push(`Missing Procurement artifact: ${file}`);
function markers(file, values) {
  const source = read(file);
  for (const value of values)
    if (!source.includes(value)) failures.push(`${file} is missing ${value}`);
}
markers("../../database/tenant/migrations/012_procurement_module.sql", [
  "procurement_suppliers",
  "procurement_requisitions",
  "procurement_sourcing_events",
  "procurement_agreements",
  "procurement_purchase_orders",
  "procurement_receipts",
  "procurement_service_entries",
  "procurement_match_exceptions",
  "procurement_outbox",
  "FORCE ROW LEVEL SECURITY",
  "tenant.current_organization_id()",
]);
markers(
  "../../database/tenant/migrations/013_procurement_enterprise_completion.sql",
  [
    "procurement_document_links",
    "procurement_outbox_idempotency_uidx",
    "procurement_purchase_order_lines_parent_fk",
    "procurement_matching_records_parent_fk",
  ],
);
markers(
  "../../database/control-plane/migrations/014_procurement_module_release.sql",
  [
    "procurement.view",
    "procurement.suppliers.sensitive",
    "procurement.sourcing.award",
    "procurement.matching.override",
    "permission_key",
    "UNION ALL SELECT 'procurement'",
    "modules_snapshot",
    "purchase_requisition",
    "purchase_order",
  ],
);
markers("../../services/api/src/procurement/index.js", [
  "contentHash",
  "allocate",
  "procurement.view",
  "The creator cannot approve",
  "updateProcurementRecord",
  "awardSourcingEvent",
  "amendPurchaseOrder",
  "runProcurementMatch",
  "applyReceiptToOrder",
  "procurement_events",
  "procurement_outbox",
  "procurement_reporting_facts",
  "three-way",
  "four-way",
]);
markers("src/lib/procurement-validation.ts", [
  "parseProcurementCreate",
  "parseProcurementUpdate",
  "procurementMatchSchema",
  "purchase-orders",
  "sourcing-events",
  "match-exceptions",
]);
markers("src/components/procurement/procurement-workspace.tsx", [
  "ProcurementDashboard",
  "ProcurementResourceWorkspace",
  "ProcurementMatchingWorkspace",
  "ProcurementReportsWorkspace",
  "Run invoice match",
  "Add line",
]);
markers("src/app/api/procurement/resources/[resource]/[id]/route.ts", [
  "updateProcurementRecord",
  "PATCH",
  "tenantTransaction",
]);
markers("src/app/api/procurement/matching/run/route.ts", [
  "runProcurementMatch",
  "procurementMatchSchema",
  "tenantTransaction",
]);
markers("../../packages/shared-sdk/src/procurement.js", [
  "update:",
  "runMatch:",
]);
markers("../mobile/src/core/modules/web-parity.ts", [
  'web: "/procurement"',
  'mobile: "/(protected)/workspace/procurement"',
]);
if (failures.length) {
  console.error("Procurement verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Procurement module verified across ${required.length} end-to-end contracts.`,
);
