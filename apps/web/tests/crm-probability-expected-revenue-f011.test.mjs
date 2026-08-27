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
  const validation=read("apps/web/src/modules/crm/validation.ts");
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
  assert.match(page,/crm_opportunity_probability_history/);
  assert.match(page,/Revenue confidence changes/);
  const component=read("apps/web/src/modules/crm/components/opportunity-probability-action.tsx");
  assert.match(component,/expectedUpdatedAt: updatedAt/);
  assert.match(component,/expectedProbability: probability/);
  assert.match(component,/amount × probability/);
  assert.match(component,/destination stage&apos;s configured probability/);
});

test("F011 opportunity list exposes expected revenue but keeps probability out of generic form",()=>{
  const source=read("apps/web/src/modules/crm/index.ts");
  assert.match(source,/key: "expectedRevenue", label: "Expected revenue"/);
  assert.match(source,/name: "probability"[\s\S]*formHidden: true/);
});

test("F011 documentation and registers keep adjacent features unclaimed",()=>{
  const spec=read("docs/erp-510/02-feature-specs/ERP-011.md");
  assert.match(spec,/F012 Sales Stages/); assert.match(spec,/F024 Pipeline Dashboard/); assert.match(spec,/F025 Sales Forecast/); assert.match(spec,/not claimed/i);
  assert.match(read("docs/erp-510/CURRENT_FEATURE.md"),/Feature ID: F011/);
});
