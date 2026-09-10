import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../../..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");

test("F011 probability API preserves the protected write boundary",()=>{
  const route=read("apps/web/src/app/api/crm/opportunities/[id]/probability/route.ts");
  for (const token of ["assertSameOrigin","getSessionContext","crmOpportunitiesManage","requireBillingWriteAccess","assertCrmIdentifier","updateOpportunityProbabilitySchema.parse","tenantTransaction","updateOpportunityProbability","incrementBillingUsage","audit"]) assert.match(route,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(route,/crm\.opportunity\.probability_changed/);
});

test("F011 schema enforces percentage, precision, note and concurrency tokens",()=>{
  const validation=read("apps/web/src/modules/crm/crm-data-operations-and-customization/input-validation.ts");
  const start=validation.indexOf("updateOpportunityProbabilitySchema");
  const block=validation.slice(start,validation.indexOf("export const moveStageSchema",start));
  assert.match(block,/min\(0\)/); assert.match(block,/max\(100\)/); assert.match(block,/multipleOf\(0\.01\)/);
  assert.match(block,/expectedUpdatedAt: z\.string\(\)\.datetime\(\{ offset: true \}\)/);
  assert.match(block,/expectedProbability: z\.coerce\.number\(\)\.min\(0\)\.max\(100\)\.multipleOf\(0\.01\)/);
  assert.doesNotMatch(block,/expectedUpdatedAt:[^\n]*optional/);
  assert.match(block,/strict\(\)/); assert.match(block,/max\(1000\)/);
});

test("F011 detail uses canonical expected revenue and exposes governed probability workflow/history",()=>{
  const page=read("apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx");
  assert.match(page,/record\.expectedRevenue/);
  assert.match(page,/CrmOpportunityProbabilityAction/);
  // Prompts 1-5 integrity closeout (blocker B): the probability-history
  // query moved out of page.tsx into the canonical, web+mobile-shared
  // getOpportunityDetailData() projection.
  const detailData=read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-detail-data.ts");
  assert.match(detailData,/crm_opportunity_probability_history/);
  // Probability-history rendering moved into the tabbed Opportunity
  // workspace (Prompt 5) — the "Revenue confidence changes" label lives in
  // the History tab panel.
  const workspaceTabs=read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-workspace-tabs.tsx");
  assert.match(workspaceTabs,/Revenue confidence changes/);
  const component=read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-probability-action.tsx");
  assert.match(component,/expectedUpdatedAt: updatedAt/);
  assert.match(component,/expectedProbability: probability/);
  assert.match(component,/amount × probability/);
  assert.match(component,/destination stage&apos;s configured probability/);
});

test("F011 opportunity list exposes expected revenue but keeps probability out of generic form",()=>{
  const source=read("apps/web/src/modules/crm/crm-data-operations-and-customization/resource-definitions/opportunity-pipeline.ts");
  assert.match(source,/key: "expectedRevenue", label: "Expected revenue"/);
  assert.match(source,/name: "probability"[\s\S]*formHidden: true/);
});

test("F011 documentation/register remain canonical and reflect verified production-ready status",()=>{
  const spec=read("docs/03-modules/crm/features/F011-probability-and-expected-revenue.md");
  assert.match(spec,/Canonical ID: `F011`/);
  assert.match(spec,/Canonical name: \*\*Probability and expected revenue\*\*/i);
  assert.match(spec,/Implementation status: `IMPLEMENTED`/);
  assert.match(spec,/Product status: `PRODUCTION_READY`/);
  assert.match(read("docs/02-register/FEATURE_REGISTER.csv"),/^F011,CRM,Probability and expected revenue,SPECIFICATION_READY,IMPLEMENTED,PRODUCTION_READY,/m);
});
