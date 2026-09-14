// Real-browser evidence for the full Procurement source-to-pay journey
// (Supplier -> Requisition -> RFQ -> Purchase Order -> Goods Receipt ->
// Supplier Bill -> Payment), driven through two distinct real authenticated
// sessions against the real Next.js API routes and a real Postgres
// database — reusing the same authenticated ERP Playwright gate
// (playwright.erp.config.ts, erp-auth.setup.ts) every other erp-*.spec.ts
// file already uses, plus the Procurement-specific fixture data from
// scripts/e2e-fixture-procurement.mts (a second real user with the
// organization_owner role, and Item/Warehouse/UOM/Accounting-partner
// master data that no module in this repo yet exposes an HTTP API to
// create).
//
// Two sessions are required, not one: transitionProcurementRecord's real
// self-approval guard (PROCUREMENT_SELF_APPROVAL) correctly rejects the
// same user both creating AND approving/qualifying a Procurement document,
// so this test uses the default fixture owner as the "buyer" (create/
// submit/dispatch) and a second, dedicated fixture user as the "approver"
// (qualify/approve), matching how a real segregated-duties workflow would
// actually run in the browser.
//
// This is deliberately API-driven (fetch through the authenticated
// browser session) for most of the document lifecycle, exactly like this
// repo's own erp-crm-opportunity-journey.spec.ts — with real UI navigation
// and rendered-content assertions at the checkpoints that matter most:
// the Supplier record reaching Active, the Receipt approval that this
// session's F080/F081 fix made actually move Stock, and the vendor Bill
// reaching fully paid in Accounting.
import { devices, expect, test, type Page } from "@playwright/test";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this E2E gate. Run "pnpm --filter @vercentlabs/web e2e:bootstrap:procurement" first.`);
  }
  return value;
}

async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, body: json as Record<string, unknown> };
    },
    { method, url, body },
  );
}

async function transition(
  page: Page,
  resource: string,
  id: string,
  action: string,
  expectedVersion: number,
  extra: Record<string, unknown> = {},
) {
  const result = await api(page, "POST", `/api/procurement/resources/${resource}/${id}/actions`, {
    action,
    expectedVersion,
    ...extra,
  });
  expect(result.status, `${resource}/${id} action=${action} -> ${JSON.stringify(result.body)}`).toBe(200);
  return result.body.record as Record<string, unknown>;
}

// This fixture organization (a real seedOrganizationFoundation-onboarded
// org, not a hand-tuned test shortcut) defaults BOTH
// vendor_bill_approval_required and vendor_payment_approval_required to
// true with a zero threshold -- so submitting a real bill or payment always
// creates a pending public.approval_requests row rather than
// auto-approving. approveSubledgerDocument's own separation-of-duties rule
// (assertSeparationOfDuties) then rejects the same user who submitted from
// also approving, so `approverPage` (submitter) hands off to the buyer
// `page` here, exactly like Procurement's own creator/approver split.
async function approveIfRequired(submitterPage: Page, approverPage: Page, submitResult: Record<string, unknown>) {
  if (!submitResult.approvalRequired) return;
  const approvalRequest = submitResult.approvalRequest as Record<string, unknown>;
  const decision = await api(approverPage, "PATCH", `/api/approvals/${approvalRequest.id}`, {
    action: "approve",
    expectedVersion: Number(approvalRequest.version),
  });
  expect(decision.status, `approve ${approvalRequest.id} -> ${JSON.stringify(decision.body)}`).toBe(200);
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

test.describe("Procurement F063-F096 — real browser Supplier-to-Payment journey", () => {
  test("Supplier -> Requisition -> RFQ -> Purchase Order -> Goods Receipt (real Stock effect) -> Supplier Bill -> Payment", async ({ page, browser }) => {
    // This journey drives ~20 sequential API calls plus two real logins and
    // several full page navigations across two independent authenticated
    // sessions — comfortably past Playwright's 30s default per-test budget
    // even though every individual step is fast.
    test.setTimeout(180_000);
    const itemId = required("PROCUREMENT_E2E_ITEM_ID");
    const warehouseId = required("PROCUREMENT_E2E_WAREHOUSE_ID");
    const uomId = required("PROCUREMENT_E2E_UOM_ID");
    const accountingPartyId = required("PROCUREMENT_E2E_ACCOUNTING_PARTY_ID");

    // The buyer is the default authenticated owner session (erp-auth.setup.ts).
    await page.goto("/procurement", { waitUntil: "networkidle" });

    // The approver is a second real, independently logged-in user.
    // Playwright Test's `browser` fixture (unlike the raw Playwright API)
    // merges the "erp-chromium" project's `use` defaults into
    // browser.newContext() -- which includes `storageState: authFile`, the
    // BUYER's own already-authenticated session. Without explicitly
    // clearing it, this "new" context silently starts pre-logged-in as the
    // buyer, so goto("/login") just redirects straight back to the
    // dashboard and the login form never appears (root-caused by logging
    // approverContext.cookies() immediately after creation: the buyer's
    // vercent_session cookie was already there before any navigation).
    // baseURL is derived from the buyer page's own already-resolved URL
    // rather than hardcoding it a second time.
    const approverContext = await browser.newContext({
      ...devices["Desktop Chrome"],
      baseURL: new URL(page.url()).origin,
      storageState: undefined,
    });
    const approverPage = await approverContext.newPage();
    await loginAs(approverPage, required("PROCUREMENT_E2E_APPROVER_EMAIL"), required("PROCUREMENT_E2E_APPROVER_PASSWORD"));
    await approverPage.goto("/procurement", { waitUntil: "networkidle" });

    try {
      const suffix = Date.now();

      // --- Supplier: create (buyer) -> submit (buyer) -> qualify, activate (approver) ---
      const supplierCreate = await api(page, "POST", "/api/procurement/resources/suppliers", {
        legalName: `Journey Supplier ${suffix} Pvt Ltd`,
        supplierCode: `E2E-SUP-${suffix}`,
        accountingPartyId,
      });
      expect(supplierCreate.status).toBe(201);
      let supplier = supplierCreate.body.record as Record<string, unknown>;
      const supplierId = supplier.id as string;
      supplier = await transition(page, "suppliers", supplierId, "submit", Number(supplier.version));
      supplier = await transition(approverPage, "suppliers", supplierId, "qualify", Number(supplier.version));
      supplier = await transition(approverPage, "suppliers", supplierId, "activate", Number(supplier.version));
      expect(supplier.status).toBe("active");

      await page.goto(`/procurement/suppliers/${supplierId}`, { waitUntil: "networkidle" });
      await expect(page.locator(".status-badge")).toContainText(/active/i);
      await expect(page.locator("body")).toContainText(`Journey Supplier ${suffix} Pvt Ltd`);

      // --- Requisition: create (buyer) -> submit (buyer) -> approve (approver) ---
      const requisitionCreate = await api(page, "POST", "/api/procurement/resources/requisitions", {
        title: `Journey Requisition ${suffix}`,
        needByDate: "2026-12-31",
        lines: [{ description: "Journey Test Item", quantity: "10", unitPrice: "100" }],
      });
      expect(requisitionCreate.status).toBe(201);
      let requisition = requisitionCreate.body.record as Record<string, unknown>;
      requisition = await transition(page, "requisitions", requisition.id as string, "submit", Number(requisition.version));
      requisition = await transition(approverPage, "requisitions", requisition.id as string, "approve", Number(requisition.version));
      expect(requisition.status).toBe("approved");

      // --- RFQ (sourcing event): create -> submit (buyer) -> approve (approver) -> activate (buyer) ---
      const sourcingCreate = await api(page, "POST", "/api/procurement/resources/sourcing-events", {
        title: `Journey RFQ ${suffix}`,
        eventType: "rfq",
        bidCloseAt: "2026-12-01T00:00:00.000Z",
      });
      expect(sourcingCreate.status).toBe(201);
      let sourcingEvent = sourcingCreate.body.record as Record<string, unknown>;
      const sourcingEventId = sourcingEvent.id as string;

      // Bids are a child array embedded directly on the sourcing event
      // document (tenant.procurement_sourcing_bids via the CHILDREN sync),
      // not a separate creation endpoint — there is no supplier portal in
      // this repo yet (a documented F063 gap), so the buyer records the bid
      // on the supplier's behalf, exactly as a real buyer would over email
      // or phone today. This must happen while the event is still "draft":
      // updateProcurementRecord (PROCUREMENT_EDIT_LOCKED) only allows PATCH
      // on draft/rejected documents, not on submitted/approved/active ones.
      const bidUpdate = await api(page, "PATCH", `/api/procurement/resources/sourcing-events/${sourcingEventId}`, {
        bids: [{ supplierId, quotationNumber: `SQ-${suffix}`, currencyCode: "INR" }],
        expectedVersion: Number(sourcingEvent.version),
      });
      expect(bidUpdate.status, JSON.stringify(bidUpdate.body)).toBe(200);
      sourcingEvent = bidUpdate.body.record as Record<string, unknown>;
      const bids = sourcingEvent.bids as Array<Record<string, unknown>>;
      expect(bids.length).toBe(1);
      const bidId = bids[0].id as string;

      sourcingEvent = await transition(page, "sourcing-events", sourcingEventId, "submit", Number(sourcingEvent.version));
      sourcingEvent = await transition(approverPage, "sourcing-events", sourcingEventId, "approve", Number(sourcingEvent.version));
      sourcingEvent = await transition(page, "sourcing-events", sourcingEventId, "activate", Number(sourcingEvent.version));
      expect(sourcingEvent.status).toBe("active");

      // --- Award the bid to a Purchase Order (buyer; not an approve/qualify action, so no self-approval conflict) ---
      const awardResult = await transition(page, "sourcing-events", sourcingEventId, "award", Number(sourcingEvent.version), {
        selectedBidId: bidId,
        supplierId,
        awardType: "purchase-order",
        expectedDeliveryDate: "2026-12-15",
        lines: [{ itemId, uomId, warehouseId, description: "Journey Test Item", quantity: "10", unitPrice: "100" }],
      });
      const award = awardResult as unknown as { sourceEvent?: Record<string, unknown>; award?: Record<string, unknown> };
      expect(award.sourceEvent?.status ?? (awardResult as Record<string, unknown>).status).toBeTruthy();
      const purchaseOrderId = (award.award?.id ?? (awardResult as Record<string, unknown>).id) as string;
      expect(purchaseOrderId, `award response: ${JSON.stringify(awardResult)}`).toBeTruthy();

      const poAfterAward = await api(page, "GET", `/api/procurement/resources/purchase-orders/${purchaseOrderId}`);
      expect(poAfterAward.status).toBe(200);
      let purchaseOrder = poAfterAward.body.record as Record<string, unknown>;
      const poLines = purchaseOrder.lines as Array<Record<string, unknown>>;
      const poLineId = poLines[0].id as string;

      // --- Purchase order: submit (buyer) -> approve (approver) -> dispatch (buyer) ---
      purchaseOrder = await transition(page, "purchase-orders", purchaseOrderId, "submit", Number(purchaseOrder.version));
      purchaseOrder = await transition(approverPage, "purchase-orders", purchaseOrderId, "approve", Number(purchaseOrder.version));
      purchaseOrder = await transition(page, "purchase-orders", purchaseOrderId, "dispatch", Number(purchaseOrder.version));
      expect(purchaseOrder.status).toBe("dispatched");

      // --- Goods receipt: create -> submit (buyer) -> approve (approver), asserting a REAL Stock effect ---
      const receiptCreate = await api(page, "POST", "/api/procurement/resources/receipts", {
        purchaseOrderId,
        receiptDate: "2026-12-05",
        lines: [
          {
            purchaseOrderLineId: poLineId,
            itemId,
            uomId,
            warehouseId,
            description: "Journey Test Item",
            quantity: "10",
            acceptedQuantity: "10",
            rejectedQuantity: "0",
          },
        ],
      });
      expect(receiptCreate.status, JSON.stringify(receiptCreate.body)).toBe(201);
      let receipt = receiptCreate.body.record as Record<string, unknown>;
      const receiptId = receipt.id as string;
      receipt = await transition(page, "receipts", receiptId, "submit", Number(receipt.version));

      // The fixture item/warehouse are fixed (idempotent fixture, reused
      // across every run), so their absolute on-hand quantity can carry
      // real balance from earlier runs -- assert the DELTA this receipt
      // itself causes, not an absolute baseline of zero.
      const beforeApproval = await api(page, "GET", `/api/stock/availability?itemId=${itemId}&warehouseId=${warehouseId}`);
      expect(beforeApproval.status, JSON.stringify(beforeApproval.body)).toBe(200);
      const quantityBeforeApproval = Number((beforeApproval.body.availability as Record<string, unknown>)?.onHandQuantity);
      expect(Number.isFinite(quantityBeforeApproval), JSON.stringify(beforeApproval.body)).toBe(true);

      // This is the one call this session's gap-closing pass added a real
      // physical inventory effect to (services/api/src/orchestration/
      // procurement-stock-receiving.js) — wired into the web route this
      // spec is exercising exactly the way a real browser would call it.
      receipt = await transition(approverPage, "receipts", receiptId, "approve", Number(receipt.version));
      expect(receipt.status).toBe("approved");

      await approverPage.goto(`/procurement/receipts/${receiptId}`, { waitUntil: "networkidle" });
      await expect(approverPage.locator(".status-badge")).toContainText(/approved/i);

      const afterApproval = await api(page, "GET", `/api/stock/availability?itemId=${itemId}&warehouseId=${warehouseId}`);
      expect(afterApproval.status, JSON.stringify(afterApproval.body)).toBe(200);
      const quantityAfterApproval = Number((afterApproval.body.availability as Record<string, unknown>)?.onHandQuantity);
      expect(
        quantityAfterApproval - quantityBeforeApproval,
        `goods receipt approval must post a real Stock receipt movement: ${JSON.stringify(afterApproval.body)}`,
      ).toBe(10);

      const poAfterReceipt = await api(page, "GET", `/api/procurement/resources/purchase-orders/${purchaseOrderId}`);
      expect((poAfterReceipt.body.record as Record<string, unknown>).status).toBe("received");

      // --- Matching + auto vendor-bill import (this session's F084/F086 fix), then Bill -> Payment ---
      const matchResult = await api(approverPage, "POST", "/api/procurement/matching/run", {
        purchaseOrderId,
        supplierId,
        invoiceNumber: `INV-${suffix}`,
        matchMode: "two-way",
        invoiceLines: [{ purchaseOrderLineId: poLineId, itemId, uomId, description: "Journey Test Item", quantity: "10", unitPrice: "100" }],
      });
      expect(matchResult.status, JSON.stringify(matchResult.body)).toBe(201);
      const matchBody = matchResult.body as Record<string, unknown>;
      expect((matchBody.matchingRecord as Record<string, unknown>).status).toBe("matched");
      const vendorBill = matchBody.vendorBill as Record<string, unknown> | null;
      expect(vendorBill, "supplier is linked to an Accounting party, so this match must auto-import a vendor bill").toBeTruthy();
      const billId = vendorBill!.id as string;

      let billActionResult = await api(approverPage, "POST", `/api/accounting/payables/bills/${billId}/actions`, { action: "submit" });
      expect(billActionResult.status, JSON.stringify(billActionResult.body)).toBe(200);
      await approveIfRequired(approverPage, page, billActionResult.body.result as Record<string, unknown>);
      billActionResult = await api(approverPage, "POST", `/api/accounting/payables/bills/${billId}/actions`, { action: "post" });
      expect(billActionResult.status, JSON.stringify(billActionResult.body)).toBe(200);

      // GET .../bills/{id} returns getVendorBill()'s composite
      // { bill, lines, schedules, ... } detail shape under the `bill` key,
      // i.e. body.bill.bill is the flat row (same double-nesting this
      // session's orchestration fix already had to unwrap once for the
      // matching-run response).
      const billAfterPost = await api(approverPage, "GET", `/api/accounting/payables/bills/${billId}`);
      expect(billAfterPost.status, JSON.stringify(billAfterPost.body)).toBe(200);
      const billDetail = ((billAfterPost.body as Record<string, unknown>).bill as Record<string, unknown>).bill as Record<string, unknown>;
      expect(billDetail.status, JSON.stringify(billAfterPost.body)).toBe("posted");
      const grandTotal = String(billDetail.grand_total);

      const paymentCreate = await api(approverPage, "POST", "/api/accounting/payables/payments", {
        companyId: billDetail.company_id,
        partyId: accountingPartyId,
        amount: grandTotal,
        paymentDate: "2026-12-10",
        currencyCode: "INR",
        paymentMethod: "bank_transfer",
      });
      expect(paymentCreate.status, JSON.stringify(paymentCreate.body)).toBe(201);
      const paymentId = (paymentCreate.body.payment as Record<string, unknown>).id as string;

      let paymentActionResult = await api(approverPage, "POST", `/api/accounting/payables/payments/${paymentId}/actions`, { action: "submit" });
      expect(paymentActionResult.status, JSON.stringify(paymentActionResult.body)).toBe(200);
      await approveIfRequired(approverPage, page, paymentActionResult.body.result as Record<string, unknown>);
      paymentActionResult = await api(approverPage, "POST", `/api/accounting/payables/payments/${paymentId}/actions`, { action: "post" });
      expect(paymentActionResult.status, JSON.stringify(paymentActionResult.body)).toBe(200);
      paymentActionResult = await api(approverPage, "POST", `/api/accounting/payables/payments/${paymentId}/actions`, {
        action: "allocate",
        input: { allocations: [{ billId, paymentAmount: grandTotal, billAmount: grandTotal }] },
      });
      expect(paymentActionResult.status, JSON.stringify(paymentActionResult.body)).toBe(200);

      await approverPage.goto(`/accounting/payables/${billId}`, { waitUntil: "networkidle" });
      await expect(approverPage.locator(".status-badge")).toContainText(/paid/i);
      await expect(approverPage.locator("body")).toContainText("0.00");
    } finally {
      await approverContext.close();
    }
  });
});

test.describe("Procurement authorization boundary — real browser check", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a CRM-only restricted user cannot read or write Procurement resources", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill(required("ERP_E2E_RESTRICTED_EMAIL"));
    await page.getByLabel("Password").fill(required("ERP_E2E_RESTRICTED_PASSWORD"));
    await Promise.all([
      page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    const list = await api(page, "GET", "/api/procurement/resources/suppliers");
    expect([401, 403]).toContain(list.status);

    const create = await api(page, "POST", "/api/procurement/resources/suppliers", {
      legalName: "Unauthorized Supplier",
      supplierCode: "UNAUTH-001",
    });
    expect([401, 403]).toContain(create.status);
  });
});
