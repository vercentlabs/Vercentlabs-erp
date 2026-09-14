// Real PostgreSQL integration test -- not a fake-DB-client unit test. This
// exercises the actual Procurement domain functions against a real,
// migrated local database (same connection this repo's other verification
// scripts use, see README "Database" section) to prove the
// Supplier -> Requisition -> RFQ -> Purchase Order -> Goods Receipt leg of
// the task's required Supplier->...->Payment journey has a REAL physical
// Stock effect, not just internal Procurement bookkeeping.
//
// The final leg (a fully posted Supplier Bill -> Payment, i.e. actually
// calling accounting.importProcurementMatchAsVendorBill through to a
// posted vendor bill/payment) requires a full Accounting foundation (chart
// of accounts, ledger, purchase/bank journals, account mappings) that a
// real onboarded organization gets from apps/web/src/core/platform.ts's
// seedOrganizationFoundation(). That helper has Next.js/@/-aliased runtime
// dependencies (@/core/db etc.) that cannot safely be loaded from a plain
// `node --test` process the way this file runs (see apps/web/tests/
// helpers/load-ts-module.mjs's own documented limitation: "no @/core/db...
// runtime dependency"). Building a database-only Accounting fixture from
// scratch is real, separately-scoped work -- not attempted here. What IS
// covered against the real database below: the
// runProcurementMatchWithVendorBillImport orchestration wrapper's own
// guard/skip logic (organization-mismatch rejection, and the
// not-yet-linked-to-an-Accounting-party skip path) -- the two behaviors
// that are actually new code in this pass, as opposed to
// importProcurementMatchAsVendorBill itself, which is pre-existing,
// already-reviewed Accounting code (see docs/03-modules/procurement/
// audits/F084-AUDIT.md for the reconnaissance that found it unused).
//
// Skips cleanly (does not fail the suite) if no real database is reachable,
// matching this repo's own "distinguish test passed / could not run" rule
// rather than silently converting a real gap into a false pass.

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

import {
  createProcurementRecord,
  transitionProcurementRecord,
  procurementContext,
  awardSourcingEvent,
} from "../../services/api/src/modules/procurement/index.js";
import { transitionProcurementReceiptWithStockMovement } from "../../services/api/src/orchestration/procurement-stock-receiving.js";
import { runProcurementMatchWithVendorBillImport } from "../../services/api/src/orchestration/procurement-accounting-vendor-bill.js";
import { stockContext } from "../../services/api/src/modules/stock/index.js";

const connectionString =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";

async function connectOrSkip() {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("Procurement: Supplier -> Requisition -> RFQ -> PO -> GRN posts a real Stock receipt movement", async (t) => {
  const client = await connectOrSkip();
  if (!client) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL/DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const organizationId = randomUUID();
  const userId = randomUUID();
  const approverUserId = randomUUID();
  const companyId = randomUUID();
  const warehouseId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();

  try {
    await client.query("BEGIN");

    // --- Minimal real fixture: an org/company/2 users/item/warehouse/UOM. ---
    // Two distinct users are required: transitionProcurementRecord's real
    // self-approval guard (PROCUREMENT_SELF_APPROVAL) correctly rejects the
    // same actor creating AND approving/qualifying a document, so this
    // journey uses a "buyer" (userId, creates/submits) and an "approver"
    // (approverUserId, approves/qualifies) throughout, matching how a real
    // segregated-duties workflow would actually run.
    await client.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'Integration Test Buyer','not-a-real-hash','active',now()),
             ($3,$4,'Integration Test Approver','not-a-real-hash','active',now())`,
      [userId, `procurement-journey-buyer-${userId}@test.invalid`, approverUserId, `procurement-journey-approver-${approverUserId}@test.invalid`],
    );
    await client.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by)
       VALUES($1,'Procurement Journey Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [organizationId, `procurement-journey-${organizationId}`, userId],
    );
    await client.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,country_code,base_currency,is_primary,code)
       VALUES($1,$2,'Journey Test Co','Journey Test Co Pvt Ltd','IN','INR',true,'JTC')`,
      [companyId, organizationId],
    );
    await client.query(
      `INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,is_base,created_by,updated_by)
       VALUES($1,$2,'EA','Each','quantity',true,$3,$3)`,
      [uomId, organizationId, userId],
    );
    await client.query(
      `INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,created_by,updated_by)
       VALUES($1,$2,$3,'ITEM-001','Journey Test Item','product',$4,$5,$5)`,
      [itemId, organizationId, companyId, uomId, userId],
    );
    await client.query(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,name,code,created_by,updated_by)
       VALUES($1,$2,$3,'Main Warehouse','MAIN',$4,$4)`,
      [warehouseId, organizationId, companyId, userId],
    );
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);

    const session = {
      organizationId,
      userId,
      activeCompanyId: companyId,
      activeBranchId: null,
      allowAllCompanies: false,
      roleSlugs: ["organization_owner"], // bypasses per-permission checks, real org/company scoping still applies
      permissions: [],
    };
    const procContext = procurementContext(session);
    const stockCtx = stockContext(session);
    const approverContext = procurementContext({ ...session, userId: approverUserId });

    // --- Supplier: create -> submit -> qualify -> activate ---
    const supplier = await createProcurementRecord(client, procContext, "suppliers", {
      legalName: "Journey Test Supplier Pvt Ltd",
      supplierCode: "SUP-JOURNEY-001",
      currencyCode: "INR",
    });
    let s = await transitionProcurementRecord(client, procContext, "suppliers", supplier.id, "submit", { expectedVersion: supplier.version });
    s = await transitionProcurementRecord(client, approverContext, "suppliers", supplier.id, "qualify", { expectedVersion: s.version });
    s = await transitionProcurementRecord(client, approverContext, "suppliers", supplier.id, "activate", { expectedVersion: s.version });
    assert.equal(s.status, "active", "supplier must reach active before it can be ordered from");

    // --- Requisition: create -> submit -> approve ---
    const requisition = await createProcurementRecord(client, procContext, "requisitions", {
      title: "Journey Test Requisition",
      needByDate: "2026-12-31",
      lines: [{ description: "Journey Test Item", quantity: "10", unitPrice: "100" }],
    });
    let r = await transitionProcurementRecord(client, procContext, "requisitions", requisition.id, "submit", { expectedVersion: requisition.version });
    r = await transitionProcurementRecord(client, approverContext, "requisitions", requisition.id, "approve", { expectedVersion: r.version });
    assert.equal(r.status, "approved");

    // --- RFQ (sourcing event): create -> submit -> approve -> activate, add a bid, award to a PO ---
    const sourcingEvent = await createProcurementRecord(client, procContext, "sourcing-events", {
      title: "Journey Test RFQ",
      eventType: "rfq",
      bidCloseAt: "2026-12-01T00:00:00.000Z",
    });
    let evt = await transitionProcurementRecord(client, procContext, "sourcing-events", sourcingEvent.id, "submit", { expectedVersion: sourcingEvent.version });
    evt = await transitionProcurementRecord(client, approverContext, "sourcing-events", sourcingEvent.id, "approve", { expectedVersion: evt.version });
    evt = await transitionProcurementRecord(client, procContext, "sourcing-events", sourcingEvent.id, "activate", { expectedVersion: evt.version });
    assert.equal(evt.status, "active");

    const bidResult = await client.query(
      `INSERT INTO tenant.procurement_sourcing_bids(organization_id,company_id,parent_id,status,data,content_hash,updated_by)
       VALUES($1,$2,$3,'active',$4::jsonb,'test-hash',$5) RETURNING id`,
      [
        organizationId,
        companyId,
        sourcingEvent.id,
        JSON.stringify({ supplierId: supplier.id, quotationNumber: "SQ-001", currencyCode: "INR" }),
        userId,
      ],
    );
    const bidId = bidResult.rows[0].id;

    const awardResult = await awardSourcingEvent(client, procContext, sourcingEvent.id, {
      expectedVersion: evt.version,
      selectedBidId: bidId,
      supplierId: supplier.id,
      awardType: "purchase-order",
      expectedDeliveryDate: "2026-12-15",
      lines: [{ itemId, uomId, warehouseId, description: "Journey Test Item", quantity: "10", unitPrice: "100" }],
    });
    assert.equal(awardResult.sourceEvent.status, "closed");
    const purchaseOrderId = awardResult.award.id;

    // --- Purchase order: submit -> approve -> dispatch ---
    let po = await transitionProcurementRecord(client, procContext, "purchase-orders", purchaseOrderId, "submit", {
      expectedVersion: awardResult.award.version,
    });
    po = await transitionProcurementRecord(client, approverContext, "purchase-orders", purchaseOrderId, "approve", { expectedVersion: po.version });
    po = await transitionProcurementRecord(client, procContext, "purchase-orders", purchaseOrderId, "dispatch", { expectedVersion: po.version });
    assert.equal(po.status, "dispatched");

    // --- Goods receipt: create -> submit -> approve WITH real Stock effect ---
    const balanceBefore = await client.query(
      `SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4`,
      [organizationId, companyId, itemId, warehouseId],
    );
    assert.equal(balanceBefore.rows.length, 0, "no stock balance should exist before any receipt is posted");

    const receipt = await createProcurementRecord(client, procContext, "receipts", {
      purchaseOrderId,
      receiptDate: "2026-12-05",
      lines: [{ purchaseOrderLineId: po.lines[0].id, itemId, uomId, warehouseId, description: "Journey Test Item", quantity: "10", acceptedQuantity: "10", rejectedQuantity: "0" }],
    });
    let receiptRow = await transitionProcurementRecord(client, procContext, "receipts", receipt.id, "submit", { expectedVersion: receipt.version });

    // The one line under test: this is the orchestration function that
    // fixed the "goods receipt never moves Stock" gap (F080/F081).
    receiptRow = await transitionProcurementReceiptWithStockMovement(
      client,
      approverContext,
      stockCtx,
      receipt.id,
      "approve",
      { expectedVersion: receiptRow.version },
    );
    assert.equal(receiptRow.status, "approved");

    const balanceAfter = await client.query(
      `SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4`,
      [organizationId, companyId, itemId, warehouseId],
    );
    assert.equal(balanceAfter.rows.length, 1, "a real stock balance row must exist after the receipt is approved");
    assert.equal(Number(balanceAfter.rows[0].quantity), 10, "on-hand quantity must reflect the accepted receipt quantity");

    const poAfterReceipt = await client.query(
      `SELECT status FROM tenant.procurement_purchase_orders WHERE organization_id=$1 AND id=$2`,
      [organizationId, purchaseOrderId],
    );
    assert.equal(poAfterReceipt.rows[0].status, "received", "the PO must reflect the full receipt too, independent of the Stock effect");

    // --- Cross-module guard: Procurement/Accounting organization mismatch
    // must be rejected before anything else runs (no partial match attempt). ---
    await assert.rejects(
      () =>
        runProcurementMatchWithVendorBillImport(
          client,
          procContext,
          { organizationId: randomUUID(), userId: approverUserId, activeCompanyId: companyId, allowAllCompanies: false, permissions: [], roleSlugs: ["organization_owner"] },
          { purchaseOrderId, supplierId: supplier.id, invoiceNumber: "INV-JOURNEY-MISMATCH", matchMode: "two-way", invoiceLines: [] },
        ),
      (error) => {
        assert.equal(error.code, "PROCUREMENT_ACCOUNTING_CONTEXT_INVALID");
        return true;
      },
    );

    // --- Invoice matching: a clean two-way match against the received PO,
    // through the real orchestration wrapper this pass added. The supplier
    // has no accountingPartyId set (F084's confirmed gap), so this also
    // proves the wrapper's skip path is real: the match itself still
    // succeeds and is permanently recorded, but the Accounting import is
    // skipped with an explicit, typed reason rather than silently
    // attempted and failing or silently doing nothing. ---
    const accountingContext = { organizationId, userId: approverUserId, activeCompanyId: companyId, allowAllCompanies: false, permissions: [], roleSlugs: ["organization_owner"] };
    const matchResult = await runProcurementMatchWithVendorBillImport(client, procContext, accountingContext, {
      purchaseOrderId,
      supplierId: supplier.id,
      invoiceNumber: "INV-JOURNEY-001",
      matchMode: "two-way",
      invoiceLines: [{ purchaseOrderLineId: po.lines[0].id, description: "Journey Test Item", quantity: "10", unitPrice: "100" }],
    });
    assert.equal(matchResult.matchingRecord.status, "matched", "a same-quantity/same-price invoice must match cleanly");
    assert.equal(matchResult.exception, null);
    assert.equal(matchResult.vendorBill, null, "no vendor bill can be created until the supplier is linked to an Accounting party");
    assert.equal(matchResult.vendorBillSkippedReason, "PROCUREMENT_SUPPLIER_NOT_LINKED_TO_ACCOUNTING_PARTY");

    // --- Reversal: verify the compensating Stock movement too. ---
    const receiptAfterApprove = await client.query(
      `SELECT version FROM tenant.procurement_receipts WHERE organization_id=$1 AND id=$2`,
      [organizationId, receipt.id],
    );
    await transitionProcurementReceiptWithStockMovement(
      client,
      procContext,
      stockCtx,
      receipt.id,
      "reverse",
      { expectedVersion: receiptAfterApprove.rows[0].version, reason: "Integration test reversal" },
    );
    const balanceAfterReversal = await client.query(
      `SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4`,
      [organizationId, companyId, itemId, warehouseId],
    );
    assert.equal(Number(balanceAfterReversal.rows[0].quantity), 0, "reversing the receipt must net the Stock quantity back to zero");
  } finally {
    // Always roll back -- this test creates no data anyone should keep.
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
