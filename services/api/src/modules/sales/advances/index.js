// GST on advances (Sales report Phase 2). Under GST, an advance received for services is taxed when it is received: the seller issues a
// receipt voucher (Rule 50) with the GST worked out of the advance at the rate of the supply, and pays that tax with the month's return.
// When the advance is later used on the invoice, the tax already paid is adjusted (GSTR-1 table 11B) — the invoice itself still shows its
// full tax. An advance returned without a supply gets a refund voucher (Rule 51).
//
// The company switches receipt vouchers on from a date (Sales settings › GST & e-invoice); payments before that date are never touched.
// Recording payments is the permission. The advance money itself stays Finance's receipt; the vouchers are the GST record beside it.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { invoiceCan } from "../invoices/access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "../invoices/constants.js";
import { companyToday } from "../today.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (value) => Math.round(Number(value) * 100);
const rupees = (value) => Math.round(Number(value) * 100) / 100;
const text = (value, max) => String(value ?? "").trim().slice(0, max);

function requireRecord(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.recordPayment) && !invoiceCan(context, "accounting.receipts.manage"))
    throw new InvoiceError(403, "You do not have permission to issue receipt vouchers.", "PERMISSION_DENIED");
}

// The tax inside a gross amount at `rate`, split CGST + SGST inside the state and IGST between states.
export function taxOfAdvance(gross, rate, nature) {
  const total = cents(gross);
  const taxable = Math.round((total * 100) / (100 + Number(rate)));
  const tax = total - taxable;
  const cgst = nature === "intra" ? Math.round(tax / 2) : 0;
  return { taxable: taxable / 100, igst: nature === "inter" ? tax / 100 : 0, cgst: cgst / 100, sgst: nature === "intra" ? (tax - cgst) / 100 : 0 };
}
// The share of a voucher's tax that `gross` of it carries.
function shareOf(voucher, gross) {
  const part = (field) => rupees((Number(voucher[field]) * gross) / Number(voucher.amount));
  const taxable = part("taxable");
  const igst = part("igst");
  const cgst = part("cgst");
  return { taxable, igst, cgst, sgst: rupees(gross - taxable - igst - cgst) };
}

const voucherView = (row) => ({
  id: row.id, number: row.voucher_number, date: row.voucher_day ?? row.voucher_date, partyId: row.party_id, customerName: row.customer_name, customerGstin: row.customer_gstin,
  receiptId: row.receipt_id, sellerGstin: row.seller_gstin, placeOfSupply: row.place_of_supply, supplyNature: row.supply_nature, description: row.description, sacHsn: row.sac_hsn,
  rate: Number(row.rate), amount: Number(row.amount), taxable: Number(row.taxable), igst: Number(row.igst), cgst: Number(row.cgst), sgst: Number(row.sgst),
  used: Number(row.adjusted_amount), refunded: Number(row.refunded_amount), left: rupees(Number(row.amount) - Number(row.adjusted_amount) - Number(row.refunded_amount)), status: row.status,
});

async function receiptOf(client, context, receiptId) {
  if (!UUID.test(String(receiptId ?? ""))) throw new InvoiceError(404, "Payment not found.", "SALES_PAYMENT_NOT_FOUND");
  const receipt = (await client.query(
    `SELECT receipt.*, receipt.receipt_date::text AS receipt_day, btrim(receipt.currency_code) AS currency FROM tenant.accounting_customer_receipts receipt
      WHERE receipt.organization_id = $1 AND receipt.id = $2 FOR UPDATE`, [context.organizationId, receiptId])).rows[0];
  if (!receipt) throw new InvoiceError(404, "Payment not found.", "SALES_PAYMENT_NOT_FOUND");
  return receipt;
}

// What of a payment is advance still without a voucher: its unused part less what open vouchers already cover.
async function unvouchered(client, context, receipt) {
  const open = (await client.query(
    `SELECT COALESCE(sum(amount - adjusted_amount - refunded_amount), 0) AS open FROM tenant.sales_receipt_vouchers WHERE organization_id = $1 AND receipt_id = $2 AND status <> 'cancelled'`,
    [context.organizationId, receipt.id])).rows[0].open;
  return rupees(Number(receipt.unapplied_amount) - Number(open));
}

// input: { receiptId, amount? (default: all the advance without a voucher), rate (the supply's GST rate), description?, sacHsn?, voucherDate? }
export async function issueReceiptVoucher(client, context, input = {}) {
  requireRecord(context);
  const receipt = await receiptOf(client, context, input.receiptId);
  if (!["posted", "partially_applied"].includes(receipt.status)) throw new InvoiceError(409, "Only a recorded payment with money not yet used can have a receipt voucher.", "SALES_VOUCHER_STATE");
  if (receipt.currency !== "INR") throw new InvoiceError(409, "Receipt vouchers are for payments in rupees.", "SALES_VOUCHER_STATE");
  const from = (await client.query("SELECT receipt_vouchers_from::text AS from_day FROM tenant.sales_settings WHERE organization_id = $1", [context.organizationId])).rows[0]?.from_day;
  if (!from) throw new InvoiceError(409, "Switch on receipt vouchers in Sales › Setup › GST & e-invoice first.", "SALES_VOUCHERS_OFF");
  if (receipt.receipt_day < from) throw new InvoiceError(409, `Receipt vouchers start from ${from}; this payment is earlier.`, "SALES_VOUCHERS_OFF");
  const available = await unvouchered(client, context, receipt);
  const amount = input.amount === undefined || input.amount === null || input.amount === "" ? available : rupees(input.amount);
  if (!(amount > 0)) throw new InvoiceError(409, "This payment has no advance left without a voucher.", "SALES_VOUCHER_NOTHING_LEFT");
  if (cents(amount) > cents(available)) throw new InvoiceError(409, `Only ${available.toFixed(2)} of this payment is advance without a voucher.`, "SALES_VOUCHER_TOO_MUCH");
  const rate = Number(input.rate);
  if (![0, 0.25, 3, 5, 12, 18, 28, 40].includes(rate)) throw new InvoiceError(400, "Choose the GST rate of what will be supplied.", "SALES_VOUCHER_INVALID", { field: "rate" });
  const today = await companyToday(client);
  const voucherDate = input.voucherDate ? String(input.voucherDate).slice(0, 10) : receipt.receipt_day;
  if (!DATE.test(voucherDate) || voucherDate > today || voucherDate < receipt.receipt_day)
    throw new InvoiceError(400, "The voucher is dated on or after the payment, and not in the future.", "SALES_VOUCHER_INVALID", { field: "voucherDate" });
  const seller = (await client.query(
    "SELECT id, registration_number, state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND registration_number IS NOT NULL ORDER BY is_default DESC LIMIT 1",
    [context.organizationId])).rows[0];
  if (!seller) throw new InvoiceError(409, "Add the company's GSTIN before issuing receipt vouchers.", "SALES_VOUCHER_NO_GSTIN");
  const party = (await client.query("SELECT display_name, legal_name, gstin, place_of_supply, gst_state_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2",
    [context.organizationId, receipt.party_id])).rows[0];
  const placeOfSupply = String(party?.place_of_supply || party?.gst_state_code || (party?.gstin ? party.gstin.slice(0, 2) : "") || seller.state_code);
  const nature = placeOfSupply === seller.state_code ? "intra" : "inter";
  const tax = taxOfAdvance(amount, rate, nature);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_receipt_voucher", at: new Date(`${voucherDate}T12:00:00Z`) });
  const row = (await client.query(
    `INSERT INTO tenant.sales_receipt_vouchers (organization_id, voucher_number, voucher_date, party_id, receipt_id, registration_id, seller_gstin, customer_name, customer_gstin,
        place_of_supply, supply_nature, description, sac_hsn, rate, amount, taxable, igst, cgst, sgst, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *, voucher_date::text AS voucher_day`,
    [context.organizationId, number, voucherDate, receipt.party_id, receipt.id, seller.id, seller.registration_number, party?.legal_name || party?.display_name, party?.gstin ?? null,
      placeOfSupply, nature, text(input.description, 500) || "Advance received", text(input.sacHsn, 10) || null, rate, amount, tax.taxable, tax.igst, tax.cgst, tax.sgst,
      context.userId ?? null])).rows[0];
  return { voucher: voucherView(row) };
}

// The vouchers of a payment, a customer or an invoice (with what was used and refunded). options: { receiptId?, partyId?, invoiceId? }
export async function listReceiptVouchers(client, context, options = {}) {
  requireRecord(context);
  const values = [context.organizationId];
  const where = ["voucher.organization_id = $1"];
  for (const [key, column] of [["receiptId", "voucher.receipt_id"], ["partyId", "voucher.party_id"]])
    if (UUID.test(String(options[key] ?? ""))) { values.push(options[key]); where.push(`${column} = $${values.length}`); }
  if (UUID.test(String(options.invoiceId ?? ""))) {
    values.push(options.invoiceId);
    where.push(`EXISTS (SELECT 1 FROM tenant.sales_receipt_voucher_adjustments used WHERE used.voucher_id = voucher.id AND used.invoice_id = $${values.length})`);
  }
  const rows = (await client.query(`SELECT voucher.*, voucher.voucher_date::text AS voucher_day FROM tenant.sales_receipt_vouchers voucher WHERE ${where.join(" AND ")}
    ORDER BY voucher.voucher_date DESC, voucher.voucher_number DESC LIMIT 200`, values)).rows;
  const ids = rows.map((row) => row.id);
  const adjustments = ids.length ? (await client.query(
    `SELECT used.*, used.adjusted_on::text AS day, invoice.invoice_number FROM tenant.sales_receipt_voucher_adjustments used
       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = used.invoice_id WHERE used.organization_id = $1 AND used.voucher_id = ANY($2::uuid[]) ORDER BY used.adjusted_on`,
    [context.organizationId, ids])).rows : [];
  const refunds = ids.length ? (await client.query(
    "SELECT refund.*, refund.refund_date::text AS day FROM tenant.sales_refund_vouchers refund WHERE refund.organization_id = $1 AND refund.receipt_voucher_id = ANY($2::uuid[]) ORDER BY refund.refund_date",
    [context.organizationId, ids])).rows : [];
  return {
    vouchers: rows.map((row) => ({
      ...voucherView(row),
      uses: adjustments.filter((entry) => entry.voucher_id === row.id).map((entry) => ({ invoiceId: entry.invoice_id, invoiceNumber: entry.invoice_number, date: entry.day, amount: Number(entry.amount) })),
      refunds: refunds.filter((entry) => entry.receipt_voucher_id === row.id).map((entry) => ({ id: entry.id, number: entry.voucher_number, date: entry.day, amount: Number(entry.amount), reason: entry.reason })),
    })),
  };
}

// An advance used on an invoice (Sales applies a payment's advance): the vouchers of that payment, oldest first, are adjusted by the
// amount used, each carrying its share of the tax already paid. Returns the adjustments made.
export async function adjustReceiptVouchers(client, context, { receiptId, invoiceId, amount, date }) {
  let left = cents(amount);
  if (left <= 0) return [];
  const day = date ?? await companyToday(client);
  const vouchers = (await client.query(
    `SELECT * FROM tenant.sales_receipt_vouchers WHERE organization_id = $1 AND receipt_id = $2 AND status IN ('issued', 'partly_used')
      ORDER BY voucher_date, voucher_number FOR UPDATE`, [context.organizationId, receiptId])).rows;
  const made = [];
  for (const voucher of vouchers) {
    if (left <= 0) break;
    const open = cents(Number(voucher.amount) - Number(voucher.adjusted_amount) - Number(voucher.refunded_amount));
    const take = Math.min(open, left);
    if (take <= 0) continue;
    const gross = take / 100;
    const share = shareOf(voucher, gross);
    await client.query(
      `INSERT INTO tenant.sales_receipt_voucher_adjustments (organization_id, voucher_id, invoice_id, adjusted_on, amount, taxable, igst, cgst, sgst, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [context.organizationId, voucher.id, invoiceId, day, gross, share.taxable, share.igst, share.cgst, share.sgst, context.userId ?? null]);
    const used = rupees(Number(voucher.adjusted_amount) + gross);
    const status = cents(used) + cents(voucher.refunded_amount) >= cents(voucher.amount) ? "used" : "partly_used";
    await client.query("UPDATE tenant.sales_receipt_vouchers SET adjusted_amount = $3, status = $4 WHERE organization_id = $1 AND id = $2", [context.organizationId, voucher.id, used, status]);
    made.push({ voucherNumber: voucher.voucher_number, amount: gross, ...share });
    left -= take;
  }
  return made;
}

// The advance (or part of it) given back without a supply. input: { amount, refundDate?, reason }. The money goes back through Finance's
// refund; this is its GST document, which takes the tax back.
export async function issueRefundVoucher(client, context, voucherId, input = {}) {
  requireRecord(context);
  if (!UUID.test(String(voucherId ?? ""))) throw new InvoiceError(404, "Receipt voucher not found.", "SALES_VOUCHER_NOT_FOUND");
  const voucher = (await client.query("SELECT *, voucher_date::text AS voucher_day FROM tenant.sales_receipt_vouchers WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, voucherId])).rows[0];
  if (!voucher) throw new InvoiceError(404, "Receipt voucher not found.", "SALES_VOUCHER_NOT_FOUND");
  const open = rupees(Number(voucher.amount) - Number(voucher.adjusted_amount) - Number(voucher.refunded_amount));
  const amount = rupees(input.amount ?? open);
  if (!(amount > 0) || cents(amount) > cents(open)) throw new InvoiceError(409, `Up to ${open.toFixed(2)} of this voucher can be refunded.`, "SALES_VOUCHER_TOO_MUCH");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw new InvoiceError(400, "Say why the advance is returned.", "SALES_VOUCHER_INVALID", { field: "reason" });
  const today = await companyToday(client);
  const refundDate = input.refundDate ? String(input.refundDate).slice(0, 10) : today;
  if (!DATE.test(refundDate) || refundDate > today || refundDate < voucher.voucher_day)
    throw new InvoiceError(400, "The refund is dated on or after the voucher, and not in the future.", "SALES_VOUCHER_INVALID", { field: "refundDate" });
  const share = shareOf(voucher, amount);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_refund_voucher", at: new Date(`${refundDate}T12:00:00Z`) });
  const row = (await client.query(
    `INSERT INTO tenant.sales_refund_vouchers (organization_id, voucher_number, receipt_voucher_id, refund_date, amount, taxable, igst, cgst, sgst, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, voucher_number`,
    [context.organizationId, number, voucher.id, refundDate, amount, share.taxable, share.igst, share.cgst, share.sgst, reason, context.userId ?? null])).rows[0];
  const refunded = rupees(Number(voucher.refunded_amount) + amount);
  const status = cents(refunded) >= cents(voucher.amount) ? "refunded" : cents(refunded) + cents(voucher.adjusted_amount) >= cents(voucher.amount) ? "used" : "partly_used";
  await client.query("UPDATE tenant.sales_receipt_vouchers SET refunded_amount = $3, status = $4 WHERE organization_id = $1 AND id = $2", [context.organizationId, voucher.id, refunded, status]);
  return { refundVoucherId: row.id, number: row.voucher_number, amount, ...share };
}

// The setting: receipt vouchers from a date (null: off).
export async function setReceiptVouchersFrom(client, context, from) {
  if (!invoiceCan(context, "sales.settings.manage")) throw new InvoiceError(403, "You do not have permission to change Sales settings.", "PERMISSION_DENIED");
  const day = from ? String(from).slice(0, 10) : null;
  if (day && !DATE.test(day)) throw new InvoiceError(400, "Enter the date receipt vouchers start from.", "SALES_VOUCHER_INVALID", { field: "from" });
  await client.query(
    `INSERT INTO tenant.sales_settings (organization_id, receipt_vouchers_from, created_by, updated_by) VALUES ($1, $2, $3, $3)
     ON CONFLICT (organization_id) DO UPDATE SET receipt_vouchers_from = EXCLUDED.receipt_vouchers_from, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, day, context.userId ?? null]);
  return { from: day };
}

// What a receipt voucher prints (Rule 50): the supplier and recipient, the advance, the rate, the tax, the place of supply.
export async function getReceiptVoucherDocument(client, context, voucherId) {
  requireRecord(context);
  if (!UUID.test(String(voucherId ?? ""))) throw new InvoiceError(404, "Receipt voucher not found.", "SALES_VOUCHER_NOT_FOUND");
  const row = (await client.query(
    `SELECT voucher.*, voucher.voucher_date::text AS voucher_day, receipt.receipt_number, registration.name AS seller_name, registration.legal_name AS seller_legal_name,
            registration.address_line1, registration.city, registration.state_name, party.customer_number
       FROM tenant.sales_receipt_vouchers voucher
       JOIN tenant.accounting_customer_receipts receipt ON receipt.id = voucher.receipt_id
       LEFT JOIN tenant.tax_registrations registration ON registration.id = voucher.registration_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = voucher.organization_id AND party.id = voucher.party_id
      WHERE voucher.organization_id = $1 AND voucher.id = $2`, [context.organizationId, voucherId])).rows[0];
  if (!row) throw new InvoiceError(404, "Receipt voucher not found.", "SALES_VOUCHER_NOT_FOUND");
  return { voucher: { ...voucherView(row), receiptNumber: row.receipt_number, customerNumber: row.customer_number,
    seller: { name: row.seller_legal_name || row.seller_name, address: [row.address_line1, row.city, row.state_name].filter(Boolean).join(", ") || null } } };
}

// What a refund voucher prints (Rule 51): the receipt voucher it refers to, the amount returned and its tax.
export async function getRefundVoucherDocument(client, context, refundVoucherId) {
  requireRecord(context);
  if (!UUID.test(String(refundVoucherId ?? ""))) throw new InvoiceError(404, "Refund voucher not found.", "SALES_VOUCHER_NOT_FOUND");
  const refund = (await client.query("SELECT *, refund_date::text AS refund_day FROM tenant.sales_refund_vouchers WHERE organization_id = $1 AND id = $2",
    [context.organizationId, refundVoucherId])).rows[0];
  if (!refund) throw new InvoiceError(404, "Refund voucher not found.", "SALES_VOUCHER_NOT_FOUND");
  const { voucher } = await getReceiptVoucherDocument(client, context, refund.receipt_voucher_id);
  return { voucher, refund: { id: refund.id, number: refund.voucher_number, date: refund.refund_day, amount: Number(refund.amount), taxable: Number(refund.taxable),
    igst: Number(refund.igst), cgst: Number(refund.cgst), sgst: Number(refund.sgst), reason: refund.reason } };
}
