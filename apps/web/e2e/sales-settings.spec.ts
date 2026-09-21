import { test, expect, type BrowserContext } from "@playwright/test";

import { fixtures } from "./fixtures";
import { getSalesWorld, openSalesSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Settings are a control surface: a rep may read them but not change them (the
// SERVER refuses, not just the UI), the organisation owner can change a
// threshold, and the change takes effect on the next order. The original value is
// always restored so the shared fixture organisation is left as found.
async function call(context: BrowserContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const origin = new URL(BASE_URL).origin;
  const response = await context.request.fetch(`${origin}/api/sales${path}`, { method, data, headers: { Origin: origin, "Content-Type": "application/json" } });
  return { status: response.status(), body: await response.json() };
}

test.describe("Sales settings", () => {
  test("rep is read-only and refused; owner change takes effect on approval routing", async ({ browser }) => {
    test.setTimeout(360_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    const owner = await openSalesSession(browser, { email: fixtures.ownerEmail, password: fixtures.ownerPassword, userId: "" });
    let original: { order_approval_amount: string | number } | null = null;
    try {
      // --- rep: page loads read-only; the API refuses a write
      const r = rep.page;
      await r.goto("/sales/settings", { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: "Sales settings" })).toBeVisible({ timeout: 120_000 });
      await expect(r.getByText(/needs the Sales settings permission/)).toBeVisible();
      await expect(r.getByRole("button", { name: "Save settings" })).toHaveCount(0);
      const refused = await call(rep.context, "PUT", "/settings", { orderApprovalAmount: 1 });
      expect(refused.status).toBe(403);

      // --- owner: sets a 1.00 order-approval threshold through the UI
      original = (await call(owner.context, "GET", "/settings")).body.settings;
      const o = owner.page;
      await o.goto("/sales/settings", { waitUntil: "domcontentloaded" });
      await expect(o.getByRole("heading", { name: "Sales settings" })).toBeVisible({ timeout: 120_000 });
      const amount = o.getByRole("textbox", { name: /Approval above amount \(0 = never\)/ });
      await expect(async () => {
        await amount.click();
        await amount.press("Control+A");
        await amount.pressSequentially("1");
        await amount.blur();
        await o.getByRole("button", { name: "Save settings" }).click();
        await expect(o.getByText(/Settings saved/)).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 45_000 });
      const stored = (await call(owner.context, "GET", "/settings")).body.settings;
      expect(Number(stored.order_approval_amount)).toBe(1);

      // --- the threshold now routes a new order to approval instead of auto-approving it
      const options = (await call(rep.context, "GET", "/options")).body.options;
      const party = options.parties.find((p: { display_name: string }) => p.display_name === world.customerName);
      const item = options.items.find((i: { code: string }) => i.code === world.itemCode);
      const priceList = options.priceLists.find((p: { name: string }) => p.name === "Sales E2E Price List");
      const created = await call(rep.context, "POST", "/orders", { partyId: party.id, currencyCode: "INR", priceListId: priceList.id, lines: [{ itemId: item.id, quantity: 1 }] });
      expect(created.status).toBe(201);
      const submitted = await call(rep.context, "POST", `/orders/${created.body.order.id}/submit`, {});
      expect(submitted.body.result.approvalRequired).toBe(true);
    } finally {
      if (original) {
        await call(owner.context, "PUT", "/settings", { orderApprovalAmount: Number(original.order_approval_amount) });
      }
      await rep.context.close();
      await owner.context.close();
    }
  });
});
