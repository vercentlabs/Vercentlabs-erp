import { test, expect } from "@playwright/test";

import { getAccountingWorld, open } from "./accounting-fixtures";
import { pick } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// The ledger as real people: an accountant prepares a balanced journal entry and submits it (and has no
// approval authority), a finance manager approves and posts it, and the posted entry shows up in the trial
// balance. A person with no accounting permissions is refused. The deeper domain rules are covered by the
// accounting-*.test.mjs integration suites against real PostgreSQL; this spec walks the screens.

test("a journal entry is prepared, approved by someone else, posted and reported", async ({ browser }) => {
  test.setTimeout(400_000);
  const world = await getAccountingWorld();
  const acc = await openSession(browser, world.accountant);
  const fin = await openSession(browser, world.finance);
  const plain = await openSession(browser, world.plain);
  try {
    const memo = `E2E accrual ${world.suffix}`;
    const a = acc.page;
    await open(a, "/accounting/journals", "Journal entries");
    await a.getByRole("button", { name: "New journal entry" }).click();
    await expect(a.getByRole("heading", { name: "New journal entry" })).toBeVisible({ timeout: 120_000 });
    await pick(a, a.getByRole("button", { name: /Select.../ }).first(), /General/);
    await a.getByLabel("Description").first().fill(memo);
    await pick(a, a.getByRole("button", { name: /Select.../ }).first(), /6100 General expense/);
    await pick(a, a.getByRole("button", { name: /Select.../ }).first(), /1110 Cash on hand/);
    await a.getByLabel("Debit").nth(0).fill("250");
    await a.getByLabel("Credit").nth(1).fill("250");
    await expect(a.getByText(/Balanced/)).toBeVisible();
    await a.getByRole("button", { name: "Save draft" }).click();
    const row = a.getByRole("row", { name: new RegExp(memo) });
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "Submit" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${memo}.*Pending approval`) })).toBeVisible({ timeout: 60_000 });
    await expect(a.getByRole("row", { name: new RegExp(memo) }).getByRole("button", { name: "Approve" })).toHaveCount(0);

    const f = fin.page;
    await open(f, "/accounting/journals", "Journal entries");
    const frow = f.getByRole("row", { name: new RegExp(memo) });
    await expect(frow).toBeVisible({ timeout: 60_000 });
    await frow.getByRole("button", { name: "Approve" }).click();
    await expect(f.getByRole("row", { name: new RegExp(`${memo}.*Approved`) })).toBeVisible({ timeout: 60_000 });
    await f.getByRole("row", { name: new RegExp(memo) }).getByRole("button", { name: "Post" }).click();
    await expect(f.getByRole("row", { name: new RegExp(`${memo}.*Posted`) })).toBeVisible({ timeout: 60_000 });

    await open(f, "/accounting/trial-balance", "Trial balance");
    await f.getByRole("button", { name: "Run report" }).click();
    await expect(f.getByRole("cell", { name: /General expense/ }).first()).toBeVisible({ timeout: 60_000 });

    await plain.page.goto("/accounting/journals", { waitUntil: "domcontentloaded" });
    await expect(plain.page.getByText(/have access to Accounting|not available|permission/i).first()).toBeVisible({ timeout: 180_000 });
  } finally {
    await acc.context.close();
    await fin.context.close();
    await plain.context.close();
  }
});
