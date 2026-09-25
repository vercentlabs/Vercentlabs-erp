import assert from "node:assert/strict";
import test from "node:test";

import { ROLE_TEMPLATE_BY_SLUG } from "@vercentlabs/permissions";

import { summarizeEffectiveAccess } from "./effective-access.ts";

const role = (slug: string) => ({ slug, permission_keys: ROLE_TEMPLATE_BY_SLUG.get(slug)!.permissions });
const level = (summary: ReturnType<typeof summarizeEffectiveAccess>, key: string) => summary.modules.find((module) => module.key === key)!.level;

test("roles combine: access is the union of every role, across modules", () => {
  const summary = summarizeEffectiveAccess([role("sales_manager"), role("inventory_manager")]);
  assert.notEqual(level(summary, "sales"), "none");
  assert.notEqual(level(summary, "stock"), "none");
  assert.equal(level(summary, "hr-payroll"), "none");
});

test("company administrator: administration only, no business module access and no business high-risk", () => {
  const summary = summarizeEffectiveAccess([role("company_administrator")]);
  assert.ok(summary.modules.every((module) => module.level === "none"));
  assert.ok(summary.administration.includes("Manage users and their access"));
  assert.ok(!summary.administration.includes("Turn modules on or off"));
  assert.ok(!summary.administration.includes("Define roles"));
  assert.deepEqual(summary.highRisk, []);
});

test("CRM record scope is shown for CRM: team for sales manager, all for sales head", () => {
  assert.match(summarizeEffectiveAccess([role("sales_manager")]).modules.find((module) => module.key === "crm")!.detail, /team/);
  assert.match(summarizeEffectiveAccess([role("sales_head")]).modules.find((module) => module.key === "crm")!.detail, /All CRM records/);
});

test("high-risk access is surfaced per module", () => {
  const summary = summarizeEffectiveAccess([role("hr_manager")]);
  assert.ok(summary.highRisk.includes("HR & Payroll: sensitive data"));
  assert.ok(summary.highRisk.some((label) => label.startsWith("HR & Payroll: approvals")));
});

test("organisation owner administers every module", () => {
  const summary = summarizeEffectiveAccess([{ slug: "organization_owner", permission_keys: [] }]);
  assert.ok(summary.modules.every((module) => module.level === "administer"));
  assert.ok(summary.highRisk.includes("Everything in every module (Organisation Owner)"));
});

test("a read-only role stays at view level", () => {
  const summary = summarizeEffectiveAccess([role("read_only")]);
  assert.ok(summary.modules.every((module) => module.level === "none" || module.level === "view"));
});
