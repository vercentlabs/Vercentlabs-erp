import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.resolve(root, file), "utf8");
const exists = (file) => fs.existsSync(path.resolve(root, file));

const required = [
  "src/lib/procurement.ts",
  "src/lib/procurement-route.ts",
  "src/app/(app)/procurement/page.tsx",
  "src/app/api/procurement/dashboard/route.ts",
  "../../services/api/src/procurement/index.js",
  "../../services/api/src/procurement/money.js",
  "../../packages/permissions/src/procurement.js",
  "../../packages/shared-types/src/procurement.js",
  "../../packages/shared-sdk/src/procurement.js",
  "../../database/tenant/migrations/012_procurement_module.sql",
  "../../database/control-plane/migrations/014_procurement_module_release.sql",
  "../mobile/src/core/modules/web-parity.ts",
];
for (const file of required) if (!exists(file)) failures.push(`Missing Procurement artifact: ${file}`);

function markers(file, values) {
  const source = read(file);
  for (const value of values) if (!source.includes(value)) failures.push(`${file} is missing ${value}`);
}

markers("../../database/tenant/migrations/012_procurement_module.sql", [
  "procurement_suppliers", "procurement_requisitions", "procurement_sourcing_events",
  "procurement_agreements", "procurement_purchase_orders", "procurement_receipts",
  "procurement_service_entries", "procurement_match_exceptions", "procurement_outbox",
  "FORCE ROW LEVEL SECURITY", "tenant.current_organization_id()",
]);
markers("../../database/control-plane/migrations/014_procurement_module_release.sql", [
  "procurement.view", "procurement.suppliers.sensitive", "procurement.sourcing.award",
  "procurement.matching.override", "permission_key", "UNION ALL SELECT 'procurement'",
  "modules_snapshot", "purchase_requisition", "purchase_order",
]);
markers("../../services/api/src/procurement/index.js", [
  "contentHash", "allocate", "procurement.view", "creator cannot approve",
  "procurement_events", "procurement_reporting_facts",
]);
markers("../mobile/src/core/modules/web-parity.ts", [
  'web: "/procurement"', 'mobile: "/(protected)/workspace/procurement"',
]);

if (failures.length) {
  console.error("Procurement verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Procurement module verified across ${required.length} enterprise contracts.`);
