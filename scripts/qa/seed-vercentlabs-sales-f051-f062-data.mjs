#!/usr/bin/env node
// Sales F051–F062 demo data, continuing the Sunrise Dairy story through
// order-to-cash: the company's accounting foundation (the app's own
// initializer), an invoiced and part-paid order, a credit note and a refund,
// a partial invoice, and an order held for longer payment terms.
// Everything goes through governed functions. Local-only, safe to run more
// than once (each step checks first). Run the F031–F040 and F041–F050 seeds first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  allocateCustomerReceipt, approveSubledgerDocument, confirmSalesOrder, createBusinessDataRecord, createCustomerReceipt,
  createInvoiceFromSalesRequest, createInvoiceRequest, createSalesOrder, decideSalesCreditAdjustment, getSalesOrder, initializeAccountingCompany,
  postCustomerInvoice, postCustomerReceipt, requestSalesCreditAdjustment, submitSalesOrder, submitSubledgerDocument,
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

// ---------- Terms ----------
await step("payment term Net 60", () => one(`SELECT 1 FROM tenant.payment_terms WHERE organization_id=$1 AND code=$2`, ["NET60"]),
  (c) => createBusinessDataRecord(c, owner, "payment-terms", { code: "NET60", name: "Net 60", description: "Payment due 60 days from invoice", defaultDueDays: 60, status: "active" }));

const milk = await itemId("MILK-TON-1L"), ghee = await itemId("GHEE-COW");
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

// ---------- F055: a credit note for a damaged carton, and a refund ----------
await step("credit note for the damaged paneer (waiting for approval)", () => one(`SELECT 1 FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND adjustment_type='credit_note'`, [weekly.id]),
  (c) => requestSalesCreditAdjustment(c, owner, { salesOrderId: weekly.id, adjustmentType: "credit_note", amount: 1722, reason: "Credit for 1 carton of paneer damaged in transit (₹1,640 + 5% GST)" }));
await step("refund of an overpayment (approved)", () => one(`SELECT 1 FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND adjustment_type='refund'`, [weekly.id]),
  async (c) => {
    const refund = await requestSalesCreditAdjustment(c, owner, { salesOrderId: weekly.id, adjustmentType: "refund", amount: 250, reason: "Customer paid ₹250 twice for the cold-chain surcharge" });
    await decideSalesCreditAdjustment(c, priya, refund.id, { decision: "approved", note: "Bank statement shows the duplicate transfer." });
  });

// ---------- F051: a partial invoice ----------
await step("Diwali bulk order: a partial invoice for the first 10 cartons", () => orderByNote("Diwali bulk order for the Pune plant"),
  async (c) => {
    const created = await createSalesOrder(c, owner, { ...header, customerNotes: "Diwali bulk order for the Pune plant", customerPoNumber: "SDP/PO/2026/0470", lines: [line(milk, 30), { itemId: ghee, variantId: ghee1l, quantity: 10, warehouseId: warehouse }] });
    const orderId = created.id ?? created.orderId;
    await submitSalesOrder(c, owner, orderId);
    await confirmSalesOrder(c, owner, orderId);
    const lines = (await getSalesOrder(c, owner, orderId)).lines;
    const milkLine = lines.find((l) => l.item_id === milk);
    await createInvoiceRequest(c, owner, orderId, { idempotencyKey: `f051-partial:${orderId}`, lines: [{ salesOrderLineId: milkLine.id, quantity: 10 }] });
  });

// ---------- F058: longer terms than the customer's default ----------
await step("order on Net 60 (customer default Net 30) waiting for approval", () => orderByNote("Year-end stock-up — customer asked for Net 60"),
  async (c) => {
    const net60 = (await c.query(`SELECT id FROM tenant.payment_terms WHERE organization_id=$1 AND code='NET60'`, [organizationId])).rows[0].id;
    const created = await createSalesOrder(c, owner, { ...header, paymentTermId: net60, customerNotes: "Year-end stock-up — customer asked for Net 60", lines: [line(milk, 25)] });
    await submitSalesOrder(c, owner, created.id ?? created.orderId, priyaId);
  });

await db.end();
console.log("done");
