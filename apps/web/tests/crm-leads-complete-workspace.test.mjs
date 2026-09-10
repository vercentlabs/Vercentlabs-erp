import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../../..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");

test("Leads have dedicated queue and create workspaces",()=>{
  const manager=read("apps/web/src/modules/crm/crm-data-operations-and-customization/resource-manager.tsx");
  assert.match(manager,/CrmLeadsWorkspace/);
  assert.match(manager,/CrmLeadCreateWorkspace/);
});

test("Lead queue exposes Table, Kanban, filters, saved views and bulk update",()=>{
  const source=read("apps/web/src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  for(const token of ["kanban","ownerId","sourceId","priority","rating","followup","/api/crm/leads/views","bulk-update"])
    assert.match(source,new RegExp(token));
});

test("Lead queue preserves existing import/export/open/edit/archive contracts",()=>{
  const source=read("apps/web/src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  assert.match(source,/\/api\/crm\/leads\/export/);
  assert.match(source,/onImport\(file\)/);
  assert.match(source,/onEdit\(row\)/);
  assert.match(source,/onArchive\(id\)/);
  assert.match(source,/\/crm\/leads\/\$\{id\}/);
});

test("Lead edit keeps lifecycle and ownership fields separate from governed qualification and assignment actions",()=>{
  const editor=read("apps/web/src/modules/crm/prospect-and-relationship-master-data/lead-edit-panel.tsx");
  const ownerDialog=read("apps/web/src/modules/crm/prospect-and-relationship-master-data/lead-owner-dialog.tsx");
  for(const field of ["firstName","companyName","email","mobile","sourceId","priority","rating","estimatedValue","productInterest","nextFollowUpAt","consentEmail","doNotContact"])
    assert.match(editor,new RegExp(`"${field}"`),field);
  assert.doesNotMatch(editor,/"ownerUserId"/);
  assert.match(ownerDialog,/ownerUserId:\s*selected\.id/);
  assert.doesNotMatch(editor,/"unqualifiedReason"/);
  assert.doesNotMatch(editor,/"qualificationState"/);
  assert.match(read("apps/web/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification-card.tsx"),/Mark unqualified/);
});

test("Small screens get a purpose-built Lead card list instead of a desktop table",()=>{
  const source=read("apps/web/src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  assert.match(source,/EnterpriseDataGrid/);
  assert.match(source,/renderMobileCard/);
});
