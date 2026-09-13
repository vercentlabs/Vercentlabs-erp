import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/(app)/crm/sources/page.tsx");
const workspace = read(
  "../src/modules/crm/prospect-and-relationship-master-data/lead-sources-workspace.tsx",
);
const form = read("../src/modules/crm/prospect-and-relationship-master-data/lead-source-form-drawer.tsx");
const collection = read("../src/app/api/crm/lead-sources/route.ts");
const record = read("../src/app/api/crm/lead-sources/[id]/route.ts");
const setup = read("../src/app/(app)/crm/settings/page.tsx");
const navigation = read("../src/core/navigation/modules.ts");
const css = read("../src/modules/crm/ui/crm.css");
const options = read("../../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-options.js");
const resourceRegistry = read("../../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-registry.js");
const resourceMutation = read("../../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js");
const leadEditor = read("../src/modules/crm/prospect-and-relationship-master-data/lead-edit-panel.tsx");
const leadDetail = read(
  "../src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx",
);

test("F004 web: CRM Setup owns the dedicated organization-wide Lead Source workspace", () => {
  assert.match(setup, /Lead sources/);
  assert.match(setup, /href: "\/crm\/sources"/);
  assert.match(page, /listCrmLeadSources/);
  assert.match(page, /crmSettingsManage/);
  assert.doesNotMatch(navigation, /href:\s*["']\/crm\/sources/);
});

test("F004 web: list, search, lifecycle, usage-safe confirmation and explicit states exist", () => {
  for (const value of [
    "Create source",
    "Search sources",
    "All statuses",
    "Deactivate",
    "Reactivate",
    "Used by",
    "Inactive",
  ])
    assert.match(workspace, new RegExp(value));
  assert.match(workspace, /existing lead/i);
  assert.match(workspace, /StatePanel/);
  assert.match(workspace, /EnterpriseDataGrid/);
  assert.match(workspace, /renderMobileCard/);
});

test("F004 web: create/edit form hides immutable code and exposes concise governed metadata", () => {
  for (const value of [
    "Description",
    "Channel",
    "Display order",
    "Default source",
  ])
    assert.match(form, new RegExp(value));
  assert.match(form, /label="Source name"[\s\S]{0,80}required/);
  assert.match(form, /Internal code/);
  assert.doesNotMatch(form, /name="code"/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /disabled=\{pending\}/);
});

test("F004 web: dedicated API separates use access from configuration permission and audits lifecycle", () => {
  assert.match(collection, /requireCrmView/);
  assert.match(collection, /crmSettingsManage/);
  assert.match(record, /crmSettingsManage/);
  for (const event of [
    "crm.lead_sources.created",
    "crm.lead_sources.updated",
    "crm.lead_sources.deactivated",
    "crm.lead_sources.reactivated",
  ])
    assert.match(collection + record, new RegExp(event.replaceAll(".", "\\.")));
  assert.match(record, /client,/);
});

test("F004 web: new selectors use active sources while historical Lead UI resolves all sources", () => {
  assert.match(options, /status = 'active'/);
  assert.match(options, /allSources/);
  assert.match(leadEditor, /options\.allSources/);
  assert.match(leadEditor, /Inactive/);
  assert.match(leadDetail, /leadSource\?\.status === "inactive"/);
  assert.match(leadDetail, /Not specified/);
});

test("F004 web: original-source lineage and referrer details are wired through create, edit and detail", () => {
  const create = read("../src/modules/crm/prospect-and-relationship-master-data/lead-create-workspace.tsx");
  assert.match(create, /"referrerName"/);
  assert.match(create, /name="referrerName"/);
  assert.match(create, /permanent original source/);
  assert.match(leadEditor, /"referrerName"/);
  assert.match(leadDetail, /originalLeadSource/);
  assert.match(leadDetail, /Original source/);
  assert.match(leadDetail, /Referred by/);
  assert.match(resourceRegistry, /originalSourceId: "original_source_id"/);
  assert.match(resourceRegistry, /referrerName: "referrer_name"/);
  assert.match(resourceMutation, /CRM_LEAD_ORIGINAL_SOURCE_IMMUTABLE/);
});

test("F004 web: desktop table, tablet/mobile cards, touch targets and reduced motion are explicit", () => {
  assert.match(css, /crm-source-table/);
  assert.match(css, /@media \(max-width: 1023px\)/);
  assert.match(css, /crm-source-table-wrap[\s\S]*?display: none/);
  assert.match(css, /crm-source-cards[\s\S]*?display: grid/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
});
