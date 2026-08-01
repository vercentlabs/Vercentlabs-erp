import assert from "node:assert/strict";
import fs from "node:fs";
const m = fs.readFileSync(
  "database/tenant/migrations/017_crm_lead_governance.sql",
  "utf8",
);
for (const name of [
  "crm_lead_record_types",
  "crm_lead_field_definitions",
  "crm_lead_layouts",
  "crm_lead_assignment_policies",
  "crm_lead_assignment_state",
])
  assert.match(m, new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${name}`));
assert.match(m, /FORCE ROW LEVEL SECURITY/g);
assert.match(m, /crm_leads ADD COLUMN IF NOT EXISTS record_type_id/);
const s = fs.readFileSync("services/api/src/crm/lead-governance.js", "utf8");
for (const fn of [
  "getLeadConfiguration",
  "validateLeadInput",
  "findLeadDuplicates",
  "resolveLeadOwner",
])
  assert.match(s, new RegExp(`export async function ${fn}`));
console.log("Stage 2B lead governance contract verified.");
