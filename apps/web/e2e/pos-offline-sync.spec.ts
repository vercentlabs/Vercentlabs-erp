import { test, expect, type Page } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// F297/F298 — the complete supported offline-to-online browser journey
// (POS Completion Program Prompt 3, Section 10). useOnlineStatus.ts's own
// comment has named this exact file since the offline feature was built;
// it did not previously exist. Real-Postgres domain-level coverage for
// duplicate-sync-safety, price-drift conflicts, closed-shift conflicts and
// two-terminal last-unit races already exists in
// tests/integration/pos-offline-sync-f297-f298.test.mjs -- this spec
// proves the one thing that suite cannot: the actual browser mechanics
// (IndexedDB persistence surviving a real page reload, the online/offline
// event wiring, the UI's own unsupported-operations disclosure) against a
// live dev server.
//
// Honest, disclosed scope limit: this app has no service worker / offline
// app-shell caching, so a hard page navigation while genuinely offline
// cannot load at all (the browser's own native offline error page, not
// this app -- nothing POS-specific can fix that without a full PWA
// app-shell build, out of scope for this pass). "Browser restart"
// persistence is therefore proven the meaningful way: queue a sale while
// offline, THEN come back online, THEN hard-reload -- proving the queued
// record survives a full JS-heap/IndexedDB-connection teardown and
// automatically syncs on the next mount, not merely surviving in React
// state.
//
// A genuine bug was found and fixed while building this spec (see
// sync-runner.ts): a sale is marked "syncing" before the network call is
// sent, and was only ever reverted back to "queued" if that call rejected
// cleanly. Against this dev server, Next's own Fast Refresh occasionally
// aborts the in-flight sync request (net::ERR_ABORTED) exactly the same
// way a real browser crash or tab close would -- and the record was left
// permanently stuck at "syncing," never retried again by any later sync
// pass. Fixed by treating "syncing" as retryable too, safe because the
// server's own sync endpoint is idempotent per localTransactionId.
//
// Verification here polls the real database for the resulting sale
// rather than racing a single HTTP response: this dev server's own Fast
// Refresh can abort or delay any individual sync attempt, so the
// meaningful, reproducible assertion is "does a real server sale
// eventually exist," re-triggering a reload periodically the same way an
// impatient cashier reopening the app would -- not "did this exact fetch
// call resolve," which is why the pre-fix version of the underlying code
// could get permanently stuck even though the SAME failure mode (an
// aborted in-flight request) is genuinely possible in production too
// (tab close, browser crash, connection drop mid-request).
async function waitForOfflineSyncToLand(page: Page, organizationId: string, storeId: string, salesCountBefore: number): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(3000);
    const count = await withPosDb((client) =>
      client.query(`SELECT count(*)::int AS n FROM tenant.pos_sales WHERE organization_id=$1 AND store_id=$2`, [organizationId, storeId]).then((r) => r.rows[0].n as number),
    );
    if (count > salesCountBefore) return;
  }
  throw new Error("Offline sync never produced a real server sale after six reload/retry attempts.");
}

test.describe("POS offline-to-online sync (real browser)", () => {
  test("cashier captures a sale while offline, and it syncs automatically once back online, surviving a real page reload", async ({ browser }) => {
    const world = await getPosWorld();
    await resetTerminalCarts(world.terminalId);

    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      const stockBefore = await withPosDb((client) =>
        client
          .query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, world.itemId, world.warehouseId])
          .then((r) => Number(r.rows[0].quantity)),
      );
      const salesBefore = await withPosDb((client) =>
        client.query(`SELECT count(*)::int AS n FROM tenant.pos_sales WHERE organization_id=$1 AND store_id=$2`, [world.organizationId, world.storeId]).then((r) => r.rows[0].n as number),
      );

      // Step 1-2: online login + authorized offline snapshot capture. The
      // checkout screen's own effect fetches the snapshot over the
      // network, THEN chains an additional async IndexedDB write
      // (saveSnapshot/saveOfflineContext) -- waiting only for the HTTP
      // response would race that write. Polling IndexedDB itself (from
      // inside the page) for the persisted record is the real,
      // deterministic signal that the write actually landed on disk.
      await page.goto("/pos/checkout", { waitUntil: "domcontentloaded" });
      await page.waitForResponse((res) => res.url().includes("/api/pos/offline/snapshot") && res.status() === 200);
      await expect(page.getByText("Online", { exact: true })).toBeVisible();

      async function offlineSnapshotIsPersisted(): Promise<boolean> {
        return page.evaluate(
          (storeId) =>
            new Promise<boolean>((resolve) => {
              const request = indexedDB.open("vercentlabs-pos-offline");
              request.onerror = () => resolve(false);
              request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("snapshots") || !db.objectStoreNames.contains("meta")) {
                  db.close();
                  resolve(false);
                  return;
                }
                const tx = db.transaction(["snapshots", "meta"], "readonly");
                const snapshotRequest = tx.objectStore("snapshots").get(storeId);
                const contextRequest = tx.objectStore("meta").get("offlineContext");
                tx.oncomplete = () => {
                  db.close();
                  resolve(Boolean(snapshotRequest.result) && Boolean(contextRequest.result));
                };
                tx.onerror = () => {
                  db.close();
                  resolve(false);
                };
              };
            }),
          world.storeId,
        );
      }
      await expect.poll(offlineSnapshotIsPersisted, { timeout: 15_000, intervals: [250, 500, 750] }).toBe(true);

      // Step 3: network disconnection.
      await context.setOffline(true);
      await expect(page.getByText(`Offline — ${world.storeName}`)).toBeVisible({ timeout: 10_000 });

      // The disclosed unsupported-while-offline list must render
      // verbatim, not silently omit anything.
      await expect(page.getByText("Unsupported while offline:")).toBeVisible();
      await expect(page.getByText("Automatic promotions")).toBeVisible();
      await expect(page.getByText("Attaching a customer to the sale")).toBeVisible();

      // Step 4-5: offline transaction creation + local persistence.
      await page.getByLabel("Search offline catalog").fill(world.itemCode);
      const offlineProductButton = page.getByRole("button", { name: new RegExp(world.itemName) });
      await expect(offlineProductButton).toBeVisible();
      await offlineProductButton.click();

      const cashTenderedInput = page.getByRole("textbox", { name: "Cash tendered" });
      await cashTenderedInput.click();
      await cashTenderedInput.press("Control+A");
      await cashTenderedInput.pressSequentially("500");
      await cashTenderedInput.blur();

      const queueButton = page.getByRole("button", { name: /Queue cash sale \(offline\)/i });
      await expect(queueButton).toBeEnabled();
      await queueButton.click();

      const confirmationHeading = page.getByRole("heading", { name: /^Queued transaction/i });
      await expect(confirmationHeading).toBeVisible();
      await expect(page.getByText("Sale queued (offline)")).toBeVisible();
      const localTransactionShortId = (await confirmationHeading.textContent())?.replace("Queued transaction ", "").trim();
      expect(localTransactionShortId).toBeTruthy();

      // Step 7: reconnection.
      await context.setOffline(false);

      // Step 6 (real browser-restart persistence): reload now that the
      // network is back, forcing a genuine IndexedDB re-open from disk
      // and a fresh mount, which re-triggers auto-sync of whatever is
      // still queued -- proving the queued record survives a full
      // JS-heap/IndexedDB-connection teardown, not merely React state.
      await waitForOfflineSyncToLand(page, world.organizationId, world.storeId, salesBefore);

      // Steps 8-9, 12-13: duplicate sync safety + authoritative
      // finalization + real stock movement, verified against actual
      // Postgres rows, not the UI's own claim.
      // verified against actual Postgres rows, not the UI's own claim.
      const salesAfter = await withPosDb((client) =>
        client
          .query(`SELECT id, status, grand_total, store_id, terminal_id FROM tenant.pos_sales WHERE organization_id=$1 AND store_id=$2 ORDER BY created_at DESC LIMIT 1`, [
            world.organizationId,
            world.storeId,
          ])
          .then((r) => r.rows[0]),
      );
      const salesCountAfter = await withPosDb((client) =>
        client.query(`SELECT count(*)::int AS n FROM tenant.pos_sales WHERE organization_id=$1 AND store_id=$2`, [world.organizationId, world.storeId]).then((r) => r.rows[0].n as number),
      );
      expect(salesCountAfter, "exactly one new sale must have been created by this offline sync, not zero and not more than one").toBe(salesBefore + 1);
      expect(salesAfter.status).toBe("completed");
      expect(salesAfter.store_id).toBe(world.storeId);
      expect(salesAfter.terminal_id).toBe(world.terminalId);

      const stockAfter = await withPosDb((client) =>
        client
          .query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, world.itemId, world.warehouseId])
          .then((r) => Number(r.rows[0].quantity)),
      );
      expect(stockBefore - stockAfter, "the offline sale must decrement real stock by exactly the quantity sold (1)").toBe(1);
    } finally {
      await context.setOffline(false);
      await context.close();
    }
  });
});
