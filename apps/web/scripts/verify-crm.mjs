import fs from "node:fs";
import path from "node:path";
const required = [
  "src/app/(app)/crm/page.tsx",
  "src/app/(app)/crm/[resource]/page.tsx",
  "src/app/(app)/crm/leads/[id]/page.tsx",
  "src/app/(app)/crm/opportunities/[id]/page.tsx",
  "src/app/(app)/crm/pipeline/page.tsx",
  "src/app/(app)/crm/reports/page.tsx",
  "src/app/(app)/crm/settings/page.tsx",
  "src/components/crm-resource-manager.tsx",
  "src/components/crm-pipeline-board.tsx",
  "src/lib/crm.ts",
  "src/lib/crm-validation.ts",
  "src/app/api/crm/[resource]/route.ts",
  "src/app/api/crm/leads/[id]/convert/route.ts",
  "src/app/api/crm/public/capture/[key]/route.ts",
  "../../database/control-plane/migrations/004_crm_permissions.sql",
  "../../database/tenant/migrations/002_crm_module.sql",
  "../../services/api/src/crm.js",
  "../../packages/shared-sdk/src/crm.js",
  "../../docs/architecture/crm-module.md",
];
for (const relative of required) {
  if (!fs.existsSync(path.resolve(process.cwd(), relative)))
    throw new Error(`Missing CRM path: ${relative}`);
}
const sql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "../../database/tenant/migrations/002_crm_module.sql",
  ),
  "utf8",
);
for (const marker of [
  "crm_leads",
  "crm_opportunities",
  "crm_activities",
  "crm_campaigns",
  "crm_communications",
  "crm_sequences",
  "crm_capture_forms",
  "crm_automation_rules",
  "crm_conversion_records",
  "FORCE ROW LEVEL SECURITY",
]) {
  if (!sql.includes(marker))
    throw new Error(`CRM migration is missing ${marker}`);
}
const service = fs.readFileSync(
  path.resolve(process.cwd(), "../../services/api/src/crm.js"),
  "utf8",
);
for (const marker of [
  "convertCrmLead",
  "mergeCrmLead",
  "moveOpportunityStage",
  "calculateLeadScore",
  "resolveLeadOwner",
  "runCrmAutomation",
  "captureCrmLead",
  "getCrmReport",
]) {
  if (!service.includes(marker))
    throw new Error(`CRM service is missing ${marker}`);
}
console.log(`CRM module verified across ${required.length} permanent paths.`);
