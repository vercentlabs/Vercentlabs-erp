import { test, expect } from "@playwright/test";
import { getPosWorld, openPersonaSession, withPosDb } from "./pos-fixtures";

// Journey C (cash movement + shift history), Journey I (a failed API call
// shows a real error state, never a false empty table) and Journey J (a
// consequential action needs confirmation; cancelling makes no mutation).
// Every state assertion reads real Postgres rows, not just the UI.

test.describe("POS shifts, cash movement and safety", () => {
  test("a supervisor records a paid-out once (double-press safe) and a manager sees it on the shift", async ({ browser }) => {
    test.setTimeout(240_000);
    const world = await getPosWorld();
    const reason = `e2e petty cash ${Date.now()}`;

    const supervisor = await openPersonaSession(browser, world.supervisor);
    try {
      await supervisor.page.goto("/pos/cash-movement", { waitUntil: "domcontentloaded" });
      const amount = supervisor.page.getByRole("textbox", { name: "Amount" });
      await expect(amount).toBeVisible({ timeout: 60_000 });
      await amount.click();
      await amount.press("Control+A");
      await amount.pressSequentially("40");
      await amount.blur();
      await supervisor.page.getByLabel("Reason").fill(reason);

      const record = supervisor.page.getByRole("button", { name: "Record movement" });
      await expect(record).toBeEnabled();
      await record.dblclick();

      await expect(supervisor.page.getByRole("row", { name: new RegExp(reason) })).toBeVisible({ timeout: 30_000 });
    } finally {
      await supervisor.context.close();
    }

    const rows = await withPosDb((client, organizationId) =>
      client
        .query(`SELECT movement_type, amount, shift_id FROM tenant.pos_cash_movements WHERE organization_id=$1 AND reason=$2`, [organizationId, reason])
        .then((r) => r.rows),
    );
    expect(rows, "a double-press must record exactly one movement").toHaveLength(1);
    expect(rows[0].movement_type).toBe("paid_out");
    expect(Math.abs(Number(rows[0].amount))).toBe(40);
    expect(rows[0].shift_id).toBe(world.supervisorShiftId);

    const manager = await openPersonaSession(browser, world.manager);
    try {
      await manager.page.goto(`/pos/shifts/${world.supervisorShiftId}`, { waitUntil: "domcontentloaded" });
      await expect(manager.page.getByText(reason)).toBeVisible({ timeout: 60_000 });
    } finally {
      await manager.context.close();
    }
  });

  test("a failed shifts request shows an actionable error, not an empty table", async ({ browser }) => {
    test.setTimeout(240_000);
    const world = await getPosWorld();
    const { context, page } = await openPersonaSession(browser, world.manager);
    try {
      await page.route("**/api/pos/shifts?**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }));
      await page.goto("/pos/shifts", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Could not load shifts")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(page.getByText("No shifts yet")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("cancelling the store-deactivation confirmation makes no change", async ({ browser }) => {
    test.setTimeout(240_000);
    const world = await getPosWorld();
    const { context, page } = await openPersonaSession(browser, world.manager);
    try {
      await page.goto("/pos/stores", { waitUntil: "domcontentloaded" });
      const storeRow = page.getByRole("row", { name: new RegExp(world.storeCode) });
      await storeRow.getByRole("button", { name: `Deactivate ${world.storeName}`, exact: true }).click({ timeout: 60_000 });
      await expect(page.getByRole("alertdialog")).toContainText(`Deactivate ${world.storeName}?`);
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    } finally {
      await context.close();
    }

    const active = await withPosDb((client, organizationId) =>
      client.query(`SELECT active FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [organizationId, world.storeId]).then((r) => r.rows[0].active as boolean),
    );
    expect(active, "cancel must not have deactivated the store").toBe(true);
  });
});
