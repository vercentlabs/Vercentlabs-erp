import { test, expect } from "@playwright/test";
import { fixtures } from "./fixtures";

/**
 * Regression guard for the Phase 2.3 same-origin audit (ERP completion
 * gap register): /api/auth/logout, /api/notifications,
 * /api/notifications/[id]/read, and /api/approvals/[id]/decide were the
 * cookie-authenticated mutation routes missing the assertSameOriginOrMobile
 * call every other mutation route already had. The session cookie is
 * SameSite=Lax, which already blocked the worst case (a forced cross-site
 * POST/PATCH), so this wasn't a live CSRF exploit — but it was the
 * inconsistent path relying on a cookie attribute instead of the app's own
 * explicit check. These specs prove the fix didn't break the real,
 * same-origin calling code (notifications-client.tsx, approvals-client.tsx,
 * ProfileMenu.tsx) it was added alongside.
 */

test("notifications: list, mark-one-read and mark-all-read all still work end-to-end after the same-origin check was added", async ({ page }) => {
  await page.goto("/notifications", { waitUntil: "networkidle" });

  const list = await page.evaluate(async () => {
    const resp = await fetch("/api/notifications");
    return { status: resp.status, body: await resp.json() };
  });
  expect(list.status).toBe(200);
  expect(Array.isArray(list.body.notifications)).toBe(true);

  const markAll = await page.evaluate(async () => {
    const resp = await fetch("/api/notifications", { method: "PATCH" });
    return { status: resp.status, body: await resp.json() };
  });
  expect(markAll.status).toBe(200);
  expect(markAll.body.ok).toBe(true);

  if (list.body.notifications[0]?.id) {
    const one = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
      return { status: resp.status, body: await resp.json() };
    }, list.body.notifications[0].id);
    expect(one.status).toBe(200);
    expect(one.body.notification.id).toBe(list.body.notifications[0].id);
  }
});

test("notifications: a failed mark-read request surfaces an error and does not update the UI as if it had succeeded", async ({ page }) => {
  // Regression guard for a real bug found during the ERP completion gap
  // audit (Phase 6): notifications-client.tsx's markRead/markAllRead
  // mutationFn awaited fetch() but never checked response.ok, so
  // TanStack Query's onSuccess (invalidate + refetch, i.e. "this
  // succeeded") fired regardless of whether the server actually returned
  // an error. Mocks both the list (so this test doesn't depend on real,
  // order-sensitive unread-notification state left behind by earlier
  // specs in this file) and the read endpoint (forced to fail), then
  // proves the fixed client surfaces the failure instead of silently
  // treating it as success.
  const fakeNotification = {
    id: "11111111-1111-1111-1111-111111111111",
    type: "test",
    title: "E2E synthetic notification",
    message: "Used only to exercise the mark-read failure path.",
    href: null,
    read_at: null,
    created_at: new Date().toISOString(),
  };
  await page.route("**/api/notifications", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, notifications: [fakeNotification] }) });
  });
  await page.route("**/api/notifications/*/read", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, message: "Simulated failure" }) }),
  );

  await page.goto("/notifications", { waitUntil: "networkidle" });
  await expect(page.getByText("E2E synthetic notification")).toBeVisible();

  await page.getByRole("button", { name: "Mark read" }).click();
  // Not getByRole("alert") alone — Next's own route announcer
  // (#__next-route-announcer__) also carries role="alert" and matches.
  await expect(page.getByText("Simulated failure")).toBeVisible();
  // The mocked list never changes (still returns read_at: null every
  // time), so if the fix regressed and onSuccess fired anyway, the "Mark
  // read" button would disappear on refetch — asserting it's still there
  // is the observable proof the UI didn't treat the failure as success.
  await expect(page.getByRole("button", { name: "Mark read" })).toBeVisible();
});

test("approvals: list still works end-to-end after the same-origin check was added to decide", async ({ page }) => {
  await page.goto("/approvals", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const resp = await fetch("/api/approvals?status=pending");
    return { status: resp.status, body: await resp.json() };
  });
  expect(result.status).toBe(200);
  expect(Array.isArray(result.body.approvals)).toBe(true);
});

test("logout still works end-to-end after the same-origin check was added, and the cleared session is actually rejected afterward", async ({ browser }) => {
  // Deliberately its own fresh login, NOT the shared e2e/.auth/owner.json
  // storage state every other spec's project config depends on — this
  // test revokes its session on purpose (that's the point), and doing
  // that through the shared fixture would revoke it server-side for
  // every other spec still to run in this worker.
  // storageState: undefined explicitly overrides the "chromium" project's
  // default (e2e/.auth/owner.json) — without this, browser.newContext()
  // still inherits the project's configured storageState even with no
  // arguments passed, and this test would start already logged in.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(fixtures.ownerEmail);
  await page.getByLabel(/password/i).fill(fixtures.ownerPassword);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/login")),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
  await page.goto("/crm", { waitUntil: "networkidle" });

  const logout = await page.evaluate(async () => {
    const resp = await fetch("/api/auth/logout", { method: "POST" });
    return { status: resp.status, body: await resp.json() };
  });
  expect(logout.status).toBe(200);
  expect(logout.body.ok).toBe(true);

  const afterLogout = await page.evaluate(async () => {
    const resp = await fetch("/api/notifications");
    return { status: resp.status };
  });
  expect(afterLogout.status).toBe(401);

  await context.close();
});
