#!/usr/bin/env node
// Sales F051–F062 demo data, continuing the Sunrise Dairy story through
// order-to-cash: the company's accounting foundation (the app's own
// initializer), a supplier, an invoiced and part-paid order, returns in each
// state, a credit note and a refund, advances deducted on a partial invoice,
// a drop-shipment, commissions (approved and reversed), an order held for
// longer payment terms, and a standard-cost change for the margin report.
// Everything goes through governed functions. Local-only, safe to run more
// than once (each step checks first). Run the F031–F040 and F041–F050 seeds first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  accrueSalesCommission, allocateCustomerReceipt, approveSalesCommission, approveSubledgerDocument, cancelSalesAdvancePayment,
  cancelSalesOrder, completeSalesReturnWithStock, confirmSalesOrder, createBusinessDataRecord, createCustomerReceipt,
  createInvoiceFromSalesRequest, createInvoiceRequest, createProcurementRecord, createSalesCommissionRule, createSalesDropShipWithSupplierValidation,
  createSalesOrder, createSalesReturnRequest, decideSalesCreditAdjustment, decideSalesReturnRequest, getSalesOrder, initializeAccountingCompany,
  postCustomerInvoice, postCustomerReceipt, recordSalesAdvancePayment, requestSalesCreditAdjustment, submitSalesOrder, submitSubledgerDocument,
  updateBusinessDataRecord, updateSalesDropShipStatus,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const db = new Client({ connectionString });
await db.connect();
const organizationId = (await db.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [process.env.SEED_ORG_NAME || "Vercentlabs"])).rows[0].id;
const companyId = (await db.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0].id;
const userId = async (email) => (await db.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id;
const ownerId = await userId("atharva.chavan@vercentlabs.com");
const priyaId = await userId("priya.nair@vercentlabs.demo");
const ctx = (id) => ({ organizationId, userId: id, activeCompanyId: companyId, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: ["organization_owner"] });
const owner = ctx(ownerId), priya = ctx(priyaId);
const stock = { organizationId, companyId, userId: ownerId, permissions: ["stock.view", "stock.receive", "stock.reserve", "stock.issue"], roleSlugs: [] };
const procurement = { organizationId, companyId, activeCompanyId: companyId, userId: ownerId, permissions: ["procurement.suppliers.view", "procurement.suppliers.manage"], roleSlugs: ["organization_owner"], allowAllCompanies: true };

async function tx(fn) {
  await db.query("BEGIN");
  try {
    await setTenantContext(db, organizationId);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
const one = async (sql, values = []) => (await db.query(sql, [organizationId, ...values])).rows[0];
const step = async (label, done, run) => {
  if (await done()) return console.log(`present  ${label}`);
  await tx(run);
  console.log(`done     ${label}`);
};
const orderByNote = (note) => one(`SELECT o.id FROM tenant.sales_orders o JOIN tenant.sales_order_versions v ON v.sales_order_id=o.id AND v.version_number=1 WHERE o.organization_id=$1 AND v.customer_notes=$2 LIMIT 1`, [note]);
const itemId = async (code) => (await one(`SELECT id FROM tenant.items WHERE organization_id=$1 AND code=$2`, [code])).id;

// ---------- Accounting foundation (the app's own initializer) ----------
await step("accounting foundation for the company", () => one(`SELECT 1 FROM tenant.accounting_ledgers WHERE organization_id=$1 LIMIT 1`), (c) => initializeAccountingCompany(c, { organizationId, companyId, userId: ownerId }));

// ---------- Fiscal year FY 2026-27, one open period per month ----------
await step("fiscal periods April 2026 – March 2027", () => one(`SELECT 1 FROM tenant.fiscal_periods WHERE organization_id=$1 AND fiscal_year=$2 LIMIT 1`, ["FY 2026-27"]),
  async (c) => {
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(Date.UTC(2026, 3 + month, 1));
      const end = new Date(Date.UTC(2026, 4 + month, 0));
      const name = start.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
      await createBusinessDataRecord(c, owner, "fiscal-periods", { companyId, name, fiscalYear: "FY 2026-27", startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), status: "open" });
    }
  });

// ---------- Supplier and terms ----------
await step("supplier Sahyadri Farms", () => one(`SELECT 1 FROM tenant.procurement_suppliers WHERE organization_id=$1 AND data->>'supplierCode'=$2`, ["SUP-SAHYADRI"]),
  (c) => createProcurementRecord(c, procurement, "suppliers", { companyId, supplierCode: "SUP-SAHYADRI", legalName: "Sahyadri Farms Producer Company Ltd", displayName: "Sahyadri Farms", status: "active" }));
const supplierId = (await one(`SELECT id FROM tenant.procurement_suppliers WHERE organization_id=$1 AND data->>'supplierCode'=$2`, ["SUP-SAHYADRI"])).id;
await step("payment term Net 60", () => one(`SELECT 1 FROM tenant.payment_terms WHERE organization_id=$1 AND code=$2`, ["NET60"]),
  (c) => createBusinessDataRecord(c, owner, "payment-terms", { code: "NET60", name: "Net 60", description: "Payment due 60 days from invoice", defaultDueDays: 60, status: "active" }));

const milk = await itemId("MILK-TON-1L"), paneer = await itemId("PANEER-200"), ghee = await itemId("GHEE-COW");
const ctn = (await one(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='CTN'`)).id;
const ghee1l = (await one(`SELECT id FROM tenant.item_variants WHERE organization_id=$1 AND sku='GHEE-COW-1L'`)).id;
const warehouse = (await one(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND code='PUNE-COLD'`)).id;
const sunrise = (await one(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name='Sunrise Dairy Products'`)).id;
const addr = async (type) => (await one(`SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type=$3 AND is_primary`, [sunrise, type])).id;
const header = { companyId, partyId: sunrise, ownerUserId: ownerId, billingAddressId: await addr("billing"), shippingAddressId: await addr("shipping"), currencyCode: "INR", supplyType: "domestic", requestedDeliveryDate: iso(5) };
const line = (id, quantity, extra = {}) => ({ itemId: id, uomId: ctn, quantity, warehouseId: warehouse, ...extra });

// ---------- F050/F062: invoice the delivered part of the weekly order, part-paid ----------
const weekly = await orderByNote("Weekly replenishment for the Pune plant");
const pendingRequest = await one(`SELECT id FROM tenant.sales_invoice_requests WHERE organization_id=$1 AND sales_order_id=$2 AND status='pending' ORDER BY requested_at LIMIT 1`, [weekly.id]);
await step("weekly order invoiced in Accounting, approved and posted", () => one(`SELECT 1 FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND source_sales_order_id=$2 AND status<>'draft'`, [weekly.id]),
  async (c) => {
    const invoice = await createInvoiceFromSalesRequest(c, owner, pendingRequest.id);
    const invoiceId = invoice.id ?? invoice.invoice?.id;
    await submitSubledgerDocument(c, owner, "customer_invoice", invoiceId, priyaId);
    const state = (await c.query(`SELECT status,content_hash FROM tenant.accounting_customer_invoices WHERE id=$1`, [invoiceId])).rows[0];
    // Below the approval threshold the invoice is approved on submission.
    if (state.status === "pending_approval") await approveSubledgerDocument(c, priya, "customer_invoice", invoiceId, state.content_hash);
    await postCustomerInvoice(c, owner, invoiceId);
  });
const weeklyInvoice = await one(`SELECT id,invoice_number,grand_total FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND source_sales_order_id=$2 AND status<>'draft' LIMIT 1`, [weekly.id]);
await step("part payment received against the weekly invoice", () => one(`SELECT 1 FROM tenant.accounting_customer_receipts WHERE organization_id=$1 AND external_reference=$2`, ["NEFT-SDP-88213"]),
  async (c) => {
    const receipt = await createCustomerReceipt(c, owner, { companyId, partyId: sunrise, amount: 5000, paymentMethod: "bank_transfer", externalReference: "NEFT-SDP-88213" });
    const receiptId = receipt.id ?? receipt.receipt?.id;
    await postCustomerReceipt(c, owner, receiptId);
    await allocateCustomerReceipt(c, owner, receiptId, { allocations: [{ invoiceId: weeklyInvoice.id, amount: 5000 }] });
  });

// ---------- F054: returns (received as scrap, and one waiting) ----------
const weeklyLines = (await tx((c) => getSalesOrder(c, owner, weekly.id))).lines;
const weeklyMilk = weeklyLines.find((l) => l.item_id === milk), weeklyPaneer = weeklyLines.find((l) => l.item_id === paneer);
await step("return: 1 carton of paneer damaged in transit (received, scrapped)", () => one(`SELECT 1 FROM tenant.sales_return_requests WHERE organization_id=$1 AND idempotency_key=$2`, ["f054-paneer-damaged"]),
  async (c) => {
    const request = await createSalesReturnRequest(c, owner, weekly.id, { idempotencyKey: "f054-paneer-damaged", reason: "One carton of paneer arrived with broken seals", lines: [{ salesOrderLineId: weeklyPaneer.id, quantity: 1 }] });
    await decideSalesReturnRequest(c, priya, request.id, { decision: "approved", note: "Photos from Meera confirm the broken seals." });
    await completeSalesReturnWithStock(c, owner, stock, request.id, { lines: [{ salesOrderLineId: weeklyPaneer.id, quantity: 1, disposition: "scrap" }] });
  });
await step("return: 2 cartons of milk leaking (waiting for approval)", () => one(`SELECT 1 FROM tenant.sales_return_requests WHERE organization_id=$1 AND idempotency_key=$2`, ["f054-milk-leaking"]),
  (c) => createSalesReturnRequest(c, owner, weekly.id, { idempotencyKey: "f054-milk-leaking", reason: "Two cartons of pouches leaking at the Pune plant", lines: [{ salesOrderLineId: weeklyMilk.id, quantity: 2 }] }));
const paneerReturn = await one(`SELECT id FROM tenant.sales_return_requests WHERE organization_id=$1 AND idempotency_key=$2`, ["f054-paneer-damaged"]);

// ---------- F055: a credit note for the scrapped carton, and a refund ----------
await step("credit note for the damaged paneer (waiting for approval)", () => one(`SELECT 1 FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND adjustment_type='credit_note'`, [weekly.id]),
  (c) => requestSalesCreditAdjustment(c, owner, { salesOrderId: weekly.id, adjustmentType: "credit_note", amount: 1722, returnRequestId: paneerReturn.id, reason: "Credit for 1 carton of paneer returned damaged (₹1,640 + 5% GST)" }));
await step("refund of an overpayment (approved)", () => one(`SELECT 1 FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND adjustment_type='refund'`, [weekly.id]),
  async (c) => {
    const refund = await requestSalesCreditAdjustment(c, owner, { salesOrderId: weekly.id, adjustmentType: "refund", amount: 250, reason: "Customer paid ₹250 twice for the cold-chain surcharge" });
    await decideSalesCreditAdjustment(c, priya, refund.id, { decision: "approved", note: "Bank statement shows the duplicate transfer." });
  });

// ---------- F052/F051: advances deducted on a partial invoice ----------
await step("Diwali bulk order: two advances, a partial invoice, one advance cancelled", () => orderByNote("Diwali bulk order for the Pune plant"),
  async (c) => {
    const created = await createSalesOrder(c, owner, { ...header, customerNotes: "Diwali bulk order for the Pune plant", customerPoNumber: "SDP/PO/2026/0470", lines: [line(milk, 30), { itemId: ghee, variantId: ghee1l, quantity: 10, warehouseId: warehouse }] });
    const orderId = created.id ?? created.orderId;
    await submitSalesOrder(c, owner, orderId);
    await confirmSalesOrder(c, owner, orderId);
    await recordSalesAdvancePayment(c, owner, { salesOrderId: orderId, amount: 5000, paymentReference: "UPI-SDP-7741", note: "Token advance paid on the call" });
    await recordSalesAdvancePayment(c, owner, { salesOrderId: orderId, amount: 10000, paymentReference: "NEFT-SDP-90112", note: "Balance advance before dispatch" });
    const wrong = await recordSalesAdvancePayment(c, owner, { salesOrderId: orderId, amount: 2000, paymentReference: "CHQ-004411" });
    await cancelSalesAdvancePayment(c, owner, wrong.id, { reason: "Cheque bounced — recorded in error" });
    const lines = (await getSalesOrder(c, owner, orderId)).lines;
    const milkLine = lines.find((l) => l.item_id === milk);
    await createInvoiceRequest(c, owner, orderId, { idempotencyKey: `f051-partial:${orderId}`, lines: [{ salesOrderLineId: milkLine.id, quantity: 10 }] });
  });

// ---------- F056: drop-ship the ghee stock can't cover ----------
const corporate = await orderByNote("Ghee 1 L tins for corporate gifting");
await step("drop-ship 30 tins of ghee from Sahyadri Farms (shipped)", () => one(`SELECT 1 FROM tenant.sales_drop_ship_requests WHERE organization_id=$1 AND idempotency_key=$2`, ["f056-ghee"]),
  async (c) => {
    const [gheeLine] = (await getSalesOrder(c, owner, corporate.id)).lines;
    const drop = await createSalesDropShipWithSupplierValidation(c, owner, procurement, { salesOrderId: corporate.id, salesOrderLineId: gheeLine.id, supplierId, quantity: 30, shipToAddressId: header.shippingAddressId, idempotencyKey: "f056-ghee" });
    await updateSalesDropShipStatus(c, owner, drop.id, { status: "ordered", procurementReference: "SAH/PO/2026/0192" });
    await updateSalesDropShipStatus(c, owner, drop.id, { status: "shipped", carrier: "Blue Dart Surface", trackingNumber: "BD-55120937" });
  });

// ---------- F057: commissions (accrued, approved, reversed) ----------
await step("commission rule: 2% of net sales", () => one(`SELECT 1 FROM tenant.sales_commission_rules WHERE organization_id=$1 AND name=$2`, ["Dairy field sales — 2% of net sales"]),
  (c) => createSalesCommissionRule(c, owner, { companyId, name: "Dairy field sales — 2% of net sales", ratePercent: 2, basis: "net_sales" }));
await step("commissions accrued; weekly one approved by Priya", () => one(`SELECT 1 FROM tenant.sales_commission_entries WHERE organization_id=$1 AND sales_order_id=$2 AND status='approved'`, [weekly.id]),
  async (c) => {
    for (const order of [weekly, corporate]) await accrueSalesCommission(c, owner, { salesOrderId: order.id });
    const entry = (await c.query(`SELECT id FROM tenant.sales_commission_entries WHERE organization_id=$1 AND sales_order_id=$2`, [organizationId, weekly.id])).rows[0];
    await approveSalesCommission(c, priya, entry.id);
  });
await step("cancelled order: commission reversed", () => orderByNote("Paneer for a school canteen — cancelled by the customer"),
  async (c) => {
    const created = await createSalesOrder(c, owner, { ...header, customerNotes: "Paneer for a school canteen — cancelled by the customer", lines: [line(paneer, 3)] });
    const orderId = created.id ?? created.orderId;
    await submitSalesOrder(c, owner, orderId);
    await confirmSalesOrder(c, owner, orderId);
    await accrueSalesCommission(c, owner, { salesOrderId: orderId });
    await cancelSalesOrder(c, owner, orderId, "School term postponed; customer cancelled the order.");
  });

// ---------- F058: longer terms than the customer's default ----------
await step("order on Net 60 (customer default Net 30) waiting for approval", () => orderByNote("Year-end stock-up — customer asked for Net 60"),
  async (c) => {
    const net60 = (await c.query(`SELECT id FROM tenant.payment_terms WHERE organization_id=$1 AND code='NET60'`, [organizationId])).rows[0].id;
    const created = await createSalesOrder(c, owner, { ...header, paymentTermId: net60, customerNotes: "Year-end stock-up — customer asked for Net 60", lines: [line(milk, 25)] });
    await submitSalesOrder(c, owner, created.id ?? created.orderId, priyaId);
  });

// ---------- F061: milk costs went up after the orders were priced ----------
const milkCost = await one(`SELECT standard_cost FROM tenant.items WHERE organization_id=$1 AND id=$2`, [milk]);
if (Number(milkCost.standard_cost) !== 47) {
  await tx((c) => updateBusinessDataRecord(c, owner, "items", milk, { standardCost: 47 }));
  console.log("done     milk standard cost 44 → 47 (procurement price rise)");
} else console.log("present  milk standard cost 47");

await db.end();
console.log("done");
