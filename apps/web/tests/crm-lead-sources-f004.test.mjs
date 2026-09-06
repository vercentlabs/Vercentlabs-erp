import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/(app)/crm/sources/page.tsx");
const workspace = read(
  "../src/modules/crm/components/lead-sources-workspace.tsx",
);
const form = read("../src/modules/crm/components/lead-source-form-drawer.tsx");
const collection = read("../src/app/api/crm/lead-sources/route.ts");
const record = read("../src/app/api/crm/lead-sources/[id]/route.ts");
const setup = read("../src/app/(app)/crm/settings/page.tsx");
const navigation = read("../src/core/navigation/modules.ts");
const css = read("../src/app/crm-lead-sources.css");
const options = read("../../../services/api/src/modules/crm/index.js");
const leadWorkspace = read("../src/modules/crm/components/leads-workspace.tsx");
const leadDetail = read(
  "../src/modules/crm/components/lead-detail-workspace.tsx",
);

test("F004 web: CRM Setup owns the dedicated organization-wide Lead Source workspace", () => {
  assert.match(setup, /Lead sources/);
  assert.match(setup, /\/crm\/\$\{key\}/);
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
  assert.match(workspace, /existing Lead/);
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
  assert.match(leadWorkspace, /options\.allSources/);
  assert.match(leadWorkspace, /Inactive/);
  assert.match(leadDetail, /leadSource\?\.status === "inactive"/);
  assert.match(leadDetail, /Not specified/);
});

test("F004 web: original-source lineage and referrer details are wired through create, edit and detail", () => {
  const create = read("../src/modules/crm/components/lead-create-workspace.tsx");
  assert.match(create, /"referrerName"/);
  assert.match(create, /name="referrerName"/);
  assert.match(create, /permanent original source/);
  assert.match(leadWorkspace, /"referrerName"/);
  assert.match(leadDetail, /originalLeadSource/);
  assert.match(leadDetail, /Original source/);
  assert.match(leadDetail, /Referred by/);
  assert.match(options, /originalSourceId: "original_source_id"/);
  assert.match(options, /referrerName: "referrer_name"/);
  assert.match(options, /CRM_LEAD_ORIGINAL_SOURCE_IMMUTABLE/);
});

test("F004 web: desktop table, tablet/mobile cards, touch targets and reduced motion are explicit", () => {
  assert.match(css, /crm-source-table/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /crm-source-table-wrap[\s\S]*?display: none/);
  assert.match(css, /crm-source-cards[\s\S]*?display: grid/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
});
