import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../../..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");

test("Leads have dedicated queue and create workspaces",()=>{
  const manager=read("apps/web/src/modules/crm/components/resource-manager.tsx");
  assert.match(manager,/CrmLeadsWorkspace/);
  assert.match(manager,/CrmLeadCreateWorkspace/);
});

test("Lead queue exposes Table, Kanban, filters, saved views and bulk update",()=>{
  const source=read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  for(const token of ["kanban","ownerId","sourceId","priority","rating","followup","/api/crm/leads/views","bulk-update"])
    assert.match(source,new RegExp(token));
});

test("Lead queue preserves existing import/export/open/edit/archive contracts",()=>{
  const source=read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  assert.match(source,/\/api\/crm\/leads\/export/);
  assert.match(source,/onImport\(file\)/);
  assert.match(source,/onEdit\(row\)/);
  assert.match(source,/onArchive\(id\)/);
  assert.match(source,/\/crm\/leads\/\$\{id\}/);
});

test("Lead edit includes disqualification and canonical relationship fields",()=>{
  const source=read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  for(const field of ["firstName","companyName","email","mobile","sourceId","ownerUserId","status","unqualifiedReason","priority","rating","estimatedValue","productInterest","nextFollowUpAt","consentEmail","doNotContact"])
    assert.match(source,new RegExp(`"${field}"`),field);
});

test("Small screens get a purpose-built Lead card list instead of a desktop table",()=>{
  const source=read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  const css=read("apps/web/src/app/crm-lead-suite-enterprise.css");
  assert.match(source,/crm-leads-mobile-list/);
  assert.match(css,/\.crm-leads-table-scroll\s*\{\s*display:\s*none/);
  assert.match(css,/\.crm-leads-mobile-list\s*\{\s*display:\s*grid/);
});
