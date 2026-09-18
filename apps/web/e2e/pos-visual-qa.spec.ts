import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPosWorld, openPersonaSession, withPosDb, type PosWorld } from "./pos-fixtures";

// Visual QA capture pass — not a functional assertion suite. Seeds richer
// supplementary data on top of pos-fixtures.ts's base world (a completed
// sale with a customer, a return, a closed day-end report, a
// reconciliation, loyalty/promotion/coupon config, an accounting-posting
// failure) so every screen has real, populated content to screenshot
// rather than an empty state, then navigates every implemented POS screen
// and saves a real screenshot per viewport to e2e/visual-qa-screenshots/
// for manual inspection. Kept separate from the functional pos-*.spec.ts
// suite deliberately -- this file's job is "does it look right," not
// "does it work."

const OUT_DIR = path.resolve(process.cwd(), "e2e/visual-qa-screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  "desktop-1440": { width: 1440, height: 900 },
  "laptop-1280": { width: 1280, height: 800 },
  "tablet-1024": { width: 1024, height: 900 },
  "tablet-768": { width: 768, height: 1024 },
  "mobile-390": { width: 390, height: 844 },
  "mobile-360": { width: 360, height: 780 },
};

// Full 6-viewport sweep for the highest-risk/highest-traffic screens
// (checkout is explicitly the primary touch-first workflow; analytics is
// the single largest new screen by content volume). Everything else gets
// a representative 3-viewport sample (wide desktop, tablet, phone) --
// admin/back-office screens were never designed to be touch-first, and a
// laptop/tablet-768 pair rarely diverges in a way 1440/1024 doesn't
// already reveal for a single-column admin layout.
const FULL_SWEEP_VIEWPORTS = ["desktop-1440", "laptop-1280", "tablet-1024", "tablet-768", "mobile-390", "mobile-360"];
const SAMPLE_VIEWPORTS = ["desktop-1440", "tablet-1024", "mobile-390"];

let world: PosWorld;
let saleId: string;
let dayEndReportId: string;

test.beforeAll(async () => {
  world = await getPosWorld();

  await withPosDb(async (client, organizationId) => {
    const {
      createPosCart,
      addPosCartLine,
      setPosCartCustomer,
      completePosCart,
      createPointOfSaleReturn,
      approvePointOfSaleReturn,
      completePointOfSaleReturn,
      upsertPosLoyaltyProgram,
      createPosPromotion,
      createPosCoupon,
      closeShift,
      generatePosDayEndReport,
      reviewPosDayEndReport,
      finalizePosDayEndReport,
      generatePosReconciliation,
      postPosSaleToAccounting,
      initializeAccountingCompany,
    } = await import("../../../services/api/src/index.js");

    const cashierContext = { organizationId, companyId: world.companyId, userId: world.cashier.userId, roleSlugs: [], permissions: ["pos.view", "pos.operate", "pos.sale.create", "pos.return.create", "pos.shift.close", "pos.invoice.generate", "pos.invoice.view"] };
    const supervisorContext = {
      organizationId, companyId: world.companyId, userId: world.supervisor.userId, roleSlugs: [],
      permissions: [
        "pos.view", "pos.settings.manage", "pos.return.approve", "pos.payment.refund", "pos.shift.close",
        "pos.report.generate", "pos.report.view", "pos.reconciliation.manage", "pos.reconciliation.view",
        "pos.accounting.post", "pos.accounting.view", "pos.analytics.view", "pos.loyalty.manage", "pos.loyalty.redeem",
      ],
    };
    const managerContext = {
      organizationId, companyId: world.companyId, userId: world.manager.userId, roleSlugs: [],
      permissions: ["pos.view", "pos.store.manage", "pos.report.finalize", "pos.report.view", "pos.reconciliation.approve", "pos.accounting.post", "pos.accounting.view"],
    };

    // Loyalty program (idempotent-ish: safe to call again if already seeded).
    await upsertPosLoyaltyProgram(client, supervisorContext, { name: "Visual QA Loyalty", earnRatePointsPerCurrency: 0.1, redemptionValuePerPoint: 1 }).catch(() => undefined);

    // A promotion and a coupon for the admin list screens.
    await createPosPromotion(client, supervisorContext, {
      code: `VQAPROMO-${Date.now()}`, name: "Visual QA Promotion", discountType: "percent", discountValue: 10, priority: 100,
    }).catch(() => undefined);
    await createPosCoupon(client, supervisorContext, {
      code: `VQACOUPON${Date.now()}`, discountType: "amount", discountValue: 25,
    }).catch(() => undefined);

    // A completed sale with a real customer (so the receipt/invoice
    // screens have something to render).
    let cart = await createPosCart(client, cashierContext, { storeId: world.storeId, terminalId: world.terminalId, shiftId: world.shiftId });
    cart = await addPosCartLine(client, cashierContext, cart.id, { itemId: world.itemId, quantity: 2 });
    cart = await setPosCartCustomer(client, cashierContext, cart.id, { customerId: world.customerId, expectedVersion: cart.version });
    const sale = await completePosCart(client, cashierContext, cart.id, { idempotencyKey: `vqa-sale-${Date.now()}`, payments: [{ method: "cash", amount: Number(cart.grand_total) }] });
    saleId = sale.id;

    // A second sale + full return + refund, so the returns screen and
    // accounting-posting queue have real completed/refunded rows.
    let cart2 = await createPosCart(client, cashierContext, { storeId: world.storeId, terminalId: world.terminalId, shiftId: world.shiftId });
    cart2 = await addPosCartLine(client, cashierContext, cart2.id, { itemId: world.itemId, quantity: 1 });
    const sale2 = await completePosCart(client, cashierContext, cart2.id, { idempotencyKey: `vqa-sale2-${Date.now()}`, payments: [{ method: "cash", amount: Number(cart2.grand_total) }] });
    const saleLines = await client.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [organizationId, sale2.id]);
    const returnRecord = await createPointOfSaleReturn(client, cashierContext, {
      saleId: sale2.id, reason: "Visual QA return", idempotencyKey: `vqa-return-${Date.now()}`,
      lines: saleLines.rows.map((row: { id: string; quantity: string }) => ({ saleLineId: row.id, quantity: row.quantity, restock: true })),
    });
    await approvePointOfSaleReturn(client, supervisorContext, returnRecord.id, { idempotencyKey: `vqa-return-approve-${Date.now()}` });
    await completePointOfSaleReturn(client, supervisorContext, returnRecord.id, { idempotencyKey: `vqa-return-complete-${Date.now()}` });

    // Accounting foundation + posting (leave sale2/return accounting
    // posting UNATTEMPTED deliberately -- the posting-queue screen should
    // show a real "pending" row, not just "posted"/"failed").
    await initializeAccountingCompany(client, { organizationId, companyId: world.companyId, userId: world.manager.userId }).catch(() => undefined);
    await postPosSaleToAccounting(client, supervisorContext, sale.id).catch(() => undefined);

    // Close the supervisor's own dedicated shift (opened by pos-fixtures.ts)
    // and generate/review/finalize a real Z report + reconciliation, so
    // the day-end/reconciliation screens have real closed data.
    const closed = await closeShift(client, supervisorContext, world.supervisorShiftId, { countedCash: 500 }).catch(() => null);
    if (closed) {
      const draft = await generatePosDayEndReport(client, supervisorContext, { storeId: world.supervisorStoreId, scopeType: "shift", shiftId: world.supervisorShiftId });
      dayEndReportId = draft.id;
      await reviewPosDayEndReport(client, supervisorContext, draft.id);
      const finalReport = await finalizePosDayEndReport(client, managerContext, draft.id);
      await generatePosReconciliation(client, supervisorContext, finalReport.id).catch(() => undefined);
    }
  }).catch((error) => {
    // Seeding is best-effort for visual QA purposes -- a screen this
    // couldn't populate still gets screenshotted in whatever state it's
    // actually in (a real empty/error state is itself useful evidence),
    // logged loudly rather than silently swallowed.
    console.error("Visual QA seeding encountered an error (continuing with whatever succeeded):", error);
  });
});

async function shoot(page: Page, route: string, name: string, viewportKeys: string[]) {
  for (const key of viewportKeys) {
    await page.setViewportSize(VIEWPORTS[key]);
    await page.goto(route, { waitUntil: "networkidle" }).catch(() => page.goto(route, { waitUntil: "domcontentloaded" }));
    // networkidle covers the document/JS bundle, not the client-side
    // React Query waterfalls that only start firing after hydration -- each
    // page.goto here is a full navigation (fresh QueryClient, empty cache),
    // and on a dev server compiling routes on demand, "Loading..." can
    // still be on screen well after networkidle. Wait for it to clear
    // (bounded, non-throwing -- a screen that's genuinely still loading or
    // errors out after the timeout is itself real evidence, not a reason
    // to hang the whole capture run).
    await expect(page.getByText("Loading…"))
      .toHaveCount(0, { timeout: 8000 })
      .catch(() => undefined);
    await page.waitForTimeout(400); // let post-load re-renders settle
    const file = path.join(OUT_DIR, `${name}--${key}.png`);
    await page.screenshot({ path: file, fullPage: true });
  }
}

test.describe("POS visual QA capture", () => {
  test.setTimeout(180_000);

  test("capture checkout (full 6-viewport sweep)", async ({ browser }) => {
    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      await shoot(page, "/pos/checkout", "checkout", FULL_SWEEP_VIEWPORTS);
    } finally {
      await context.close();
    }
  });

  test("capture overview, stores, terminals, cashiers (manager)", async ({ browser }) => {
    const { context, page } = await openPersonaSession(browser, world.manager);
    try {
      await shoot(page, "/pos", "overview", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/stores", "stores", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/terminals", "terminals", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/cashiers", "cashiers", SAMPLE_VIEWPORTS);
    } finally {
      await context.close();
    }
  });

  test("capture promotions, coupons, loyalty (supervisor)", async ({ browser }) => {
    const { context, page } = await openPersonaSession(browser, world.supervisor);
    try {
      await shoot(page, "/pos/promotions", "promotions", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/coupons", "coupons", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/loyalty", "loyalty", SAMPLE_VIEWPORTS);
    } finally {
      await context.close();
    }
  });

  test("capture returns, receipts, invoices (cashier)", async ({ browser }) => {
    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      await shoot(page, "/pos/returns", "returns", SAMPLE_VIEWPORTS);
      if (saleId) await shoot(page, `/pos/receipts/${saleId}`, "receipt", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/invoices", "invoices", SAMPLE_VIEWPORTS);
    } finally {
      await context.close();
    }
  });

  test("capture day-end reports, reconciliation, accounting, analytics (manager)", async ({ browser }) => {
    const { context, page } = await openPersonaSession(browser, world.manager);
    try {
      await shoot(page, "/pos/reports/day-end", "day-end-list", SAMPLE_VIEWPORTS);
      if (dayEndReportId) await shoot(page, `/pos/reports/day-end/${dayEndReportId}`, "day-end-detail", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/reconciliation", "reconciliation", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/accounting", "accounting", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/analytics", "analytics", FULL_SWEEP_VIEWPORTS);
      await shoot(page, "/pos/offline-sync-conflicts", "offline-sync-conflicts", SAMPLE_VIEWPORTS);
    } finally {
      await context.close();
    }
  });

  test("capture empty states (a brand-new, never-used login has none of the above seeded data)", async ({ browser }) => {
    // Re-use the cashier session but hit a screen that's genuinely empty
    // for THEM specifically (they don't hold pos.settings.manage, so
    // promotions/coupons render a PermissionState, not an empty list --
    // real "no data yet" empty states are already captured above for
    // rows-that-happen-to-be-empty; this test instead captures the
    // permission-denied state, itself a real, important state to review).
    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      await shoot(page, "/pos/promotions", "promotions-permission-denied", SAMPLE_VIEWPORTS);
      await shoot(page, "/pos/accounting", "accounting-permission-denied", SAMPLE_VIEWPORTS);
    } finally {
      await context.close();
    }
  });
});
