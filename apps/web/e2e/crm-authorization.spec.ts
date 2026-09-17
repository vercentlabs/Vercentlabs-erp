import { test, expect } from "@playwright/test";

/**
 * Regression guard for SEC-CRM-001 (ERP completion gap audit): the
 * generic mutation routes (POST /api/crm/[resource], PATCH/DELETE
 * /api/crm/[resource]/[id]) used to fall through to module-access-only
 * (crm.view) for any of CRM_RESOURCE_KEYS's ~40 unmapped resources — any
 * CRM member, including a view-only one, could mutate them directly by
 * calling the endpoint, whether or not any UI exposed that action. Fixed
 * in crm-context.ts's requireCrmMutationAccess / resource-permissions.ts's
 * resolveCrmMutationPermission (also covered by a pure unit test in
 * resource-permissions.test.ts — this spec is the real-HTTP-request,
 * real-server, real-database proof of the same fix).
 */

test("an unmapped CRM resource's mutation is denied by default, not silently allowed at the view floor", async ({ page }) => {
  await page.goto("/crm/leads", { waitUntil: "networkidle" });

  const denied = await page.evaluate(async () => {
    const resp = await fetch("/api/crm/ai-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "should be denied by default" }),
    });
    return { status: resp.status, body: await resp.json() };
  });

  expect(denied.status).toBe(403);
  expect(denied.body.ok).toBe(false);
  expect(denied.body.code).toBe("PERMISSION_DENIED");
});

test("saved-views — the one documented self-scoped exemption — can still be created and deleted end-to-end", async ({ page }) => {
  await page.goto("/crm/leads", { waitUntil: "networkidle" });

  const created = await page.evaluate(async () => {
    const resp = await fetch("/api/crm/saved-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "leads", name: `e2e regression view ${Date.now()}`, filters: {} }),
    });
    return { status: resp.status, body: await resp.json() };
  });
  expect(created.status).toBe(201);
  expect(created.body.record.id).toBeTruthy();

  const deleted = await page.evaluate(
    async ({ id, expectedUpdatedAt }) => {
      const resp = await fetch(`/api/crm/saved-views/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, {
        method: "DELETE",
      });
      return { status: resp.status, body: await resp.json() };
    },
    { id: created.body.record.id, expectedUpdatedAt: created.body.record.updatedAt },
  );
  expect(deleted.status).toBe(200);
  expect(deleted.body.record.deleted).toBe(true);
});

test("a mapped CRM resource (leads) still requires its documented manage permission, unaffected by the deny-by-default fix", async ({ page }) => {
  // The owner fixture has every permission (organization_owner bypasses
  // requireSessionPermission entirely), so this only proves the mapped
  // path still succeeds end-to-end, not that a lesser role is blocked —
  // that half is covered by the unit test in resource-permissions.test.ts
  // plus resolveCrmMutationPermission's exhaustive-key-space test, since a
  // real restricted-role fixture isn't available to this suite yet (see
  // CRM_VISUAL_QA.md's note on the stale e2e-restricted fixture password).
  await page.goto("/crm/leads", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const resp = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: `E2E Auth Regression ${Date.now()}`, email: `e2e-auth-regression-${Date.now()}@crm-e2e-fixture.test` }),
    });
    return { status: resp.status, body: await resp.json() };
  });
  expect(result.status).toBe(201);
  expect(result.body.record.id).toBeTruthy();
});
