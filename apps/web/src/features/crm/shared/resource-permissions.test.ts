import { test } from "node:test";
import assert from "node:assert/strict";

import { CRM_RESOURCE_KEYS } from "@vercentlabs/shared-types";

import { RESOURCE_MANAGE_PERMISSIONS, resolveCrmMutationPermission } from "./resource-permissions.ts";

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
  "forecast-periods",
  "forecast-submissions",
  "quota-plans",
];

test("resource-permissions: every generic resource with a shipped settings/record screen has a manage-permission entry", () => {
  for (const resource of RESOURCES_WITH_SHIPPED_UI) {
    assert.ok(
      RESOURCE_MANAGE_PERMISSIONS[resource],
      `${resource} has shipped UI but no entry in RESOURCE_MANAGE_PERMISSIONS — its mutations would fall through to module-access-only (crm.view).`,
    );
  }
});

// Regression guard for SEC-CRM-001 (ERP completion gap audit): before this
// fix, requireCrmAccess(client, session, RESOURCE_MANAGE_PERMISSIONS[resource])
// skipped the permission check entirely whenever that lookup was
// `undefined` — i.e. for every one of CRM_RESOURCE_KEYS's ~40 unmapped
// entries, leaving only the crm.view module-access floor. A CRM member
// with view-only access could mutate any of them (communications,
// custom-records, dashboards, ai-feedback, ...) by calling
// POST/PATCH/DELETE /api/crm/{resource} directly, UI or no UI.
// resolveCrmMutationPermission is what crm-context.ts's
// requireCrmMutationAccess (used by both generic mutation routes) calls
// instead — this test proves, for the entire real resource universe (not
// a hand-picked sample), that "no mapping" now means "denied", not
// "allowed at the view floor".
test("resource-permissions: every CRM_RESOURCE_KEYS entry either has a manage permission, is a documented self-scoped exemption, or is denied by default", () => {
  for (const resource of CRM_RESOURCE_KEYS) {
    const resolution = resolveCrmMutationPermission(resource);
    if (RESOURCE_MANAGE_PERMISSIONS[resource]) {
      assert.equal(resolution.kind, "requires-permission", `${resource} is mapped but resolveCrmMutationPermission didn't return requires-permission`);
      assert.equal((resolution as { permission: string }).permission, RESOURCE_MANAGE_PERMISSIONS[resource]);
    } else {
      assert.notEqual(
        resolution.kind,
        "requires-permission",
        `${resource} has no RESOURCE_MANAGE_PERMISSIONS entry but resolveCrmMutationPermission still requires only a permission check — it must be "self-scoped" (documented exemption) or "denied" (the safe default), never silently permission-less.`,
      );
      assert.ok(
        resolution.kind === "self-scoped" || resolution.kind === "denied",
        `${resource} resolved to an unexpected kind: ${resolution.kind}`,
      );
    }
  }
});

test("resource-permissions: an unmapped resource (e.g. communications) is denied, not silently allowed at the view floor", () => {
  assert.equal(resolveCrmMutationPermission("communications").kind, "denied");
  assert.equal(resolveCrmMutationPermission("custom-records").kind, "denied");
  assert.equal(resolveCrmMutationPermission("ai-feedback").kind, "denied");
});

test("resource-permissions: saved-views is the one documented self-scoped exemption (per-user SQL scope, not an org manage tier)", () => {
  assert.equal(resolveCrmMutationPermission("saved-views").kind, "self-scoped");
});

test("resource-permissions: an entirely unknown resource key is denied, not allow-listed by accident", () => {
  assert.equal(resolveCrmMutationPermission("not-a-real-crm-resource").kind, "denied");
});
