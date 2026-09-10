import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { updateOpportunityProbability } from "../src/modules/crm/index.js";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const opportunity = "44444444-4444-4444-8444-444444444444";
const updatedAt = "2026-08-27T00:00:00.000Z";
const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false, roleSlugs: ["sales_manager"], permissions: ["crm.view","crm.opportunities.manage","crm.records.view_all"] };
const row = (overrides={}) => ({ id: opportunity, organization_id: org, company_id: company, branch_id: null, owner_user_id: user, status: "open", amount: "1000.00", probability: "20.00", expected_revenue: "200.00", currency_code: "INR", updated_at: updatedAt, ...overrides });

function clientFor(current=row()) {
  const calls=[];
  return { calls, client: { async query(sql, values=[]) {
    calls.push({sql,values});
    if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'")) return {rows:[]};
    if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return {rows:[current]};
    if (sql.startsWith("UPDATE tenant.crm_opportunities")) return {rows:[row({probability:String(values[0]),expected_revenue:(1000*Number(values[0])/100).toFixed(2),updated_at:"2026-08-27T00:01:00.000Z"})]};
    if (sql.includes("INSERT INTO tenant.crm_opportunity_probability_history")) return {rows:[]};
    if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return {rows:[]};
    throw new Error(`Unexpected query: ${sql}`);
  }}};
}

test("F011 validates probability at the domain boundary", async () => {
  for (const value of [-1,100.01,20.001,Number.NaN]) await assert.rejects(() => updateOpportunityProbability({query:async()=>assert.fail("DB must not run")}, context, opportunity, value), (e)=>e.code==="CRM_OPPORTUNITY_PROBABILITY_INVALID");
});

test("F011 governed update is scoped, locked, atomic, historical and evented", async () => {
  const {client,calls}=clientFor();
  const updated=await updateOpportunityProbability(client,context,opportunity,72.5,"Buyer confirmed budget",{expectedUpdatedAt:updatedAt,expectedProbability:20});
  assert.equal(updated.probability,"72.5");
  assert.equal(Number(updated.expectedRevenue),725);
  assert.match(calls[0].sql,/FOR UPDATE/);
  assert.ok(calls.some(c=>c.sql.includes("crm_opportunity_probability_history")));
  assert.ok(calls.some(c=>c.sql.includes("crm_outbox_events")));
});

test("F011 desired-state replay is mutation-free even with an old retry token", async () => {
  const current=row({probability:"72.50",expected_revenue:"725.00",updated_at:"2026-08-27T00:01:00.000Z"});
  const {client,calls}=clientFor(current);
  const result=await updateOpportunityProbability(client,context,opportunity,72.5,null,{expectedUpdatedAt:updatedAt,expectedProbability:20});
  assert.equal(result.replayed,true);
  assert.equal(calls.length,1);
});

test("F011 a real probability change requires authoritative concurrency tokens", async () => {
  for (const expectations of [{},{expectedUpdatedAt:updatedAt},{expectedProbability:20}]) {
    const {client,calls}=clientFor();
    await assert.rejects(()=>updateOpportunityProbability(client,context,opportunity,50,null,expectations),(e)=>e.code==="CRM_PROBABILITY_VERSION_REQUIRED");
    assert.equal(calls.length,1);
  }
});

test("F011 stale version and stale probability fail before mutation", async () => {
  for (const expectations of [{expectedUpdatedAt:"2026-08-26T00:00:00.000Z",expectedProbability:20},{expectedUpdatedAt:updatedAt,expectedProbability:10}]) {
    const {client,calls}=clientFor();
    await assert.rejects(()=>updateOpportunityProbability(client,context,opportunity,50,null,expectations),(e)=>["CRM_STALE_WRITE","CRM_PROBABILITY_CONFLICT"].includes(e.code));
    assert.equal(calls.length,1);
  }
});

test("F011 closed opportunities cannot be repriced probabilistically", async () => {
  const {client,calls}=clientFor(row({status:"won"}));
  await assert.rejects(()=>updateOpportunityProbability(client,context,opportunity,50),(e)=>e.code==="CRM_OPPORTUNITY_PROBABILITY_CLOSED");
  assert.equal(calls.length,1);
});

test("F011 migration makes expected revenue generated and history tenant-safe", () => {
  const migration=read("database/tenant/migrations/066_crm_probability_expected_revenue_f011.sql");
  assert.match(migration,/expected_revenue numeric\(18,2\)[\s\S]*GENERATED ALWAYS AS/);
  assert.match(migration,/amount \* probability \/ 100/);
  assert.match(migration,/crm_opportunity_probability_history/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/BEFORE UPDATE OR DELETE/);
});

test("F011 reporting consumes canonical expected revenue and excludes closed deals from open forecast", () => {
  const service=read("services/api/src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js");
  assert.match(service,/sum\(opportunity\.expected_revenue\).*status = 'open'/s);
  assert.match(service,/sum\(opportunity\.amount\) FILTER \(WHERE opportunity\.status='open'\)/);
  assert.match(service,/sum\(opportunity\.expected_revenue\) FILTER \(WHERE opportunity\.status='open'\)/);
});

test("F011 expected revenue is derived and cannot be forged through generic create/update", async () => {
  const service=read("services/api/src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js");
  assert.match(service,/CRM_OPPORTUNITY_EXPECTED_REVENUE_DERIVED/);
  assert.match(service,/Expected revenue is calculated automatically/);
});

test("F011 does not reopen generic probability mutation", () => {
  const service=read("services/api/src/modules/crm/crm-data-operations-and-customization/record-policy.js");
  assert.match(service,/controlledFields[\s\S]*"probability"/);
  assert.match(service,/Use governed Opportunity actions/);
});
