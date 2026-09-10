import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const collectionRoute = "apps/web/src/app/api/crm/[resource]/route.ts";
const itemRoute = "apps/web/src/app/api/crm/[resource]/[id]/route.ts";
const statusRoute = "apps/web/src/app/api/crm/leads/[id]/status/route.ts";
const stageRoute = "apps/web/src/app/api/crm/leads/[id]/stage/route.ts";
const qualificationRoute = "apps/web/src/app/api/crm/leads/[id]/qualification/route.ts";
const convertRoute = "apps/web/src/app/api/crm/leads/[id]/convert/route.ts";

test("F001 hardening: datetime-local validation accepts UTC and explicit offsets", () => {
  const source = read("apps/web/src/modules/crm/crm-data-operations-and-customization/input-validation.ts");
  assert.match(source, /\(\?:Z\|\[\+-\]\\d\{2\}:\\d\{2\}\)\?/);
  assert.match(source, /Date\.parse\(text\)/);
});

test("F001 hardening: CRM API errors expose stable code and errors shape", () => {
  const crmModuleSource = read("apps/web/src/modules/crm/crm-data-operations-and-customization/http-errors.ts");
  assert.match(crmModuleSource, /export function crmErrorResponse/);
  assert.match(crmModuleSource, /code: error\.code \|\| "CRM_ERROR"/);
  assert.match(crmModuleSource, /errors,/);
  assert.match(crmModuleSource, /code: "CRM_VALIDATION_ERROR"/);
  // Integrity closeout (Prompts 1-5): rethrowCrmError now also forwards
  // error.details (e.g. CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED's structured
  // missingRequirements list) as a 4th HttpError argument — the
  // status/message/code contract this test guards is unchanged.
  assert.match(crmModuleSource, /new HttpError\(\s*error\.status,\s*error\.message,\s*error\.code,/);

  for (const route of [collectionRoute, itemRoute, statusRoute, convertRoute]) {
    assert.match(read(route), /crmErrorResponse\(error\)/, route);
  }
});

test("F001/F006 hardening: lifecycle and explicit qualification remain independent of scoring", () => {
  const lifecycleSource = read(stageRoute);
  const qualificationSource = read(qualificationRoute);
  assert.match(lifecycleSource, /transitionLeadStage/);
  assert.match(read(statusRoute), /transitionLeadStage/);
  assert.doesNotMatch(lifecycleSource, /isLeadScoringConfigured|CRM_LEAD_QUALIFICATION_NOT_READY/);
  assert.match(qualificationSource, /decideLeadQualification/);
  assert.doesNotMatch(qualificationSource, /isLeadScoringConfigured|score threshold/i);
});

test("F001 hardening: conversion success message reflects whether an opportunity exists", () => {
  const source = read(convertRoute);
  assert.match(source, /conversion\.opportunityId/);
  assert.match(source, /Lead converted to customer and opportunity\./);
  assert.match(source, /Lead converted to customer\./);
});

test("F001 hardening: obsolete Leads stylesheet is removed and the current mobile breakpoint remains 680px", () => {
  const layout = read("apps/web/src/app/layout.tsx");
  assert.doesNotMatch(layout, /crm-leads-workspace\.css/);
  assert.equal(
    fs.existsSync(path.join(root, "apps/web/src/app/crm-leads-workspace.css")),
    false,
  );
  const currentCss = read("apps/web/src/app/crm-lead-workspaces.css");
  assert.match(currentCss, /@media \(max-width: 680px\)/);
  assert.match(currentCss, /\.crm-leads-mobile-list/);
  assert.match(currentCss, /\.crm-leads-table-scroll/);
});
