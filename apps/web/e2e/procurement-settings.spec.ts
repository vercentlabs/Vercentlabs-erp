import { test, expect, type BrowserContext, type Locator } from "@playwright/test";

import { fixtures } from "./fixtures";
import { getProcurementWorld } from "./procurement-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// The matching-tolerance policy: a buyer can read but not change it (the server
// refuses the write, not just the UI); the owner saves it and it persists. Its
// EFFECT on matching is proven in the domain integration test.
async function call(context: BrowserContext, method: "GET" | "POST" | "PATCH", path: string, data?: unknown) {
  const origin = new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;
  const response = await context.request.fetch(`${origin}/api/procurement${path}`, { method, data, headers: { Origin: origin, "Content-Type": "application/json" } });
  return { status: response.status(), body: await response.json() };
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}

test.describe("Procurement settings", () => {
  test("buyer is read-only and refused; owner saves the tolerance and it persists", async ({ browser }) => {
    test.setTimeout(300_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const owner = await openSession(browser, { email: fixtures.ownerEmail, password: fixtures.ownerPassword, userId: "" });
    let original = 0;
    try {
      const b = buyer.page;
      await b.goto("/procurement/settings", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "Procurement settings" })).toBeVisible({ timeout: 180_000 });
      await expect(b.getByText(/needs the Procurement settings permission/)).toBeVisible();
      await expect(b.getByRole("button", { name: "Save settings" })).toHaveCount(0);
      const refused = await call(buyer.context, "POST", "/policies", { policyType: "matching_tolerance", tolerancePercent: 50 });
      expect(refused.status).toBe(403);

      const existing = await call(owner.context, "GET", "/policies");
      const active = (existing.body.rows as Array<{ policyType?: string; status: string; tolerancePercent?: number }>).find((p) => p.policyType === "matching_tolerance" && p.status === "active");
      original = Number(active?.tolerancePercent ?? 0);

      const o = owner.page;
      await o.goto("/procurement/settings", { waitUntil: "domcontentloaded" });
      await expect(o.getByRole("heading", { name: "Procurement settings" })).toBeVisible({ timeout: 120_000 });
      const box = o.getByRole("textbox", { name: /Price tolerance/ });
      await expect(async () => {
        await setNumber(box, "7.5");
        await o.getByRole("button", { name: "Save settings" }).click();
        await expect(o.getByText(/Saved\. It applies/)).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 45_000 });
      const stored = await call(owner.context, "GET", "/policies");
      const saved = (stored.body.rows as Array<{ policyType?: string; status: string; tolerancePercent?: number }>).find((p) => p.policyType === "matching_tolerance" && p.status === "active");
      expect(Number(saved?.tolerancePercent)).toBe(7.5);
    } finally {
      // leave the shared organisation as found
      const rows = (await call(owner.context, "GET", "/policies")).body.rows as Array<{ id: string; version: number; policyType?: string; status: string }>;
      const active = rows.find((p) => p.policyType === "matching_tolerance" && p.status === "active");
      if (active) await call(owner.context, "PATCH", `/policies/${active.id}`, { policyType: "matching_tolerance", name: "Invoice matching tolerance", tolerancePercent: original, expectedVersion: active.version });
      await buyer.context.close();
      await owner.context.close();
    }
  });
});
