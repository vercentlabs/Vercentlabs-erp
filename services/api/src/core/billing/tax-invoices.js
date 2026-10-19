// Vercentlabs' own GST tax invoices and credit notes for subscription charges (Shared Platform plan 2). Every captured payment for
// a subscription gets one tax invoice, and every processed refund a credit note against it, numbered per financial year from one
// series each (at most 16 characters, rule 46), with the GST worked back out of the amount charged:
//
//   taxable = charged × 100 / (100 + rate)   (the charge includes GST — catalogue.js adds it on top of the quoted price)
//   intra-state (supplier and customer in the same state)  CGST + SGST, half each
//   inter-state, or a customer with no state on record      IGST
//
// The supplier's facts come from the environment (TAX_INVOICE_SETTINGS below): legal name, GSTIN, state code, address,
// the SAC (the one your CA confirms; 998314 is IT design and development, 997331 is licensing of software) and the rate. Until all
// are set no invoice is issued (the payment is still recorded; issueMissingTaxInvoices catches up once they are).
import { BillingServiceError } from "./errors.js";
import { gstRatePercent } from "./catalogue.js";
import { billingAudit, tx } from "./shared.js";

export const TAX_INVOICE_SETTINGS = Object.freeze([
  "BILLING_SUPPLIER_LEGAL_NAME", "BILLING_SUPPLIER_GSTIN", "BILLING_SUPPLIER_STATE_CODE", "BILLING_SUPPLIER_ADDRESS",
  "BILLING_SERVICE_SAC", "BILLING_GST_RATE_PERCENT", "BILLING_TAX_INVOICE_SERIES",
]);
const DEFAULT_CREDIT_NOTE_SERIES = "VCN/";

export function taxInvoiceReadiness(env = process.env) {
  const missing = TAX_INVOICE_SETTINGS.filter((key) => !String(env[key] || "").trim());
  const series = String(env.BILLING_TAX_INVOICE_SERIES || "").trim();
  const creditSeries = String(env.BILLING_CREDIT_NOTE_SERIES || DEFAULT_CREDIT_NOTE_SERIES).trim();
  const problems = [];
  // prefix + "2627/" + 6 digits must fit in 16 characters.
  if (series && series.length > 5) problems.push("BILLING_TAX_INVOICE_SERIES must be at most 5 characters (the number is at most 16).");
  if (creditSeries.length > 5) problems.push("BILLING_CREDIT_NOTE_SERIES must be at most 5 characters.");
  if (series && !/^[A-Z0-9/-]+$/.test(series)) problems.push("BILLING_TAX_INVOICE_SERIES may use capital letters, digits, / and - only.");
  return { available: missing.length === 0 && problems.length === 0, configured: missing.length === 0, missing, problems };
}

function supplier(env) {
  return {
    legalName: String(env.BILLING_SUPPLIER_LEGAL_NAME).trim(),
    gstin: String(env.BILLING_SUPPLIER_GSTIN).trim().toUpperCase(),
    stateCode: String(env.BILLING_SUPPLIER_STATE_CODE).trim().padStart(2, "0"),
    address: String(env.BILLING_SUPPLIER_ADDRESS).trim(),
    sac: String(env.BILLING_SERVICE_SAC).trim(),
    pan: String(env.BILLING_SUPPLIER_PAN || "").trim().toUpperCase() || null,
  };
}

// Financial year (April–March) of a moment, by its date in India.
export function indiaFinancialYear(at) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  const [year, month] = day.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return { label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, code: `${String(start).slice(2)}${String((start + 1) % 100).padStart(2, "0")}`, day };
}

// The GST inside a GST-inclusive amount, split by supply.
export function splitGst(chargedPaise, ratePercent, { supplierStateCode, customerStateCode }) {
  const charged = Number(chargedPaise);
  const taxable = Math.round((charged * 100) / (100 + Number(ratePercent)));
  const tax = charged - taxable;
  const intraState = Boolean(customerStateCode) && String(customerStateCode).padStart(2, "0") === String(supplierStateCode).padStart(2, "0");
  if (intraState) {
    const cgst = Math.floor(tax / 2);
    return { taxable, tax, cgst, sgst: tax - cgst, igst: 0, intraState };
  }
  return { taxable, tax, cgst: 0, sgst: 0, igst: tax, intraState };
}

async function nextNumber(client, kind, financialYear, prefix) {
  const row = (await client.query(
    `INSERT INTO billing_tax_invoice_series (document_kind, financial_year, next_number) VALUES ($1, $2, 2)
     ON CONFLICT (document_kind, financial_year) DO UPDATE SET next_number = billing_tax_invoice_series.next_number + 1, updated_at = now()
     RETURNING next_number - 1 AS allocated`, [kind, financialYear.label])).rows[0];
  const number = `${prefix}${financialYear.code}/${String(row.allocated).padStart(6, "0")}`;
  if (number.length > 16) throw new BillingServiceError(500, `The ${kind.replace("_", " ")} number ${number} would exceed 16 characters.`, "BILLING_TAX_INVOICE_NUMBER_TOO_LONG");
  return number;
}

async function customerFor(client, organizationId) {
  const row = (await client.query(
    `SELECT customer.legal_name, customer.billing_email, customer.gstin, customer.address_line1, customer.address_line2, customer.city, customer.state,
            customer.state_code, customer.postal_code, customer.country_code, organization.name AS organization_name, organization.legal_name AS organization_legal_name
       FROM public.organizations organization
       LEFT JOIN billing_customers customer ON customer.organization_id = organization.id
      WHERE organization.id = $1`, [organizationId])).rows[0] ?? {};
  const gstin = row.gstin ? String(row.gstin).trim().toUpperCase() : null;
  const stateCode = row.state_code ? String(row.state_code).padStart(2, "0") : gstin ? gstin.slice(0, 2) : null;
  return {
    legalName: row.legal_name || row.organization_legal_name || row.organization_name || "Customer",
    gstin, stateCode, state: row.state ?? null, email: row.billing_email ?? null,
    address: [row.address_line1, row.address_line2, row.city, row.state, row.postal_code].filter(Boolean).join(", ") || null,
  };
}

// The tax invoice for one captured subscription payment, issued once (a second call returns the first). Runs in the caller's
// transaction (webhook processing); returns null when not applicable or not configured.
export async function issueTaxInvoiceForPaymentInTx(client, { organizationId, providerPaymentId }, env = process.env) {
  const readiness = taxInvoiceReadiness(env);
  if (!readiness.available) return null;
  const payment = (await client.query(
    `SELECT payment.*, subscription.price_snapshot, subscription.paid_seats, subscription.billing_period
       FROM billing_payments payment LEFT JOIN organization_subscriptions subscription ON subscription.id = payment.subscription_id
      WHERE payment.organization_id = $1 AND payment.provider_payment_id = $2`, [organizationId, providerPaymentId])).rows[0];
  if (!payment || payment.status !== "captured" || Number(payment.amount_paise) <= 0 || String(payment.currency).trim() !== "INR") return null;
  const existing = (await client.query(`SELECT * FROM billing_invoices WHERE payment_id = $1 AND document_kind = 'tax_invoice'`, [payment.id])).rows[0];
  if (existing) return existing;
  const from = supplier(env);
  const customer = await customerFor(client, organizationId);
  const rate = gstRatePercent(env);
  const split = splitGst(payment.amount_paise, rate, { supplierStateCode: from.stateCode, customerStateCode: customer.stateCode });
  const at = payment.captured_at ?? payment.created_at;
  const financialYear = indiaFinancialYear(at);
  const number = await nextNumber(client, "tax_invoice", financialYear, String(env.BILLING_TAX_INVOICE_SERIES).trim());
  const plan = payment.price_snapshot ?? {};
  const description = `Vercentlabs ERP ${plan.plan_name ?? "subscription"}${payment.paid_seats ? ` — ${payment.paid_seats} user${Number(payment.paid_seats) === 1 ? "" : "s"}` : ""}, billed ${payment.billing_period === "yearly" ? "yearly" : "monthly"}`;
  const details = {
    supplier: from, customer, sac: from.sac, ratePercent: rate, description, intraState: split.intraState,
    placeOfSupply: customer.stateCode, reverseCharge: false, issuedOn: financialYear.day, providerPaymentId,
  };
  const invoice = (await client.query(
    `INSERT INTO billing_invoices (organization_id, subscription_id, provider, provider_invoice_id, amount_paise, amount_due_paise, amount_paid_paise, tax_paise, currency,
                                   status, issued_at, paid_at, provider_snapshot, document_kind, invoice_number, financial_year, payment_id, taxable_paise,
                                   cgst_paise, sgst_paise, igst_paise, tax_details)
     VALUES ($1, $2, 'vercentlabs', NULL, $3, 0, $3, $4, 'INR', 'paid', $5, $5, '{}'::jsonb, 'tax_invoice', $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     RETURNING *`,
    [organizationId, payment.subscription_id, Number(payment.amount_paise), split.tax, at, number, financialYear.label, payment.id, split.taxable,
      split.cgst, split.sgst, split.igst, JSON.stringify(details)])).rows[0];
  await billingAudit(client, { organizationId, eventType: "billing.tax_invoice.issued", entityId: invoice.id, metadata: { number, amountPaise: Number(payment.amount_paise) } });
  return invoice;
}

// A credit note for a processed refund, against the payment's tax invoice (the refunded amount includes its GST).
export async function issueCreditNoteForRefundInTx(client, { organizationId, providerPaymentId, providerRefundId, amountPaise }, env = process.env) {
  if (!taxInvoiceReadiness(env).available || !(Number(amountPaise) > 0)) return null;
  const invoice = (await client.query(
    `SELECT invoice.* FROM billing_invoices invoice JOIN billing_payments payment ON payment.id = invoice.payment_id
      WHERE invoice.organization_id = $1 AND payment.provider_payment_id = $2 AND invoice.document_kind = 'tax_invoice'`, [organizationId, providerPaymentId])).rows[0];
  if (!invoice) return null;
  const duplicate = (await client.query(`SELECT * FROM billing_invoices WHERE document_kind = 'credit_note' AND source_invoice_id = $1 AND tax_details->>'providerRefundId' = $2`,
    [invoice.id, String(providerRefundId)])).rows[0];
  if (duplicate) return duplicate;
  const credited = Number((await client.query(`SELECT COALESCE(sum(amount_paise), 0) AS total FROM billing_invoices WHERE document_kind = 'credit_note' AND source_invoice_id = $1`, [invoice.id])).rows[0].total);
  const amount = Math.min(Number(amountPaise), Number(invoice.amount_paise) - credited);
  if (amount <= 0) return null;
  const details = invoice.tax_details ?? {};
  const split = splitGst(amount, details.ratePercent ?? gstRatePercent(env), { supplierStateCode: details.supplier?.stateCode, customerStateCode: details.customer?.stateCode });
  const financialYear = indiaFinancialYear(new Date());
  const number = await nextNumber(client, "credit_note", financialYear, String(env.BILLING_CREDIT_NOTE_SERIES || DEFAULT_CREDIT_NOTE_SERIES).trim());
  const note = (await client.query(
    `INSERT INTO billing_invoices (organization_id, subscription_id, provider, provider_invoice_id, amount_paise, amount_due_paise, amount_paid_paise, tax_paise, currency,
                                   status, issued_at, provider_snapshot, document_kind, invoice_number, financial_year, payment_id, source_invoice_id, taxable_paise,
                                   cgst_paise, sgst_paise, igst_paise, tax_details)
     VALUES ($1, $2, 'vercentlabs', NULL, $3, 0, 0, $4, 'INR', 'issued', now(), '{}'::jsonb, 'credit_note', $5, $6, NULL, $7, $8, $9, $10, $11, $12::jsonb)
     RETURNING *`,
    [organizationId, invoice.subscription_id, amount, split.tax, number, financialYear.label, invoice.id, split.taxable, split.cgst, split.sgst, split.igst,
      JSON.stringify({ ...details, intraState: split.intraState, issuedOn: financialYear.day, providerRefundId: String(providerRefundId), againstInvoice: invoice.invoice_number })])).rows[0];
  await billingAudit(client, { organizationId, eventType: "billing.credit_note.issued", entityId: note.id, metadata: { number, againstInvoice: invoice.invoice_number, amountPaise: amount } });
  return note;
}

// Catch-up: captured payments that have no tax invoice yet (issued before the supplier settings were complete). Worker maintenance.
export async function issueMissingTaxInvoices(client, env = process.env, { limit = 50 } = {}) {
  if (!taxInvoiceReadiness(env).available) return 0;
  const rows = (await client.query(
    `SELECT payment.organization_id, payment.provider_payment_id FROM billing_payments payment
      WHERE payment.status = 'captured' AND payment.amount_paise > 0 AND payment.subscription_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM billing_invoices invoice WHERE invoice.payment_id = payment.id AND invoice.document_kind = 'tax_invoice')
      ORDER BY payment.created_at LIMIT $1`, [limit])).rows;
  let issued = 0;
  // One transaction per invoice: the number and the invoice are written together, so a failure never leaves a gap in the series.
  for (const row of rows) {
    if (await tx(client, () => issueTaxInvoiceForPaymentInTx(client, { organizationId: row.organization_id, providerPaymentId: row.provider_payment_id }, env))) issued += 1;
  }
  return issued;
}

const rupees = (paise) => (Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The printable tax invoice or credit note (the document engine's model).
export async function getTaxDocument(client, organizationId, id) {
  const row = (await client.query(
    `SELECT invoice.*, source.invoice_number AS against_number FROM billing_invoices invoice LEFT JOIN billing_invoices source ON source.id = invoice.source_invoice_id
      WHERE invoice.organization_id = $1 AND invoice.id = $2 AND invoice.document_kind IN ('tax_invoice', 'credit_note')`, [organizationId, id])).rows[0];
  if (!row) throw new BillingServiceError(404, "That invoice was not found.", "BILLING_INVOICE_NOT_FOUND");
  return row;
}

export function taxDocumentModel(row) {
  const details = row.tax_details ?? {};
  const from = details.supplier ?? {};
  const to = details.customer ?? {};
  const credit = row.document_kind === "credit_note";
  return {
    title: credit ? "Credit note" : "Tax invoice",
    documentNumber: row.invoice_number,
    issuedAt: `Date: ${details.issuedOn ?? ""}`,
    organizationName: from.legalName,
    status: credit ? `Against tax invoice ${row.against_number ?? details.againstInvoice ?? ""}` : "Original for recipient",
    parties: [
      { label: "Supplier", lines: [from.legalName, from.address, from.gstin ? `GSTIN ${from.gstin}` : null, from.pan ? `PAN ${from.pan}` : null, from.stateCode ? `State code ${from.stateCode}` : null].filter(Boolean) },
      { label: "Recipient", lines: [to.legalName, to.address, to.gstin ? `GSTIN ${to.gstin}` : "Unregistered", to.stateCode ? `State code ${to.stateCode}` : null].filter(Boolean) },
    ],
    fields: [
      { label: credit ? "Credit note date" : "Invoice date", value: details.issuedOn ?? "" },
      { label: "Place of supply", value: details.placeOfSupply ? `State code ${details.placeOfSupply}` : "" },
      { label: "Tax payable on reverse charge", value: "No" },
      { label: "Financial year", value: row.financial_year ?? "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Description", width: "46%" },
        { key: "sac", label: "SAC", width: "12%" },
        { key: "taxable", label: "Taxable value (₹)", align: "right", width: "20%" },
        { key: "rate", label: "GST rate", align: "right", width: "10%" },
        { key: "total", label: "Amount (₹)", align: "right", width: "12%" },
      ],
      rows: [{ item: details.description ?? "Vercentlabs ERP subscription", sac: details.sac ?? "", taxable: rupees(row.taxable_paise), rate: `${details.ratePercent ?? ""}%`, total: rupees(row.amount_paise) }],
    },
    totals: [
      { label: "Taxable value", value: rupees(row.taxable_paise) },
      ...(Number(row.cgst_paise) ? [{ label: `CGST ${Number(details.ratePercent) / 2}%`, value: rupees(row.cgst_paise) }, { label: `SGST ${Number(details.ratePercent) / 2}%`, value: rupees(row.sgst_paise) }] : []),
      ...(Number(row.igst_paise) ? [{ label: `IGST ${details.ratePercent}%`, value: rupees(row.igst_paise) }] : []),
      { label: credit ? "Total credited (₹)" : "Total (₹)", value: rupees(row.amount_paise), emphasis: true },
    ],
    notes: [
      { label: credit ? "About this credit note" : "Payment", text: credit ? "Issued for a refund of a subscription charge. The GST shown reduces the GST of the original invoice." : "Paid in full online through Razorpay." },
    ],
    footer: `${row.invoice_number} · ${from.legalName ?? ""} · GSTIN ${from.gstin ?? ""}`,
  };
}

export async function renderTaxDocumentPdf(client, organizationId, id) {
  const row = await getTaxDocument(client, organizationId, id);
  const { renderDocumentPdf, safePdfFileName } = await import("@vercentlabs/document-engine/pdf");
  return { fileName: safePdfFileName(`${row.document_kind === "credit_note" ? "credit-note" : "tax-invoice"}-${row.invoice_number}`), body: await renderDocumentPdf(taxDocumentModel(row)) };
}
