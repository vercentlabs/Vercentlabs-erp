import { randomBytes, randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";
import { Client } from "pg";

import { MIGRATION_DATABASE_URL } from "./pos-fixtures";

// The customer-facing booking page: branded, calendar + time slots, one normalised time-zone name, usable on a
// phone, and the booking really is made. Uses a meeting link created directly for this run.

const OWNER_EMAIL = process.env.ERP_E2E_EMAIL || "e2e-owner@crm-e2e-fixture.test";

async function withLink<T>(work: (token: string, db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await db.connect();
  const token = randomBytes(18).toString("hex");
  let organizationId = "";
  try {
    const owner = (await db.query(`SELECT u.id, m.organization_id FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id WHERE u.email=$1 LIMIT 1`, [OWNER_EMAIL])).rows[0];
    organizationId = owner.organization_id;
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const availability = Object.fromEntries(days.map((d) => [d, [{ start: "09:00", end: "12:00" }]]));
    await db.query(
      `INSERT INTO tenant.crm_meeting_links(organization_id, owner_user_id, name, slug, duration_minutes, timezone, availability, meeting_provider, public_token, minimum_notice_minutes, maximum_days_ahead)
       VALUES ($1,$2,$3,$4,30,'Asia/Calcutta',$5::jsonb,'manual',$6,0,60)`,
      [organizationId, owner.id, `Product walkthrough ${token.slice(0, 5)}`, `e2e-${token.slice(0, 10)}`, JSON.stringify(availability), token],
    );
    await db.query("COMMIT");
    return await work(token, db);
  } finally {
    if (organizationId) {
      await db.query("BEGIN").catch(() => undefined);
      await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]).catch(() => undefined);
      // The booking leaves activity and event history behind; retire the link instead of deleting that history.
      await db.query(`UPDATE tenant.crm_meeting_links SET status='archived' WHERE public_token=$1`, [token]).catch((e) => console.log("cleanup:", e.message));
      await db.query("COMMIT").catch(() => undefined);
    }
    await db.end();
  }
}

test.describe("public booking", () => {
  test.use({ storageState: { cookies: [], origins: [] }, timezoneId: "Asia/Calcutta", viewport: { width: 390, height: 844 } });

  test("branded, mobile-first, one time-zone name, and a real booking end to end", async ({ page }) => {
    test.setTimeout(240_000);
    await withLink(async (token) => {
      await page.goto(`/book/${token}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await expect(page.getByText("Vercentlabs", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("heading", { name: /Product walkthrough/ })).toBeVisible({ timeout: 60_000 });

      // No horizontal scroll on a 390px phone.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // The two names for India's zone read as one, in words.
      await expect(page.getByText(/India Standard Time \(GMT\+5:30\)/).first()).toBeVisible();
      await expect(page.getByText("Asia/Calcutta")).toHaveCount(0);
      await expect(page.getByText("Asia/Kolkata")).toHaveCount(0);

      // Earlier runs leave meetings behind that fill a host's mornings, so each run books a different day.
      const bookOffset = 2 + Math.floor(Math.random() * 38);
      const tomorrow = new Date(Date.now() + bookOffset * 86_400_000);
      const label = tomorrow.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const day = page.getByRole("button", { name: label });
      if (!(await day.isVisible().catch(() => false))) await page.getByRole("button", { name: "Next month" }).click();
      await day.click();
      const slot = page.getByRole("radio").first();
      await expect(slot).toBeVisible({ timeout: 60_000 });
      const box = await slot.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(43);
      await slot.click();
      await expect(slot).toHaveAttribute("aria-checked", "true");
      await page.getByRole("button", { name: "Continue" }).click();

      // Only what is needed, validated in place.
      await page.getByLabel("Email (required)").fill("not-an-email");
      await page.getByLabel("Your name (required)").fill("Priya Guest");
      await page.getByRole("button", { name: "Confirm booking" }).click();
      await expect(page.getByText(/valid email address/i)).toBeVisible();
      await page.getByLabel("Email (required)").fill("priya." + randomUUID().slice(0, 6) + "@example.com");
      const [bookResponse] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/book") && r.request().method() === "POST", { timeout: 60_000 }),
        page.getByRole("button", { name: "Confirm booking" }).click(),
      ]);
      expect(bookResponse.status(), await bookResponse.text()).toBe(201);

      await expect(page.getByRole("heading", { name: "You are booked" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/India Standard Time \(GMT\+5:30\)/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Add to calendar/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Google Calendar/ })).toBeVisible();
    });
  });

  test("manage a booking: add to calendar, reschedule with real slots, and a confirmed cancel", async ({ page, request }) => {
    test.setTimeout(300_000);
    await withLink(async (token, db) => {
      // Earlier runs leave meetings behind that fill a host's mornings, so each run books a different day.
      const bookOffset = 2 + Math.floor(Math.random() * 38);
      const day = new Date(Date.now() + bookOffset * 86_400_000).toISOString().slice(0, 10);
      const availability = await (await request.get("/api/crm/public/meetings/links/" + token + "/availability?date=" + day)).json();
      const first = availability.slots[0];
      const booked = await request.post("/api/crm/public/meetings/links/" + token + "/book", {
        data: { startsAt: first.startsAt, guestName: "Manage Guest", guestEmail: "manage." + randomUUID().slice(0, 6) + "@example.com", guestTimezone: "Asia/Calcutta" },
      });
      expect(booked.status()).toBe(201);
      const bookingId = (await booked.json()).booking.id as string;
      const owner = (await db.query(`SELECT m.organization_id FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id WHERE u.email=$1 LIMIT 1`, [OWNER_EMAIL])).rows[0];
      await db.query("BEGIN");
      await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [owner.organization_id]);
      const tokens = (await db.query(`SELECT cancellation_token, reschedule_token FROM tenant.crm_meeting_bookings WHERE id=$1`, [bookingId])).rows[0];
      await db.query("COMMIT");

      // Reschedule link: details, add to calendar, real free slots, one click.
      await page.goto("/book/manage/" + tokens.reschedule_token, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await expect(page.getByText("Your meeting")).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText(/India Standard Time [(]GMT[+]5:30[)]/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Add to calendar/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pick a new time" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel this meeting" })).toHaveCount(0);
      const newDay = new Date(Date.now() + (bookOffset + 1) * 86_400_000);
      const label = newDay.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const dayButton = page.getByRole("button", { name: label });
      if (!(await dayButton.isVisible().catch(() => false))) await page.getByRole("button", { name: "Next month" }).click();
      await dayButton.click();
      await page.getByRole("radio").nth(2).click();
      await page.getByRole("button", { name: "Reschedule meeting" }).click();
      await expect(page.getByRole("heading", { name: "Meeting rescheduled" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: /Add to calendar/ })).toBeVisible();

      // The cancel link: cancel is secondary and always asks first.
      await page.goto("/book/manage/" + tokens.cancellation_token, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await expect(page.getByRole("button", { name: "Cancel this meeting" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("heading", { name: "Pick a new time" })).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel this meeting" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: "Keep the meeting" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel this meeting" }).click();
      await page.getByRole("button", { name: "Yes, cancel it" }).click();
      await expect(page.getByRole("heading", { name: "Meeting cancelled" })).toBeVisible({ timeout: 60_000 });
    });
  });
});
