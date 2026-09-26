import { test, expect } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// Task journeys #3 (duplicate/retry safety) and #4 (stale cart conflict).
// Both use the cashier persona's own dedicated terminal (world.terminalId)
// and reset it first so either test can run independently of file order.

test.describe("POS checkout safety", () => {
  test("duplicate completion with the same idempotency key produces exactly one sale", async ({ browser }) => {
    const world = await getPosWorld();
    await resetTerminalCarts(world.terminalId);

    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      const [createResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
        page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
      ]);
      const cart = (await createResponse.json()).cart as { id: string; version: number };

      await page.getByLabel("Search products").fill(world.itemCode);
      const productButton = page.getByRole("button", { name: new RegExp(world.itemName) });
      await expect(productButton).toBeVisible();
      const [addLineResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/lines") && res.request().method() === "POST"),
        productButton.click(),
      ]);
      const pricedCart = (await addLineResponse.json()).cart as { id: string; version: number; grand_total: string };

      // services/api/src/core/security/request-security.js's assertSameOrigin requires a
      // real Origin/Referer header, which a genuine browser fetch always
      // sends but Playwright's APIRequestContext does not add on its own
      // -- set it explicitly to what this same page would send.
      const origin = new URL(page.url()).origin;

      const idempotencyKey = `e2e-duplicate-safety-${Date.now()}`;
      const body = {
        payments: [{ method: "cash", amount: Number(pricedCart.grand_total) }],
        idempotencyKey,
        expectedVersion: pricedCart.version,
        expectedGrandTotal: pricedCart.grand_total,
      };

      // Two genuinely concurrent completions with the IDENTICAL
      // idempotency key -- simulating a client retry (timeout + resend) or
      // a double-click racing past the button's own isDisabled guard.
      const [respA, respB] = await Promise.all([
        page.request.post(`/api/pos/carts/${cart.id}/complete`, { data: body, headers: { origin } }),
        page.request.post(`/api/pos/carts/${cart.id}/complete`, { data: body, headers: { origin } }),
      ]);
      const [bodyA, bodyB] = await Promise.all([respA.json(), respB.json()]);

      const succeeded = [
        { resp: respA, body: bodyA },
        { resp: respB, body: bodyB },
      ].filter((r) => r.resp.status() === 201);
      expect(succeeded.length, `at least one of the two duplicate completions must succeed: ${JSON.stringify([bodyA, bodyB])}`).toBeGreaterThanOrEqual(1);

      // Whichever succeeded, both responses must agree on exactly one sale
      // id -- either the second is a genuine idempotent replay of the
      // first's sale, or it was cleanly rejected (never a second sale).
      const saleIds = new Set([bodyA, bodyB].filter((b) => b.ok && b.sale).map((b) => b.sale.id));
      expect(saleIds.size, `both responses must reference the same sale, not two different ones: ${JSON.stringify([bodyA, bodyB])}`).toBe(1);

      const saleRows = await withPosDb((client) =>
        client.query(`SELECT id FROM tenant.pos_sales WHERE organization_id=$1 AND cart_id=$2`, [world.organizationId, cart.id]).then((r) => r.rows),
      );
      expect(saleRows.length, "exactly one pos_sales row must exist for this cart, regardless of how many completion attempts raced").toBe(1);

      const idempotencyRows = await withPosDb((client) =>
        client
          .query(`SELECT count(*)::int AS n FROM tenant.operation_idempotency WHERE organization_id=$1 AND operation='pos.sale.complete' AND idempotency_key=$2`, [
            world.organizationId,
            idempotencyKey,
          ])
          .then((r) => r.rows[0].n),
      );
      expect(idempotencyRows).toBe(1);

      // UI-level proof of "no duplicate confirmation/error": a fresh load
      // of the checkout screen for this cashier starts a clean new cart,
      // with no stuck error banner left over from the race.
      await page.goto("/pos/checkout", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
      await expect(page.getByText("Cart is empty")).toBeVisible();
      // Real test bug found and fixed (POS Completion Program Prompt 2):
      // this regex matched ordinary, benign product copy ("...resume
      // checkout if a shift is already open") whenever the page happened
      // to render the /pos overview's own "Open a shift" state instead of
      // checkout -- a false positive completely unrelated to whether an
      // error banner exists. Every real error banner in this app uses
      // role="alert" (see PosCheckoutScreen.tsx and every other POS
      // screen's own error rendering) -- checking that directly is both
      // more precise and actually verifies the thing this assertion is
      // meant to prove.
      // Real test bug found and fixed (POS Completion Program Prompt 2):
      // an unscoped role="alert" check always finds one match here
      // regardless of any real POS error state -- the app has its own
      // always-mounted, empty-by-default accessibility live region using
      // the same role (confirmed by dumping its text content: exactly one
      // match, empty string, with the URL genuinely still /pos/checkout,
      // not redirected). PosCheckoutScreen.tsx's own real error/conflict
      // banners (the only two role="alert" elements it renders itself)
      // are both conditionally mounted on non-empty state and always
      // carry real text -- filtering to non-empty text is what actually
      // distinguishes a real error banner from that unrelated live region.
      await expect(page.getByRole("alert").filter({ hasText: /.+/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("a cart mutated from a second channel after the cashier loaded it surfaces a real conflict, not a silent stale-data success", async ({ browser }) => {
    const world = await getPosWorld();
    await resetTerminalCarts(world.terminalId);

    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      const [createResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
        page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
      ]);
      const cart = (await createResponse.json()).cart as { id: string };

      await page.getByLabel("Search products").fill(world.itemCode);
      const productButton = page.getByRole("button", { name: new RegExp(world.itemName) });
      await expect(productButton).toBeVisible();
      const [addLineResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/lines") && res.request().method() === "POST"),
        productButton.click(),
      ]);
      const staleCart = (await addLineResponse.json()).cart as { id: string; version: number; grand_total: string };
      expect(staleCart.grand_total).toBe("295.000000"); // 1 x 250 + 18% GST

      // Tender generously ahead of time so the button stays enabled no
      // matter how the second channel changes the total below.
      const cashTenderedInput = page.getByRole("textbox", { name: "Amount" });
      await cashTenderedInput.click();
      await cashTenderedInput.press("Control+A");
      await cashTenderedInput.pressSequentially("5000");
      await cashTenderedInput.blur();
      await expect(page.getByRole("button", { name: /Complete sale/i })).toBeEnabled();

      // Second channel: the SAME cashier's own session (a second tab/
      // device is the realistic case; the point under test is the SERVER
      // treating a change it didn't originate from as authoritative, not
      // which browser tab happened to make it), adding a second unit
      // directly via the real API -- bumping the cart's real version/total
      // to something the first page's in-memory `cart` state never saw.
      const origin = new URL(page.url()).origin;
      const secondChannelResponse = await page.request.post(`/api/pos/carts/${cart.id}/lines`, {
        data: { itemId: world.itemId, quantity: 1, expectedVersion: staleCart.version },
        headers: { origin },
      });
      expect(secondChannelResponse.status()).toBe(200);
      const winningCart = (await secondChannelResponse.json()).cart as { version: number; grand_total: string };
      expect(winningCart.grand_total).toBe("590.000000"); // now 2 x 250 + 18% GST

      // The cashier's page still only knows about the FIRST (stale)
      // version/total -- completing now must be rejected as a conflict,
      // never silently accepted against the now-outdated snapshot.
      const [completeResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/complete")),
        page.getByRole("button", { name: /Complete sale/i }).click(),
      ]);
      expect(completeResponse.status(), "a stale completion attempt must be rejected, not silently succeed").not.toBe(201);
      const completeBody = await completeResponse.json();
      expect(["POS_CART_VERSION_CONFLICT", "POS_PRICE_CONFLICT"]).toContain(completeBody.code);

      await expect(page.getByText(/the cart was refreshed with current server totals/i)).toBeVisible();

      // Real Postgres facts: no sale exists for this cart yet, and the
      // cart itself reflects the WINNING (second-channel) state, not the
      // stale one the rejected request tried to use.
      const dbState = await withPosDb((client) =>
        client.query(`SELECT status, version, grand_total FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [world.organizationId, cart.id]).then((r) => r.rows[0]),
      );
      expect(dbState.status).toBe("priced");
      expect(dbState.version).toBe(winningCart.version);
      expect(dbState.grand_total).toBe("590.000000");
      const saleRows = await withPosDb((client) =>
        client.query(`SELECT id FROM tenant.pos_sales WHERE organization_id=$1 AND cart_id=$2`, [world.organizationId, cart.id]).then((r) => r.rows),
      );
      expect(saleRows.length).toBe(0);

      // Cleanup/closure: the now-refreshed cart in the UI can still be
      // completed normally -- proving the conflict path recovers rather
      // than permanently wedging the terminal. The conflict handler
      // dispatches its own getPosCart(...).then(setCart) fire-and-forget
      // (see PosCheckoutScreen's `run()`), so wait for the UI to actually
      // show the winning total before retrying -- otherwise this retry
      // could itself race the refresh and be rejected a second time.
      await expect(page.getByText("INR 590.00").first()).toBeVisible({ timeout: 10_000 });
      const [finalComplete] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/complete")),
        page.getByRole("button", { name: /Complete sale/i }).click(),
      ]);
      expect(finalComplete.status()).toBe(201);
    } finally {
      await context.close();
    }
  });
});
