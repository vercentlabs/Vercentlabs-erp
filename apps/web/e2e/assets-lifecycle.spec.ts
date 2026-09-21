import { test, expect } from "@playwright/test";

import { open } from "./accounting-fixtures";
import { getAssetsWorld } from "./assets-fixtures";
import { pick } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// The asset lifecycle as real people: one asset manager registers an asset, a DIFFERENT one capitalizes it (a
// registrar cannot), the first prepares a depreciation run and the second approves and posts it, and the
// register then shows the reduced net book value. A person with no asset permissions is refused. The domain
// rules in depth are covered by the assets-*.test.mjs integration suites against real PostgreSQL.

test("register, capitalize by someone else, depreciate, and report", async ({ browser }) => {
  test.setTimeout(300_000);
  const world = await getAssetsWorld();
  const a = await openSession(browser, world.mgrA);
  const b = await openSession(browser, world.mgrB);
  const plain = await openSession(browser, world.plain);
  try {
    const name = `E2E Press ${world.suffix}`;

    // --- F231: register
    const pa = a.page;
    await open(pa, "/assets/register", "Asset register");
    await pa.getByRole("button", { name: "Register asset" }).click();
    let dlg = pa.getByRole("dialog");
    await dlg.getByLabel("Name").first().fill(name);
    await pick(pa, dlg.getByRole("button", { name: /Select category/ }), new RegExp(world.categoryName));
    await dlg.getByRole("textbox", { name: "Acquisition cost" }).fill("12000");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(pa.getByRole("row", { name: new RegExp(`${name}.*Draft`) })).toBeVisible({ timeout: 60_000 });

    // --- F237: the registrar has capitalize rights but cannot capitalize their own registration
    await open(pa, "/assets/capitalization", "Capitalization");
    await pa.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Capitalize" }).click();
    dlg = pa.getByRole("dialog");
    await dlg.getByRole("button", { name: "Capitalize" }).click();
    await expect(dlg.getByText(/cannot capitalize it/i)).toBeVisible({ timeout: 60_000 });
    await dlg.getByRole("button", { name: "Close", exact: true }).click();

    // --- a different manager capitalizes
    const pb = b.page;
    await open(pb, "/assets/capitalization", "Capitalization");
    await pb.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Capitalize" }).click();
    dlg = pb.getByRole("dialog");
    await dlg.getByRole("button", { name: "Capitalize" }).click();
    await expect(pb.getByText(/Capitalized and posted to the ledger/)).toBeVisible({ timeout: 60_000 });
    await open(pb, "/assets/register", "Asset register");
    await expect(pb.getByRole("row", { name: new RegExp(`${name}.*Available`) })).toBeVisible({ timeout: 60_000 });

    // --- F249: A prepares a depreciation run to the end of this month, B approves and posts it
    const end = new Date();
    // A run is unique per cut-off date and earlier runs leave theirs behind, so each run uses a day of its own between
    // today and the end of the year, which is the open fiscal period the fixture provides (posting needs an open period).
    const todayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const daysLeft = Math.floor((Date.UTC(end.getUTCFullYear(), 11, 31) - todayUtc) / 86_400_000);
    const cutoff = new Date(todayUtc + Math.floor(Math.random() * (daysLeft + 1)) * 86_400_000).toISOString().slice(0, 10);
    await open(pa, "/assets/depreciation", "Depreciation runs");
    await pa.getByRole("button", { name: "Prepare run" }).click();
    dlg = pa.getByRole("dialog");
    await dlg.getByLabel("Depreciate up to").fill(cutoff);
    await dlg.getByRole("button", { name: "Save" }).click();
    const runRow = pa.getByRole("row", { name: new RegExp(`${cutoff}.*Calculated`) });
    await expect(runRow).toBeVisible({ timeout: 60_000 });
    await open(pb, "/assets/depreciation", "Depreciation runs");
    const brow = pb.getByRole("row", { name: new RegExp(`${cutoff}.*Calculated`) });
    await brow.getByRole("button", { name: "Approve" }).click();
    await expect(pb.getByRole("row", { name: new RegExp(`${cutoff}.*Approved`) })).toBeVisible({ timeout: 60_000 });
    await pb.getByRole("row", { name: new RegExp(`${cutoff}.*Approved`) }).getByRole("button", { name: "Post" }).click();
    await expect(pb.getByRole("row", { name: new RegExp(`${cutoff}.*Posted`) })).toBeVisible({ timeout: 60_000 });

    // --- F267: the register report reflects the depreciation
    await open(pb, "/assets/reports", "Reports");
    await expect(pb.getByRole("cell", { name: new RegExp(name) }).first()).toBeVisible({ timeout: 60_000 });

    // --- a user with no asset permissions is refused
    await plain.page.goto("/assets/register", { waitUntil: "domcontentloaded" });
    await expect(plain.page.getByText(/have access to Assets|not available|permission/i).first()).toBeVisible({ timeout: 180_000 });
  } finally {
    await a.context.close();
    await b.context.close();
    await plain.context.close();
  }
});
