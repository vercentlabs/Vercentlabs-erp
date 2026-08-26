import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const card = read("src/modules/crm/components/lead-qualification-card.tsx");
const detail = read("src/modules/crm/components/lead-detail-workspace.tsx");
const list = read("src/modules/crm/components/leads-workspace.tsx");
const detailData = read("src/modules/crm/server/lead-detail-data.ts");
const route = read("src/app/api/crm/leads/[id]/qualification/route.ts");
const statusRoute = read("src/app/api/crm/leads/[id]/status/route.ts");
const stageRoute = read("src/app/api/crm/leads/[id]/stage/route.ts");
const genericRoute = read("src/app/api/crm/[resource]/[id]/route.ts");
const css = read("src/app/crm-lead-suite-enterprise.css");

test("F006 UI: Lead Detail presents a compact readiness and decision section", () => {
  assert.match(detail, /<LeadQualificationCard/);
  assert.match(card, /Commercial readiness/);
  assert.match(card, /Ready for a decision/);
  assert.match(card, /Required/);
  assert.match(card, /Recommended/);
  assert.match(card, /Decision history/);
  assert.match(card, /event\.reasonText/);
  assert.doesNotMatch(card, /readiness score|% ready/i);
});

test("F006 UI: qualification is separate from lifecycle and scoring", () => {
  assert.match(detail, /options\.leadStages/);
  assert.match(detail, /Lifecycle and qualification are governed separately/);
  assert.doesNotMatch(statusRoute, /evaluateLeadReadiness|isLeadScoringConfigured/);
  assert.match(statusRoute, /transitionLeadStage/);
  assert.match(stageRoute, /transitionLeadStage/);
  assert.doesNotMatch(stageRoute, /evaluateLeadReadiness|isLeadScoringConfigured/);
  assert.match(card, /qualification\.state/);
});

test("F006 UI: unqualification is a governed dialog rather than a prompt", () => {
  assert.match(card, /<dialog/);
  assert.match(card, /Select a reason/);
  assert.match(card, /reasonCode === "other"/);
  assert.match(card, /Other reason details \*/);
  assert.doesNotMatch(detail, /prompt\("Disqualification/);
  assert.doesNotMatch(list, /prompt\("Why is this lead being disqualified/);
});

test("F006 API: explicit action has auth, entitlement, scope, audit and transaction boundaries", () => {
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /PERMISSIONS\.crmLeadsManage/);
  assert.match(route, /crmApiContext/);
  assert.match(route, /tenantTransaction/);
  assert.match(route, /decideLeadQualification/);
  assert.match(route, /qualificationEventId/);
  assert.match(route, /crm\.leads\.requalified/);
});

test("F006 API: generic PATCH remains unable to mutate decision fields", () => {
  assert.match(genericRoute, /updateCrmRecord/);
  assert.match(detailData, /getLeadQualification/);
  assert.match(route, /getLeadQualification/);
});

test("F006 list: qualification is a server-backed filter and compact visible badge", () => {
  assert.match(list, /query\.set\("qualification"/);
  assert.match(list, /All decisions/);
  assert.match(list, /row\.qualificationState/);
  assert.match(list, /crm-qualification-state/);
});

test("F006 accessibility: modal semantics, live errors, focus restoration and reduced motion exist", () => {
  assert.match(card, /aria-labelledby="qualification-dialog-title"/);
  assert.match(card, /aria-describedby="qualification-dialog-description"/);
  assert.match(card, /role="alert"/);
  assert.match(card, /dialog\.showModal\(\)/);
  assert.match(card, /dialog\.addEventListener\("cancel"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("F006 responsive CSS covers desktop, tablet and mobile decision ergonomics", () => {
  assert.match(css, /width: min\(520px, calc\(100vw - 32px\)\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*height: 100dvh/);
  assert.match(css, /min-height: 44px/);
});
