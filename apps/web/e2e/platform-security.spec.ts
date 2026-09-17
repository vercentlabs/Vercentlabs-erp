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

test("sessions: revoking a specific other session and revoking all other sessions both work end-to-end, and the caller's own session always survives", async ({ browser }) => {
  // Phase 3 (SP006): DELETE /api/settings/sessions/[id] and DELETE
  // /api/settings/sessions (revoke-others) both revoke real, live
  // sessions server-side, not just DB rows the caller can't otherwise
  // reach. Uses its own fresh logins throughout (storageState: undefined),
  // not the shared e2e/.auth/owner.json fixture, for the same reason the
  // logout spec above does — revoking "all other sessions" would revoke
  // that shared fixture's own session too. Regenerates it at the end so
  // later specs in the same run are unaffected.
  async function freshLogin() {
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
    return { context, page };
  }

  const current = await freshLogin();
  const other = await freshLogin();

  try {
    const otherSessionId = await other.page.evaluate(async () => {
      const resp = await fetch("/api/settings/sessions");
      const body = await resp.json();
      return (body.sessions.find((s: { isCurrent: boolean }) => s.isCurrent) as { id: string }).id;
    });

    // A cannot revoke B's session by a random/foreign id — this only
    // works because "current" and "other" are the same fixture user here;
    // ownership (not identity of caller vs target session) is the gate.
    const specificRevoke = await current.page.evaluate(async (id) => {
      const resp = await fetch(`/api/settings/sessions/${id}`, { method: "DELETE" });
      return { status: resp.status, body: await resp.json() };
    }, otherSessionId);
    expect(specificRevoke.status, JSON.stringify(specificRevoke.body)).toBe(200);

    const otherAfterSpecificRevoke = await other.page.evaluate(async () => (await fetch("/api/notifications")).status);
    expect(otherAfterSpecificRevoke).toBe(401);

    // Revoke-all-others: current survives, a brand-new third session does not.
    const third = await freshLogin();
    const revokeOthers = await current.page.evaluate(async () => {
      const resp = await fetch("/api/settings/sessions", { method: "DELETE" });
      return { status: resp.status, body: await resp.json() };
    });
    expect(revokeOthers.status, JSON.stringify(revokeOthers.body)).toBe(200);
    expect(revokeOthers.body.revokedCount).toBeGreaterThanOrEqual(1);

    const thirdAfterRevokeOthers = await third.page.evaluate(async () => (await fetch("/api/notifications")).status);
    expect(thirdAfterRevokeOthers).toBe(401);
    const currentStillWorks = await current.page.evaluate(async () => (await fetch("/api/notifications")).status);
    expect(currentStillWorks).toBe(200);
    await third.context.close();
  } finally {
    // Regenerate the shared fixture — revoke-others above also revoked
    // whatever session e2e/.auth/owner.json was carrying.
    const replacement = await freshLogin();
    await replacement.context.storageState({ path: "e2e/.auth/owner.json" });
    await replacement.context.close();
    await current.context.close();
    await other.context.close();
  }
});
