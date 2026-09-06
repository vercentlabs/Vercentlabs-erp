import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const listPage = read("../src/app/(app)/crm/contacts/page.tsx");
const detailPage = read("../src/app/(app)/crm/contacts/[id]/page.tsx");
const workspace = read("../src/modules/crm/components/contacts-workspace.tsx");
const detail = read("../src/modules/crm/components/contact-detail-workspace.tsx");
const form = read("../src/modules/crm/components/contact-form-drawer.tsx");
const lookup = read("../src/modules/crm/components/contact-account-lookup.tsx");
const collectionRoute = read("../src/app/api/crm/contacts/route.ts");
const recordRoute = read("../src/app/api/crm/contacts/[id]/route.ts");
const loading = read("../src/app/(app)/crm/contacts/loading.tsx");
const error = read("../src/app/(app)/crm/contacts/error.tsx");
const css = read("../src/app/crm-contacts.css");

test("F003 web: Contacts uses the dedicated server-backed Contact service", () => {
  assert.match(listPage, /listCrmContacts/);
  assert.match(listPage, /crmApiContext/);
  assert.doesNotMatch(listPage, /listBusinessDataRecords|BusinessDataManager|limit:\s*500/);
});

test("F003 web: canonical list, search, filters, create, detail, edit and archive exist", () => {
  assert.match(workspace, /Create contact/);
  assert.match(workspace, /Search contacts/);
  assert.match(workspace, /All statuses/);
  assert.match(workspace, /Account filter/);
  assert.match(workspace, /EnterpriseDataGrid/);
  assert.match(workspace, /renderMobileCard/);
  assert.match(detailPage, /getCrmContact/);
  assert.match(detail, />Edit</);
  assert.match(detail, /Archive contact/);
  assert.match(detail, /Historical relationships and activity will remain available/);
  assert.match(detail, /onDismiss=\{\(\) => setEditing\(false\)\}/);
  assert.match(detail, /showModal\(\)/);
});

test("F003 web: the form is compact, grouped, labelled and enforces reachability", () => {
  for (const section of ["Contact identity", "Company relationship", "Reachability"]) assert.match(form, new RegExp(section));
  assert.match(form, /label="First name"[\s\S]{0,80}required/);
  assert.match(form, /type="email"/);
  assert.match(form, /type="tel"/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /disabled=\{pending\}/);
});

test("F003 web: Account lookup is server-backed, scoped through F002 and keyboard accessible", () => {
  assert.match(lookup, /\/api\/crm\/accounts\?search=/);
  assert.match(lookup, /status=active&limit=8/);
  assert.match(lookup, /role="combobox"/);
  assert.match(lookup, /ArrowDown/);
  assert.match(lookup, /ArrowUp/);
  assert.match(lookup, /Escape/);
  assert.match(lookup, /onSelectionChange/);
  assert.doesNotMatch(lookup, /limit=10000|\.filter\(/);
});

test("F003 web: API lifecycle is authenticated, permission guarded, scoped and audited", () => {
  for (const source of [collectionRoute, recordRoute]) {
    assert.match(source, /getSessionContext/);
    assert.match(source, /requireCrmView/);
    assert.match(source, /crmApiContext/);
    assert.match(source, /PERMISSIONS\.partiesManage/);
  }
  assert.match(collectionRoute, /crm\.contacts\.created/);
  assert.match(recordRoute, /crm\.contacts\.updated/);
  assert.match(recordRoute, /crm\.contacts\.archived/);
  assert.match(recordRoute, /client,/);
});

test("F003 web: reactivate is a governed PATCH action wired end to end, not a status field edit", () => {
  assert.match(recordRoute, /reactivateCrmContact/);
  assert.match(recordRoute, /input\.action === "reactivate"/);
  assert.match(recordRoute, /crm\.contacts\.reactivated/);
  assert.match(detail, /reactivateContact/);
  assert.match(detail, /action:\s*"reactivate"/);
  assert.match(detail, /"Reactivate"/);
});

test("F003 web: Contact Detail prioritizes identity, channels and clickable Account relationship", () => {
  assert.match(detail, /Reachability/);
  assert.match(detail, /Company context/);
  assert.match(detail, /\/crm\/accounts\//);
  assert.match(detail, /Archived account/);
  assert.doesNotMatch(detail, /Contact Intelligence|Engagement score|Buying committee/i);
});

test("F003 web: responsive, loading, error and accessibility states are explicit", () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.crm-contact-table-wrap[\s\S]*display: none/);
  assert.match(css, /\.crm-contact-cards[\s\S]*display: grid/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /Try again/);
});
