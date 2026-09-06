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

test("Lead edit keeps lifecycle fields separate from the governed qualification action",()=>{
  const source=read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  for(const field of ["firstName","companyName","email","mobile","sourceId","ownerUserId","priority","rating","estimatedValue","productInterest","nextFollowUpAt","consentEmail","doNotContact"])
    assert.match(source,new RegExp(`"${field}"`),field);
  assert.doesNotMatch(source,/"unqualifiedReason"/);
  assert.doesNotMatch(source,/"qualificationState"/);
  assert.match(read("apps/web/src/modules/crm/components/lead-qualification-card.tsx"),/Mark unqualified/);
});

test("Small screens get a purpose-built Lead card list instead of a desktop table",()=>{
  const source=read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  assert.match(source,/EnterpriseDataGrid/);
  assert.match(source,/renderMobileCard/);
});
