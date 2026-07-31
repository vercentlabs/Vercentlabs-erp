import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const requiredPaths = [
  "database/tenant/migrations/013_procurement_enterprise_completion.sql",
  "services/api/src/procurement/index.js",
  "services/api/src/sales/index.js",
  "services/api/src/accounting/payables.js",
  "apps/web/src/components/procurement/procurement-workspace.tsx",
  "apps/web/src/app/api/procurement/matching/run/route.ts",
  "apps/web/src/app/api/accounting/payables/procurement-matches/[id]/import/route.ts",
  "apps/web/scripts/verify-sales.mjs",
  "apps/web/scripts/verify-sales-database.mjs",
  "apps/web/scripts/verify-procurement.mjs",
  "apps/web/scripts/verify-procurement-database.mjs",
  "docs/architecture/enterprise-module-completion.md",
];
for (const file of requiredPaths) {
  if (!exists(file)) failures.push(`Missing enterprise completion path: ${file}`);
}

function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${file} is missing: ${marker}`);
  }
}

const moduleSource = read("packages/shared-types/src/modules.js");
const entries = [...moduleSource.matchAll(/\{\s*key:\s*"([^"]+)"[\s\S]*?availability:\s*"([^"]+)"[\s\S]*?\}/g)]
  .map((match) => ({ key: match[1], availability: match[2] }));
const released = entries.filter((entry) => entry.availability === "released").map((entry) => entry.key).sort();
const roadmap = entries.filter((entry) => entry.availability === "roadmap").map((entry) => entry.key).sort();
const expectedReleased = ["accounting", "crm", "procurement", "sales"];
if (JSON.stringify(released) !== JSON.stringify(expectedReleased)) {
  failures.push(`Released module catalog must be ${expectedReleased.join(", ")}; found ${released.join(", ")}.`);
}
if (roadmap.length !== 8) failures.push(`Roadmap module count must be 8; found ${roadmap.length}.`);

requireMarkers("services/api/src/procurement/index.js", [
  "createProcurementRecord",
  "transitionProcurementRecord",
  "awardSourcingEvent",
  "amendPurchaseOrder",
  "runProcurementMatch",
  "procurement.vendor-bill.ready",
  "getProcurementReport",
]);
requireMarkers("services/api/src/sales/index.js", [
  "createQuotation",
  "convertQuotationToOrder",
  "amendSalesOrder",
  "completeFulfillmentRequest",
]);
requireMarkers("services/api/src/accounting/payables.js", [
  "importProcurementMatchAsVendorBill",
  "accounting.vendor_bill.imported_from_procurement",
  "accountingVendorBillId",
]);
requireMarkers("apps/web/src/components/procurement/procurement-workspace.tsx", [
  "/api/procurement/matching/run",
  "/api/accounting/payables/procurement-matches/",
  "Create Accounting vendor bill",
]);
requireMarkers("apps/web/src/app/api/readiness/route.ts", [
  '"014_procurement_module_release.sql"',
  '"013_procurement_enterprise_completion.sql"',
]);
requireMarkers("package.json", [
  '"verify:enterprise"',
  "verify:enterprise &&",
  '"db:verify:sales"',
  '"db:verify:procurement"',
]);
requireMarkers(".github/workflows/release-readiness.yml", [
  "pnpm db:verify:sales",
  "pnpm db:verify:accounting",
  "pnpm db:verify:procurement",
]);
requireMarkers("docs/api/openapi.yaml", [
  "/procurement/matching/run:",
  "/accounting/payables/procurement-matches/{id}/import:",
  "/sales/orders/{id}/actions:",
]);

const staleScopePatterns = [
  /CRM-only/i,
  /only CRM/i,
  /one released/i,
  /eleven roadmap/i,
  /eleven future modules/i,
  /3 released/i,
  /three (?:are )?released/i,
  /9 roadmap/i,
  /nine (?:are )?roadmap/i,
  /released end to end/i,
  /end-to-end release completion/i,
];
const scopeFiles = [
  "Readme.md",
  "apps/landing/src/app/modules/page.tsx",
  "apps/landing/src/app/pricing/page.tsx",
  "apps/landing/src/app/product/page.tsx",
  "apps/landing/src/app/workflows/page.tsx",
  "apps/landing/src/app/changelog/page.tsx",
  "apps/landing/src/app/modules/[slug]/page.tsx",
  "apps/landing/src/components/home/hero-section.tsx",
  "apps/landing/src/components/home/product-marketing-sections.tsx",
  "apps/landing/src/content/landing.ts",
  "docs/testing/manual-crm-acceptance.md",
  "docs/testing/manual-landing-acceptance.md",
];
for (const file of scopeFiles) {
  const source = read(file);
  for (const pattern of staleScopePatterns) {
    if (pattern.test(source)) failures.push(`${file} still contains stale release scope: ${pattern}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `Static enterprise release-contract checks passed: ${released.length} controlled early-access modules, ${roadmap.length} roadmap modules. This does not certify all benchmark capabilities or live end-to-end workflows.`,
);
