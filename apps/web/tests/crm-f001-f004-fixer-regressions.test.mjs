import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 QA: Lead audit routes persist safe lifecycle metadata, not input/full records", () => {
  const collection = read("src/app/api/crm/[resource]/route.ts");
  const detail = read("src/app/api/crm/[resource]/[id]/route.ts");
  const mobileCollection = read("src/app/api/mobile/v1/crm/[resource]/route.ts");
  const mobileDetail = read("src/app/api/mobile/v1/crm/[resource]/[id]/route.ts");
  const stageRoute = read("src/app/api/crm/leads/[id]/stage/route.ts");
  const contract = read("src/modules/crm/crm-data-operations-and-customization/audit-events.ts");
  assert.match(contract, /resource !== "leads"/);
  assert.match(contract, /changedFields/);
  for (const source of [collection, detail, mobileCollection, mobileDetail])
    assert.match(source, /crmAuditSnapshot/);
  assert.match(stageRoute, /beforeData: \{ status: transition\.event\.fromStageCode \}/);
  assert.match(stageRoute, /afterData: \{ status: transition\.event\.toStageCode, eventId: transition\.event\.id \}/);
  assert.doesNotMatch(stageRoute, /afterData:\s*input/);
  assert.doesNotMatch(collection, /afterData:\s*input/);
  assert.doesNotMatch(detail, /afterData:\s*(input|archived)/);
  assert.doesNotMatch(mobileCollection, /afterData:\s*input/);
  assert.doesNotMatch(mobileDetail, /afterData:\s*(input|record)/);
});

test("F004 QA: dedicated source route validates every path identifier", () => {
  const route = read("src/app/api/crm/lead-sources/[id]/route.ts");
  assert.equal(route.match(/assertCrmIdentifier\(id\)/g)?.length, 3);
});

test("F003 QA: Contact archive audit is emitted only for a real transition", () => {
  const route = read("src/app/api/crm/contacts/[id]/route.ts");
  assert.match(route, /if \(before\.status !== "inactive"\) \{[\s\S]*crm\.contacts\.archived/);
});

test("F001 QA: Lead detail uses progressive controls and explicit mobile section navigation", () => {
  const component = read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx");
  const css = read("src/app/crm-lead-workspaces.css");
  assert.match(component, /lead-lifecycle-select/);
  assert.match(component, /lead-detail-section-picker/);
  assert.doesNotMatch(component, /className=\{String\(lead\.status\) === stage \? "active"/);
  assert.match(css, /\.lead-detail-section-picker[\s\S]*display: none/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.lead-detail-section-picker[\s\S]*display: grid/);
  assert.match(css, /\.crm-lead-detail-overview > aside[\s\S]*order: -1/);
});

test("F003/F004 QA: scoped interaction targets and mobile filter actions align at 44px", () => {
  const contacts = read("src/app/crm-contacts.css");
  const sources = read("src/app/crm-lead-sources.css");
  assert.match(contacts, /crm-contacts-workspace :is\([\s\S]*min-height: 44px/);
  assert.match(sources, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*crm-source-filters > \.link-button[\s\S]*min-height: 44px/);
});

test("F001 QA: opening any Lead drawer focuses its contextual heading", () => {
  const drawer = read("src/modules/crm/prospect-and-relationship-master-data/lead-workspace-drawer.tsx");
  assert.match(drawer, /headingRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(drawer, /primaryControl/);
});

test("F004 QA: migration enforces one active default source per organization", () => {
  const migration = read("../../database/tenant/migrations/060_crm_f001_f004_qa_hardening.sql");
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sources_active_default_uidx/);
  assert.match(migration, /WHERE is_default = true[\s\S]*status = 'active'[\s\S]*archived_at IS NULL/);
});

test("F001 QA round two: phone layout suppresses the desktop tab rail", () => {
  const css = read("src/app/crm-lead-workspaces.css");
  assert.match(
    css,
    /@media \(max-width: 680px\)[\s\S]*\.crm-lead-drawer \.crm-lead-detail-page nav\.lead-detail-tabs\s*\{[\s\S]*display: none !important/,
  );
});

test("F001 QA round two: drawer dialog uses a role-compatible neutral host", () => {
  const drawer = read("src/modules/crm/prospect-and-relationship-master-data/lead-workspace-drawer.tsx");
  assert.match(drawer, /<div[\s\S]*className=\{`crm-lead-drawer/);
  assert.doesNotMatch(drawer, /<aside[\s\S]*role="dialog"/);
});

test("F003 QA round two: tablet Contacts switch before desktop minimum widths overflow", () => {
  const css = read("src/app/crm-contacts.css");
  const workspace = read("src/modules/crm/prospect-and-relationship-master-data/contacts-workspace.tsx");
  const lookup = read("src/modules/crm/prospect-and-relationship-master-data/contact-account-lookup.tsx");
  assert.match(css, /@media \(min-width: 901px\) and \(max-width: 1100px\)/);
  assert.match(css, /crm-contact-table-wrap[\s\S]*display: none/);
  assert.match(css, /crm-contact-cards[\s\S]*display: grid/);
  assert.match(workspace, /type="search"[\s\S]*suppressHydrationWarning/);
  assert.equal(lookup.match(/suppressHydrationWarning/g)?.length, 2);
});

test("F001/F003/F004 QA round two: muted canonical metadata uses AA contrast color", () => {
  const leads = read("src/app/crm-lead-workspaces.css");
  const contacts = read("src/app/crm-contacts.css");
  const sources = read("src/app/crm-lead-sources.css");
  assert.match(leads, /crm-lead-detail-facts small[\s\S]*color: #667085/);
  assert.match(contacts, /crm-contact-account-lookup > small[\s\S]*color: #667085/);
  assert.match(sources, /crm-sources-heading p:last-child[\s\S]*color: #667085/);
});

test("F004 QA round two: Apply and Clear share an explicit aligned 44px row", () => {
  const css = read("src/app/crm-lead-sources.css");
  assert.match(
    css,
    /crm-source-filters > :is\(button, \.link-button\)[\s\S]*height: 44px;[\s\S]*min-height: 44px;[\s\S]*margin: 0/,
  );
});
