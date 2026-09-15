import { test } from "node:test";
import assert from "node:assert/strict";

import { RESOURCE_MANAGE_PERMISSIONS } from "./resource-permissions.ts";

// Regression guard for a real gap found in Tranche I: shipping a
// generic-resource-backed settings screen (account-plans/stakeholders in
// Tranche E) without adding its resource key here means the backend
// route falls through to module-access-only (crm.view) for create/
// update/archive — any authenticated org member, not just crm.settings.
// manage/crm.accounts.manage holders, could mutate it. This test does
// not (and cannot, from apps/web) prove every resource is correctly
// gated — it only proves the resources this session shipped UI for have
// SOME entry, so a future screen added without updating this map fails
// a test instead of shipping silently ungated.
const RESOURCES_WITH_SHIPPED_UI = [
  "sales-teams",
  "sales-team-members",
  "territories",
  "territory-assignments",
  "tags",
  "custom-object-definitions",
  "custom-field-definitions",
  "lost-reasons",
  "pipelines",
  "account-plans",
  "account-stakeholders",
  "qualification-criteria",
  "playbooks",
  "leads",
  "opportunities",
];

test("resource-permissions: every generic resource with a shipped settings/record screen has a manage-permission entry", () => {
  for (const resource of RESOURCES_WITH_SHIPPED_UI) {
    assert.ok(
      RESOURCE_MANAGE_PERMISSIONS[resource],
      `${resource} has shipped UI but no entry in RESOURCE_MANAGE_PERMISSIONS — its mutations would fall through to module-access-only (crm.view).`,
    );
  }
});
