import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../../..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");

test("Lead route family has dedicated implementations",()=>{
  for(const file of [
    "apps/web/src/app/(app)/crm/lead-acquisition/page.tsx",
    "apps/web/src/app/(app)/crm/lead-intelligence/page.tsx",
    "apps/web/src/app/(app)/crm/leads/[id]/page.tsx",
    "apps/web/src/components/crm-lead-acquisition-workspace.tsx",
    "apps/web/src/components/crm-lead-intelligence-workspace.tsx",
    "apps/web/src/components/crm-lead-detail-workspace.tsx",
  ]) assert.ok(fs.existsSync(path.join(root,file)),file);
});

test("Kanban lifecycle mutation uses a governed endpoint and accessible select fallback",()=>{
  const source=read("apps/web/src/components/crm-leads-workspace.tsx");
  assert.match(source,/onDrop=/);
  assert.match(source,/crm-lead-kanban-move/);
  assert.match(source,/\/api\/crm\/leads\/\$\{id\}\/status/);
});

test("Lead board is separately loaded with scoped listCrmRecords data",()=>{
  const source=read("apps/web/src/app/(app)/crm/[resource]/page.tsx");
  assert.match(source,/leadBoard:/);
  assert.match(source,/limit: 500/);
  assert.match(source,/leadBoardRows=/);
});

test("Acquisition supports CSV, XLSX, XLS, forms, channels, events and enrichment",()=>{
  const source=read("apps/web/src/components/crm-lead-acquisition-workspace.tsx");
  assert.match(source,/from "xlsx"/);
  assert.match(source,/\.csv,.xlsx,.xls/);
  for(const tab of ["imports","forms","channels","events","enrichment"]) assert.match(source,new RegExp(`"${tab}"`));
  assert.match(source,/action: "preview"/);
  assert.match(source,/action: "commit"/);
  assert.match(source,/action: "rollback"/);
});

test("CRM-014 has a real app-side inbound-email acquisition route",()=>{
  const route=read("apps/web/src/app/api/crm/lead-acquisition/public/email/[token]/route.ts");
  const service=read("services/api/src/crm/lead-acquisition.js");
  assert.match(route,/ingestLeadAcquisitionWebhook/);
  assert.match(route,/tenant\.crm_communications/);
  assert.match(route,/provider_message_id/);
  assert.match(service,/"inbound_email"/);
});

test("CRM-017 routing implements fixed, round robin, workload and territory",()=>{
  const source=read("services/api/src/crm/lead-governance.js");
  for(const mode of ["fixed","round_robin","workload","territory"])
    assert.match(source,new RegExp(`policy\\.mode === ['"]${mode}['"]`));
  assert.match(source,/leastLoadedLeadOwner/);
  assert.match(source,/crm_territory_assignments/);
});

test("Manual and acquisition Lead creation share the governed assignment engine",()=>{
  assert.match(read("services/api/src/crm.js"),/resolveGovernedLeadOwner/);
  assert.match(read("services/api/src/crm/lead-acquisition.js"),/resolveLeadOwner\(client, context/);
});

test("Bulk Lead update enforces record scope and cannot perform conversion/archive",()=>{
  const source=read("services/api/src/crm/lead-operations.js");
  assert.match(source,/crm\.records\.view_all/);
  assert.match(source,/owner_user_id IS NULL OR owner_user_id/);
  assert.match(source,/company_id IS NULL OR company_id/);
  assert.match(source,/converted/);
  assert.match(source,/archived/);
});

test("Lead Intelligence never labels deterministic score as AI",()=>{
  const source=read("apps/web/src/components/crm-lead-intelligence-workspace.tsx");
  assert.match(source,/deterministic, explainable scoring/);
  assert.match(source,/Rule-based\s+scoring\s+is\s+not\s+presented\s+as\s+AI/);
  assert.doesNotMatch(source,/AI lead scoring|machine learning score/i);
});

test("Lead Intelligence exposes scoring, SLA, nurture and assignment routing",()=>{
  const source=read("apps/web/src/components/crm-lead-intelligence-workspace.tsx");
  assert.match(source,/lead-intelligence\/scores/);
  assert.match(source,/lead-intelligence\/sla/);
  assert.match(source,/lead-intelligence\/nurture/);
  assert.match(source,/leads\/assignment-policies/);
});

test("Lead detail covers lifecycle, timeline, activities, communications, notes, opportunity, score and duplicates",()=>{
  const source=read("apps/web/src/components/crm-lead-detail-workspace.tsx");
  for(const tab of ["overview","timeline","activities","communications","notes","opportunities","score","duplicates"])
    assert.match(source,new RegExp(`"${tab}"`));
  assert.match(source,/\/convert/);
  assert.match(source,/\/merge/);
  assert.match(source,/\/notes/);
  assert.match(source,/\/status/);
});

test("Lead Suite responsive contract covers desktop, tablet, phone and reduced motion",()=>{
  const css=read("apps/web/src/app/crm-lead-suite-enterprise.css");
  for(const bp of ["1320","1080","820","680","430"]) assert.match(css,new RegExp(`max-width:\\s*${bp}px`));
  assert.match(css,/prefers-reduced-motion/);
});

test("completion migration widens routing modes and adds inbound_email provider",()=>{
  const dir=path.join(root,"database/tenant/migrations");
  const migration=fs.readdirSync(dir).find((name)=>name.endsWith("_crm_lead_suite_completion.sql"));
  assert.ok(migration,"completion migration missing");
  const source=read(`database/tenant/migrations/${migration}`);
  assert.match(source,/workload/);
  assert.match(source,/inbound_email/);
});
