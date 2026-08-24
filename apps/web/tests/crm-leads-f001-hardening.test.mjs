import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const collectionRoute = "apps/web/src/app/api/crm/[resource]/route.ts";
const itemRoute = "apps/web/src/app/api/crm/[resource]/[id]/route.ts";
const statusRoute = "apps/web/src/app/api/crm/leads/[id]/status/route.ts";
const convertRoute = "apps/web/src/app/api/crm/leads/[id]/convert/route.ts";

test("F001 hardening: datetime-local validation accepts UTC and explicit offsets", () => {
  const source = read("apps/web/src/modules/crm/validation.ts");
  assert.match(source, /\(\?:Z\|\[\+-\]\\d\{2\}:\\d\{2\}\)\?/);
  assert.match(source, /Date\.parse\(text\)/);
});

test("F001 hardening: CRM API errors expose stable code and errors shape", () => {
  const crmModuleSource = read("apps/web/src/modules/crm/index.ts");
  assert.match(crmModuleSource, /export function crmErrorResponse/);
  assert.match(crmModuleSource, /code: error\.code \|\| "CRM_ERROR"/);
  assert.match(crmModuleSource, /errors,/);
  assert.match(crmModuleSource, /code: "CRM_VALIDATION_ERROR"/);
  assert.match(crmModuleSource, /new HttpError\(error\.status, error\.message, error\.code\)/);

  for (const route of [collectionRoute, itemRoute, statusRoute, convertRoute]) {
    assert.match(read(route), /crmErrorResponse\(error\)/, route);
  }
});

test("F001 hardening: qualification checks whether active scoring rules actually exist", () => {
  const source = read(statusRoute);
  assert.match(source, /isLeadScoringConfigured/);
  assert.match(source, /scoringConfigured/);
  assert.match(source, /CRM_LEAD_QUALIFICATION_NOT_READY/);
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
  const currentCss = read("apps/web/src/app/crm-lead-suite-enterprise.css");
  assert.match(currentCss, /@media \(max-width: 680px\)/);
  assert.match(currentCss, /\.crm-leads-mobile-list/);
  assert.match(currentCss, /\.crm-leads-table-scroll/);
});
