import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../../..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");

test("CRM overview remains driven by scoped getCrmDashboard data",()=>{
  const source=read("apps/web/src/app/(app)/crm/page.tsx");
  assert.match(source,/getCrmDashboard\(client, context\)/);
  assert.doesNotMatch(source,/CRM operating map|crm-overview-map|workspaceGroups/);
  assert.doesNotMatch(source,/Math\.random|mock KPI|sample data/i);
});

test("Lead create remains a dedicated full-page create workflow",()=>{
  const manager=read("apps/web/src/components/crm-resource-manager.tsx");
  assert.match(manager,/CrmLeadCreateWorkspace/);
  assert.match(manager,/definition\.key === "leads" && editing && !editing\.id && canManage/);
  const create=read("apps/web/src/components/crm-lead-create-workspace.tsx");
  assert.match(create,/\/api\/crm\/leads\/duplicates\?/);
  assert.match(create,/requestJson<CreateResponse>\("\/api\/crm\/leads"/);
});

test("Lead route suppresses the generic CRM heading for its dedicated workspace",()=>{
  const source=read("apps/web/src/app/(app)/crm/[resource]/page.tsx");
  assert.match(source,/const dedicatedLeadWorkspace = resource === "leads"/);
  assert.match(source,/!dedicatedLeadWorkspace/);
});
