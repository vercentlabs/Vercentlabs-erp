import { test } from "node:test";
import assert from "node:assert/strict";

import { ROLE_TEMPLATE_BY_SLUG } from "@vercentlabs/permissions";

import { summarizeEffectiveAccess } from "./effective-access.ts";

const role = (slug: string) => ({ slug, permission_keys: [...ROLE_TEMPLATE_BY_SLUG.get(slug)!.permissions] });

test("effective access is the union of every selected role, not the primary role alone", () => {
  const rep = summarizeEffectiveAccess([role("sales_representative")]);
  assert.equal(rep.crmRecordScope, "team");
  assert.ok(!rep.highRisk.includes("Export CRM data"));
  const combined = summarizeEffectiveAccess([role("sales_representative"), role("marketing_manager")]);
  assert.equal(combined.crmRecordScope, "team", "Marketing widens Leads only, not every CRM record");
  assert.deepEqual(combined.wideAccess, ["All Leads"]);
  assert.ok(combined.highRisk.includes("Export CRM data"));
  assert.equal(summarizeEffectiveAccess([role("sales_representative"), role("sales_head")]).crmRecordScope, "all", "union: Sales Head's view-all widens the combined scope");
  assert.ok(combined.permissionCount >= rep.permissionCount);
});

test("sales manager is team-scoped; sales head sees all CRM records", () => {
  assert.equal(summarizeEffectiveAccess([role("sales_manager")]).crmRecordScope, "team");
  assert.equal(summarizeEffectiveAccess([role("sales_head")]).crmRecordScope, "all");
});

test("company administrator has no CRM record or sensitive access", () => {
  const admin = summarizeEffectiveAccess([role("company_administrator")]);
  assert.equal(admin.crmRecordScope, "team", "crm.view only: nothing beyond what they own");
  assert.deepEqual(admin.highRisk, []);
});

test("organisation owner is flagged with every high-risk CRM capability", () => {
  const owner = summarizeEffectiveAccess([{ slug: "organization_owner", permission_keys: [] }]);
  assert.equal(owner.crmRecordScope, "all");
  assert.ok(owner.highRisk.includes("Change CRM settings") && owner.highRisk.includes("Sensitive account details (GSTIN, PAN)"));
});

test("a role without crm.view reports no CRM access", () => {
  assert.equal(summarizeEffectiveAccess([{ slug: "custom", permission_keys: ["stock.view"] }]).crmRecordScope, "none");
});

test("Customer Success and Partner Manager show their relationship-based widening", () => {
  assert.deepEqual(summarizeEffectiveAccess([role("customer_success_manager")]).wideAccess, ["All customer Accounts, their Contacts and customer Activities"]);
  assert.deepEqual(summarizeEffectiveAccess([role("partner_manager")]).wideAccess, ["Partner-registered Leads and Opportunities, and partner Accounts"]);
  assert.equal(summarizeEffectiveAccess([role("auditor")]).crmRecordScope, "all", "Auditor reads company-wide");
});
