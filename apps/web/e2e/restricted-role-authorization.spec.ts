import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixtures } from "./fixtures";

/**
 * Phase 7 (ERP platform checkpoint D): real E2E proof of authorization
 * denial paths against a genuinely restricted (non-organization_owner)
 * session, not the organization_owner fixture every other spec in this
 * directory runs as. organization_owner short-circuits hasSessionPermission
 * to true, so none of these denial paths could be proven E2E before the
 * restricted fixture's password was usable (GAP-CRM-RESTRICTED-FIXTURE).
 *
 * e2e-restricted@crm-e2e-fixture.test holds crm_sales_representative_e2e:
 * crm.view + leads/accounts/opportunities/activities/communications.manage,
 * but no users.manage, approvals.manage, or crm.*.view_sensitive — a real
 * "manages their own pipeline, nothing administrative" role, not a
 * read-only stub.
 *
 * One shared restricted login for the whole file (test.describe.serial +
 * beforeAll), not a fresh login per test — login is rate-limited
 * (10/300s/IP, apps/web/src/app/api/auth/login/route.ts), and this file
 * runs alongside several other specs that also log in fresh (the
 * platform-security session-revocation spec alone does 4). Every login
 * response status is asserted explicitly so a future rate-limit hit fails
 * loudly here instead of silently leaving the page logged out and every
 * downstream assertion misreporting a 401 as if it were the authorization
 * behavior under test.
 */

// "load" for /login, domcontentloaded for /crm — see platform-security
// .spec.ts's freshLogin for why: concurrent contexts against the Next.js
// dev server's persistent HMR websocket make "network idle" unpredictable
// to reach, but domcontentloaded is unsafe specifically for /login (it
// can fire before React hydrates the form's onSubmit handler, so a click
// triggers a native, non-JSON form POST that 400s server-side — found by
// reproducing it directly). Every call after landing on /crm is a
// page.evaluate(fetch(...)) that needs a live JS context only, never
// hydration, so domcontentloaded is fine there.
async function login(browser: Browser, email: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  const [loginResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/login")),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
  expect(loginResponse.status(), `login for ${email} must succeed (not rate-limited) for this spec's assertions to mean anything`).toBe(200);
  await page.goto("/crm", { waitUntil: "domcontentloaded" });
  return { context, page };
}

test.describe.serial("restricted role authorization", () => {
  test.skip(!fixtures.restrictedEmail || !fixtures.restrictedPassword, "ERP_E2E_RESTRICTED_EMAIL/PASSWORD not configured");

  let restrictedContext: BrowserContext;
  let restrictedPage: Page;

  test.beforeAll(async ({ browser }) => {
    const session = await login(browser, fixtures.restrictedEmail, fixtures.restrictedPassword);
    restrictedContext = session.context;
    restrictedPage = session.page;
  });

  test.afterAll(async () => {
    await restrictedContext.close();
  });

  test("cannot invite anyone into any role (no users.manage), unaffected by the grant-ceiling fix", async () => {
    const result = await restrictedPage.evaluate(async () => {
      const resp = await fetch("/api/auth/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "irrelevant@crm-e2e-fixture.test", roleId: "00000000-0000-0000-0000-000000000000" }),
      });
      return { status: resp.status, body: await resp.json() };
    });
    // 403 (permission check) fires before the roleId is ever looked up,
    // so an obviously-fake roleId doesn't matter here.
    expect(result.status, JSON.stringify(result.body)).toBe(403);
  });

  test("an unmapped CRM resource mutation is still denied by default from a real non-owner session", async () => {
    // Companion to crm-authorization.spec.ts's same assertion, which runs
    // as organization_owner — this proves the deny-by-default fix for the
    // generic CRM mutation routes isn't an owner-specific artifact.
    const denied = await restrictedPage.evaluate(async () => {
      const resp = await fetch("/api/crm/ai-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "should be denied by default" }),
      });
      return { status: resp.status, body: await resp.json() };
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
  });

  test("cannot revoke another user's session by id — ownership check, not just a permission gate", async ({ browser }) => {
    // Reuses the shared e2e/.auth/owner.json storage state read-only
    // (GET /api/settings/sessions, then confirming it still works
    // afterward) rather than a fresh login — login is rate-limited
    // (10/300s/IP) and this suite already spends that budget several
    // times over before this file runs; nothing here revokes or mutates
    // that session, so sharing it is safe for whatever spec runs next.
    const ownerContext = await browser.newContext({ storageState: "e2e/.auth/owner.json" });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/crm", { waitUntil: "domcontentloaded" });
    try {
      const ownerSessionId = await ownerPage.evaluate(async () => {
        const resp = await fetch("/api/settings/sessions");
        const body = await resp.json();
        return (body.sessions.find((s: { isCurrent: boolean }) => s.isCurrent) as { id: string }).id;
      });

      const revokeAttempt = await restrictedPage.evaluate(async (id) => {
        const resp = await fetch(`/api/settings/sessions/${id}`, { method: "DELETE" });
        return { status: resp.status, body: await resp.json() };
      }, ownerSessionId);
      // 404, not 403 — revokeSessionById's WHERE id=$1 AND user_id=$2
      // simply matches zero rows for a session that isn't the caller's
      // own; the route never even learns whose session id it was handed.
      expect(revokeAttempt.status, JSON.stringify(revokeAttempt.body)).toBe(404);

      // And the owner's session is genuinely untouched — proof this
      // wasn't silently accepted and merely reported wrong.
      const ownerStillWorks = await ownerPage.evaluate(async () => (await fetch("/api/notifications")).status);
      expect(ownerStillWorks).toBe(200);
    } finally {
      await ownerContext.close();
    }
  });
});
