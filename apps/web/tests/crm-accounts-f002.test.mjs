import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const listPage = read("../src/app/(app)/crm/accounts/page.tsx");
const detailPage = read("../src/app/(app)/crm/accounts/[id]/page.tsx");
const workspace = read("../src/modules/crm/components/accounts-workspace.tsx");
const detail = read(
  "../src/modules/crm/components/account-detail-workspace.tsx",
);
const form = read("../src/modules/crm/components/account-form-drawer.tsx");
const collectionRoute = read("../src/app/api/crm/accounts/route.ts");
const recordRoute = read("../src/app/api/crm/accounts/[id]/route.ts");
const css = read("../src/app/crm-accounts.css");

test("F002 web: Accounts uses the dedicated server-backed Account service", () => {
  assert.match(listPage, /listCrmAccounts/);
  assert.match(listPage, /crmApiContext/);
  assert.doesNotMatch(listPage, /listBusinessDataRecords/);
  assert.doesNotMatch(listPage, /\.filter\(/);
});

test("F002 web: canonical list, create, detail, edit and archive affordances exist", () => {
  assert.match(workspace, /key === "page"/);
  assert.match(workspace, /Create account/);
  assert.match(workspace, /Search accounts/);
  assert.match(workspace, /All industries/);
  assert.match(workspace, /All countries/);
  assert.match(workspace, /EnterpriseDataGrid/);
  assert.match(workspace, /renderMobileCard/);
  assert.match(detailPage, /getCrmAccount/);
  assert.match(detail, /Edit/);
  assert.match(detail, /Archive account/);
  assert.match(
    detail,
    /Historical\s+relationships and records will be preserved/,
  );
});

test("F002 web: the form is grouped, labelled and maps field validation", () => {
  for (const section of [
    "Company identity",
    "Business information",
    "Business location",
  ]) {
    assert.match(form, new RegExp(section));
  }
  assert.match(form, /Company name \*/);
  assert.match(form, /type="email"/);
  assert.match(form, /type="url"/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /role="alert"/);
  assert.match(form, /disabled=\{pending\}/);
});

test("F002 web: API lifecycle is authenticated, permission guarded, scoped and audited", () => {
  for (const source of [collectionRoute, recordRoute]) {
    assert.match(source, /getSessionContext/);
    assert.match(source, /requireCrmView/);
    assert.match(source, /crmApiContext/);
  }
  assert.match(collectionRoute, /PERMISSIONS\.partiesManage/);
  assert.match(recordRoute, /PERMISSIONS\.partiesManage/);
  assert.match(collectionRoute, /crm\.accounts\.created/);
  assert.match(recordRoute, /crm\.accounts\.updated/);
  assert.match(recordRoute, /crm\.accounts\.archived/);
  assert.match(recordRoute, /client,/);
});

test("F002 web: responsive table-to-card and mobile detail behavior is explicit", () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.crm-account-table-wrap[\s\S]*display: none/);
  assert.match(css, /\.crm-account-cards[\s\S]*display: grid/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("F002 web: obsolete intelligence-heavy content is not part of Account 360", () => {
  assert.doesNotMatch(detail, /Open pipeline/);
  assert.doesNotMatch(detail, /Relationship activity/);
  assert.doesNotMatch(detail, /New opportunity/);
  assert.doesNotMatch(workspace, /Account Intelligence/i);
});
