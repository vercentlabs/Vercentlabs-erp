// CRM quotes (CRM audit M1): a quotation or proforma sent straight from a deal when the organization has no Sales app. An Indian SMB
// expects to quote from the CRM: items, GST, a PDF, and sending it by email or WhatsApp. When Sales is switched on later, a quote
// becomes a Sales quotation (upgradeDealQuoteToSales) and stays here as history; with Sales on, new quotations are made in Sales.
//
// GST: each line carries its rate (from the product's tax category, or typed); the tax is CGST + SGST when the place of supply is the
// seller's own state, IGST when it is another. The seller's state is its default GST registration (else the company profile's
// state); the place of supply is the customer's GST state (else its billing address's state), and can be changed on the quote.
// Money is computed in paise, line by line, so totals never drift.
import { createHash, randomBytes } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";

import { canInApp, hasApp, loadApps } from "../../../core/access/apps.js";
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { findIndianState } from "@vercentlabs/shared-types";
import { crmIsOn } from "../data-management/crm-on.js";
import { CrmError } from "../data-management/errors.js";
import { recordQuotationEmailOnDeal } from "../email/outbound.js";
import { opportunityCan, requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { recordOpportunityHistory } from "../opportunities/history.js";
import { getOpportunity } from "../opportunities/records.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KINDS = Object.freeze({ quotation: { label: "Quotation", numbering: "crm_quote" }, proforma: { label: "Proforma invoice", numbering: "crm_proforma" } });
const EDITABLE = new Set(["draft", "sent"]);
const MAX_LINES = 200;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const text = (value, maximum = 4000) => {
  const result = value === null || value === undefined ? "" : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
const invalid = (message, field, details = {}) => new CrmError(400, message, "CRM_QUOTE_VALIDATION", { field, ...details });
const paise = (value) => Math.round(Number(value) * 100);
const rupees = (value) => (value / 100).toFixed(2);

// Who may do what with quotes: making them needs the deal's "create quotation" right, and is offered only while Sales is off (with
// Sales, quotations are made there); upgrading needs Sales on and Sales' own right.
export function dealQuoteCapabilities(context) {
  const create = opportunityCan(context, OPPORTUNITY_PERMISSIONS.createQuotation);
  return { create: create && !hasApp(context, "sales"), edit: create, upgrade: create && canInApp(context, "sales", "sales.quotation.create") };
}

// The tax of one line, in paise: { taxable, cgst, sgst, igst, total }. Intra-state halves the rate into CGST and SGST.
export function quoteLineTax({ quantity, unitPrice, discountPercent = 0, gstRate = 0 }, intraState) {
  const gross = paise(Number(quantity) * Number(unitPrice));
  const taxable = Math.round(gross * (1 - Number(discountPercent) / 100));
  const tax = Math.round(taxable * Number(gstRate) / 100);
  const cgst = intraState ? Math.floor(tax / 2) : 0;
  const sgst = intraState ? tax - cgst : 0;
  return { gross, taxable, cgst, sgst, igst: intraState ? 0 : tax, total: taxable + tax };
}

async function sellerState(client, organizationId) {
  const registration = (await client.query(
    "SELECT state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND state_code IS NOT NULL ORDER BY is_default DESC, created_at LIMIT 1",
    [organizationId])).rows[0];
  if (registration?.state_code) return registration.state_code;
  return (await client.query("SELECT state_code FROM public.organizations WHERE id = $1", [organizationId])).rows[0]?.state_code ?? null;
}

async function customerTaxOf(client, organizationId, partyId) {
  if (!partyId) return { state: null, gstin: null };
  const row = (await client.query(
    `SELECT party.gstin, party.gst_state_code,
            (SELECT address.state_code FROM tenant.addresses address WHERE address.organization_id = party.organization_id AND address.party_id = party.id
               ORDER BY address.is_default_billing DESC, address.created_at LIMIT 1) AS address_state
       FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.id = $2`, [organizationId, partyId])).rows[0];
  return { state: row?.gst_state_code ?? row?.address_state ?? null, gstin: row?.gstin ?? null };
}

// Reads and checks the lines as sent by the quote screen.
function readLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw invalid("Add at least one line.", "lines");
  if (lines.length > MAX_LINES) throw invalid(`A quote can have at most ${MAX_LINES} lines.`, "lines");
  return lines.map((line, index) => {
    const at = { line: index + 1 };
    const description = text(line.description, 1000);
    if (!description) throw invalid(`Line ${index + 1}: describe what is being sold.`, "lines", at);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw invalid(`Line ${index + 1}: enter a quantity greater than zero.`, "lines", at);
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw invalid(`Line ${index + 1}: enter the price.`, "lines", at);
    const discountPercent = line.discountPercent === undefined || line.discountPercent === null || line.discountPercent === "" ? 0 : Number(line.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw invalid(`Line ${index + 1}: the discount must be between 0 and 100%.`, "lines", at);
    const gstRate = line.gstRate === undefined || line.gstRate === null || line.gstRate === "" ? 0 : Number(line.gstRate);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw invalid(`Line ${index + 1}: choose the GST rate.`, "lines", at);
    const itemId = UUID.test(String(line.itemId ?? "")) ? line.itemId : null;
    return { itemId, description, hsnSac: text(line.hsnSac, 12), quantity, unitPrice, discountPercent, gstRate };
  });
}

// Writes the lines and the quote's totals, from its place of supply.
async function writeLines(client, organizationId, quote, lines) {
  const intra = Boolean(quote.seller_state_code && quote.place_of_supply && quote.seller_state_code === quote.place_of_supply) || !quote.place_of_supply;
  await client.query("DELETE FROM tenant.crm_quote_lines WHERE organization_id = $1 AND quote_id = $2", [organizationId, quote.id]);
  let gross = 0;
  let taxable = 0;
  let tax = 0;
  for (const [index, line] of lines.entries()) {
    const amounts = quoteLineTax(line, intra);
    gross += amounts.gross;
    taxable += amounts.taxable;
    tax += amounts.cgst + amounts.sgst + amounts.igst;
    await client.query(
      `INSERT INTO tenant.crm_quote_lines (organization_id, quote_id, line_number, item_id, description, hsn_sac, quantity, unit_price, discount_percent, gst_rate, taxable, cgst, sgst, igst, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [organizationId, quote.id, index + 1, line.itemId, line.description, line.hsnSac, line.quantity, line.unitPrice, line.discountPercent, line.gstRate,
        rupees(amounts.taxable), rupees(amounts.cgst), rupees(amounts.sgst), rupees(amounts.igst), rupees(amounts.total)]);
  }
  await client.query(
    "UPDATE tenant.crm_quotes SET subtotal = $3, discount_total = $4, tax_total = $5, grand_total = $6, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [organizationId, quote.id, rupees(taxable), rupees(gross - taxable), rupees(tax), rupees(taxable + tax)]);
}

// The deal's products as quote lines, with each product's HSN/SAC and GST rate; a deal without products quotes its estimated value.
async function linesFromDeal(client, organizationId, deal) {
  const { rows } = await client.query(
    `SELECT line.item_id, COALESCE(NULLIF(line.description, ''), item.name) AS description, item.hsn_sac_code, line.quantity, line.unit_price, line.discount_percent,
            COALESCE((SELECT rate.rate FROM tenant.tax_rates rate WHERE rate.organization_id = item.organization_id AND rate.tax_category_id = item.tax_category_id
                         AND rate.status = 'active' AND rate.tax_type = 'gst' AND (rate.effective_from IS NULL OR rate.effective_from <= current_date)
                         AND (rate.effective_to IS NULL OR rate.effective_to >= current_date) ORDER BY rate.effective_from DESC NULLS LAST LIMIT 1), line.tax_percent, 0) AS gst_rate
       FROM tenant.crm_opportunity_items line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.opportunity_id = $2 ORDER BY line.created_at`, [organizationId, deal.id]);
  if (rows.length)
    return rows.map((row) => ({ itemId: row.item_id, description: row.description || deal.name, hsnSac: row.hsn_sac_code, quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
      discountPercent: Number(row.discount_percent ?? 0), gstRate: Number(row.gst_rate ?? 0) }));
  return [{ itemId: null, description: deal.name, hsnSac: null, quantity: 1, unitPrice: Number(deal.amount ?? 0), discountPercent: 0, gstRate: 18 }];
}

const toQuote = (row) => ({
  id: row.id, number: row.quote_number, kind: row.kind, kindLabel: KINDS[row.kind].label, status: row.status, opportunityId: row.opportunity_id,
  quoteDate: row.quote_on, validUntil: row.valid_on, currencyCode: String(row.currency_code).trim(), sellerStateCode: row.seller_state_code, placeOfSupply: row.place_of_supply,
  placeOfSupplyName: row.place_of_supply ? findIndianState({ code: row.place_of_supply })?.name ?? null : null, customerGstin: row.customer_gstin,
  notes: row.notes, terms: row.terms, subtotal: row.subtotal, discountTotal: row.discount_total, taxTotal: row.tax_total, grandTotal: row.grand_total,
  sentAt: row.sent_at, decidedAt: row.decided_at, salesQuotationId: row.sales_quotation_id, salesQuotationNumber: row.sales_quotation_number ?? null,
  companyId: row.party_id, companyName: row.company_name ?? null, contactId: row.contact_id, contactName: row.contact_name ?? null, contactEmail: row.contact_email ?? null,
  contactMobile: row.contact_mobile ?? null, dealCode: row.deal_code ?? null, dealName: row.deal_name ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
});
const toLine = (row) => ({
  id: row.id, lineNumber: row.line_number, itemId: row.item_id, description: row.description, hsnSac: row.hsn_sac, quantity: row.quantity, unitPrice: row.unit_price,
  discountPercent: row.discount_percent, gstRate: row.gst_rate, taxable: row.taxable, cgst: row.cgst, sgst: row.sgst, igst: row.igst, lineTotal: row.line_total,
});
const QUOTE_SELECT = `SELECT quote.*, to_char(quote.quote_date, 'YYYY-MM-DD') AS quote_on, to_char(quote.valid_until, 'YYYY-MM-DD') AS valid_on,
         party.display_name AS company_name, btrim(contact.first_name || ' ' || COALESCE(contact.last_name, '')) AS contact_name, contact.email AS contact_email,
         COALESCE(contact.mobile, contact.phone) AS contact_mobile, deal.code AS deal_code, deal.name AS deal_name, sales.quotation_number AS sales_quotation_number
    FROM tenant.crm_quotes quote
    JOIN tenant.crm_opportunities deal ON deal.organization_id = quote.organization_id AND deal.id = quote.opportunity_id
    LEFT JOIN tenant.business_parties party ON party.organization_id = quote.organization_id AND party.id = quote.party_id
    LEFT JOIN tenant.contacts contact ON contact.organization_id = quote.organization_id AND contact.id = quote.contact_id
    LEFT JOIN tenant.sales_quotations sales ON sales.organization_id = quote.organization_id AND sales.id = quote.sales_quotation_id`;

// The quote with its lines; its deal must be visible to the caller (the deal's own Own / Team / All rule).
async function loadQuote(client, context, quoteId, { lock = false } = {}) {
  if (!UUID.test(String(quoteId ?? ""))) throw new CrmError(404, "Quote not found.", "CRM_QUOTE_NOT_FOUND");
  const row = (await client.query(`${QUOTE_SELECT} WHERE quote.organization_id = $1 AND quote.id = $2${lock ? " FOR UPDATE OF quote" : ""}`, [context.organizationId, quoteId])).rows[0];
  if (!row) throw new CrmError(404, "Quote not found.", "CRM_QUOTE_NOT_FOUND");
  await getOpportunity(client, context, row.opportunity_id);
  return row;
}

export async function listDealQuotes(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
  const deal = await getOpportunity(client, context, opportunityId);
  const { rows } = await client.query(`${QUOTE_SELECT} WHERE quote.organization_id = $1 AND quote.opportunity_id = $2 ORDER BY quote.created_at DESC`, [context.organizationId, deal.id]);
  return { quotes: rows.map(toQuote), capabilities: dealQuoteCapabilities(context) };
}

export async function getDealQuote(client, context, quoteId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
  await loadApps(client, context);
  const row = await loadQuote(client, context, quoteId);
  const lines = (await client.query("SELECT * FROM tenant.crm_quote_lines WHERE organization_id = $1 AND quote_id = $2 ORDER BY line_number", [context.organizationId, row.id])).rows;
  return { quote: toQuote(row), lines: lines.map(toLine), capabilities: dealQuoteCapabilities(context) };
}

// A new draft from the deal: its company and contact, its products (or its value) as lines. input: { kind? "quotation" | "proforma" }
export async function createDealQuote(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to create quotations.");
  await loadApps(client, context);
  if (hasApp(context, "sales")) throw new CrmError(409, "Your company has the Sales app: create the quotation in Sales from this deal.", "CRM_QUOTE_USE_SALES");
  const kind = input.kind === "proforma" ? "proforma" : "quotation";
  const deal = await getOpportunity(client, context, opportunityId);
  if (!deal.accountId) throw new CrmError(409, "Add the customer's company to this deal before making a quote.", "CRM_QUOTE_COMPANY_REQUIRED");
  const organizationId = context.organizationId;
  const seller = await sellerState(client, organizationId);
  const customer = await customerTaxOf(client, organizationId, deal.accountId);
  const number = await nextDocumentNumber(client, { organizationId }, { documentType: KINDS[kind].numbering });
  const quote = (await client.query(
    `INSERT INTO tenant.crm_quotes (organization_id, opportunity_id, party_id, contact_id, quote_number, kind, valid_until, currency_code, seller_state_code, place_of_supply,
                                    customer_gstin, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, current_date + 15, $7, $8, $9, $10, $11, $11) RETURNING *`,
    [organizationId, deal.id, deal.accountId, deal.contactId ?? null, number, kind, deal.currencyCode || "INR", seller, customer.state ?? seller, customer.gstin, context.userId ?? null])).rows[0];
  await writeLines(client, organizationId, quote, await linesFromDeal(client, organizationId, { id: deal.id, name: deal.name, amount: deal.amount }));
  await recordOpportunityHistory(client, context, deal.id, "quotation_created", `${KINDS[kind].label} ${number} created`, { quoteId: quote.id, number });
  return getDealQuote(client, context, quote.id);
}

// Changes a draft or sent quote. input: { kind?, validUntil?, placeOfSupply?, notes?, terms?, lines? }. A sent quote that is changed
// goes back to draft (send it again).
export async function updateDealQuote(client, context, quoteId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to change quotations.");
  const row = await loadQuote(client, context, quoteId, { lock: true });
  if (!EDITABLE.has(row.status)) throw new CrmError(409, `This quote is ${row.status}: it can no longer be changed. Make a new one.`, "CRM_QUOTE_LOCKED");
  const next = { kind: row.kind, valid_until: row.valid_on, place_of_supply: row.place_of_supply, notes: row.notes, terms: row.terms };
  if (input.kind !== undefined) next.kind = input.kind === "proforma" ? "proforma" : "quotation";
  if (input.validUntil !== undefined) {
    const value = text(input.validUntil, 10);
    if (value && !DATE.test(value)) throw invalid("Choose the date the offer is valid until.", "validUntil");
    next.valid_until = value;
  }
  if (input.placeOfSupply !== undefined) {
    const value = text(input.placeOfSupply, 4);
    if (value && !findIndianState({ code: value })) throw invalid("Choose the state of supply.", "placeOfSupply");
    next.place_of_supply = value;
  }
  if (input.notes !== undefined) next.notes = text(input.notes, 4000);
  if (input.terms !== undefined) next.terms = text(input.terms, 4000);
  const lines = input.lines !== undefined ? readLines(input.lines) : null;
  const renumber = next.kind !== row.kind;
  const number = renumber ? await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: KINDS[next.kind].numbering }) : row.quote_number;
  const updated = (await client.query(
    `UPDATE tenant.crm_quotes SET kind = $3, quote_number = $4, valid_until = $5, place_of_supply = $6, notes = $7, terms = $8, status = 'draft', updated_by = $9, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, row.id, next.kind, number, next.valid_until, next.place_of_supply, next.notes, next.terms, context.userId ?? null])).rows[0];
  const current = lines ?? (await client.query("SELECT * FROM tenant.crm_quote_lines WHERE organization_id = $1 AND quote_id = $2 ORDER BY line_number", [context.organizationId, row.id])).rows
    .map((line) => ({ itemId: line.item_id, description: line.description, hsnSac: line.hsn_sac, quantity: Number(line.quantity), unitPrice: Number(line.unit_price),
      discountPercent: Number(line.discount_percent), gstRate: Number(line.gst_rate) }));
  await writeLines(client, context.organizationId, updated, current);
  return getDealQuote(client, context, row.id);
}

// The customer's answer, or "sent" when it went out another way. status: "sent" | "accepted" | "declined". The deal stays open: a
// quote never wins a deal.
export async function setDealQuoteStatus(client, context, quoteId, status) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to change quotations.");
  if (!["sent", "accepted", "declined"].includes(status)) throw invalid("Choose sent, accepted or declined.", "status");
  const row = await loadQuote(client, context, quoteId, { lock: true });
  if (row.status === "upgraded") throw new CrmError(409, "This quote became a Sales quotation: record the answer there.", "CRM_QUOTE_LOCKED");
  await client.query(
    `UPDATE tenant.crm_quotes SET status = $3, sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END,
            decided_at = CASE WHEN $3 IN ('accepted', 'declined') THEN now() ELSE NULL END, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, status, context.userId ?? null]);
  const word = { sent: "marked as sent", accepted: "accepted by the customer", declined: "declined by the customer" }[status];
  await recordOpportunityHistory(client, context, row.opportunity_id, "updated", `${KINDS[row.kind].label} ${row.quote_number} ${word}`, { quoteId: row.id });
  return getDealQuote(client, context, row.id);
}

// The customer's link to the quote (a page with the PDF): the same link every time, so one sent on WhatsApp keeps working.
export async function dealQuoteShareLink(client, context, quoteId, env = process.env) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to share quotations.");
  const row = await loadQuote(client, context, quoteId, { lock: true });
  let token = row.share_token_encrypted ? (await decryptSecret(row.share_token_encrypted, env))?.token : null;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await client.query("UPDATE tenant.crm_quotes SET share_token_hash = $3, share_token_encrypted = $4::jsonb WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.id, hash(token), JSON.stringify(await encryptSecret({ token }, env))]);
  }
  return { url: `${String(env.APP_URL ?? "").replace(/\/+$/, "")}/q/${token}` };
}

// Emails the quote with its PDF (rendered by the route from the stored quote). input: { to, cc?, subject?, message? }
export async function emailDealQuote(client, context, quoteId, input = {}, attachment = null, env = process.env) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to send quotations.");
  const row = await loadQuote(client, context, quoteId, { lock: true });
  if (row.status === "upgraded") throw new CrmError(409, "This quote became a Sales quotation: send it from there.", "CRM_QUOTE_LOCKED");
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw invalid("Enter the customer's email address.", "to");
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw invalid("Check the CC email addresses.", "cc");
  if (!attachment?.content?.length) throw new CrmError(500, "The quote PDF could not be produced.", "CRM_QUOTE_PDF_FAILED");
  const label = KINDS[row.kind].label.toLowerCase();
  const subject = text(input.subject, 300) ?? `${KINDS[row.kind].label} ${row.quote_number}`;
  const message = text(input.message, 10000)
    ?? `Please find attached our ${label} ${row.quote_number}${row.company_name ? ` for ${row.company_name}` : ""}${row.valid_on ? `, valid until ${row.valid_on}` : ""}.`;
  const result = await sendMail({
    meter: { client, organizationId: context.organizationId }, to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent) throw new CrmError(409, "Email is not set up for this workspace. Download the PDF and send it yourself, or share the WhatsApp link.", "CRM_QUOTE_EMAIL_UNAVAILABLE");
  await client.query("UPDATE tenant.crm_quotes SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, now()), updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id]);
  // The deal keeps the email (its timeline shows it, a reply threads onto the deal). Never stops the send.
  await client.query("SAVEPOINT quote_email_on_deal");
  try {
    await recordQuotationEmailOnDeal(client, context, { opportunityId: row.opportunity_id, to, cc, subject, body: message, messageId: result.messageId, quotationNumber: row.quote_number, documentLabel: KINDS[row.kind].label });
    await client.query("RELEASE SAVEPOINT quote_email_on_deal");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT quote_email_on_deal");
  }
  return { quoteId: row.id, status: "sent", messageId: result.messageId };
}

// With Sales switched on: the quote becomes a Draft Sales quotation from its deal (its product lines priced as quoted), and is marked
// upgraded. Lines typed without a product cannot go to Sales: the deal's products must be chosen first.
export async function upgradeDealQuoteToSales(client, context, quoteId, input = {}) {
  await loadApps(client, context);
  if (!dealQuoteCapabilities(context).upgrade) throw new CrmError(403, "Switch on the Sales app (and have its quotation rights) to turn this into a Sales quotation.", "CRM_QUOTE_UPGRADE_DENIED");
  const row = await loadQuote(client, context, quoteId, { lock: true });
  if (row.status === "upgraded") throw new CrmError(409, `This quote is already Sales quotation ${row.sales_quotation_number ?? ""}.`.trim(), "CRM_QUOTE_UPGRADED");
  const lines = (await client.query("SELECT * FROM tenant.crm_quote_lines WHERE organization_id = $1 AND quote_id = $2 ORDER BY line_number", [context.organizationId, row.id])).rows;
  const loose = lines.filter((line) => !line.item_id);
  if (loose.length) throw new CrmError(409, `Line ${loose[0].line_number} ("${loose[0].description}") has no product: Sales quotations need a product on every line.`, "CRM_QUOTE_LINE_ITEM_REQUIRED");
  const { createQuotationFromOpportunity } = await import("../quotations/convert.js");
  const result = await createQuotationFromOpportunity(client, context, row.opportunity_id, {
    ...input,
    validUntil: input.validUntil ?? row.valid_on ?? undefined,
    customerNotes: input.customerNotes ?? row.notes ?? undefined,
    termsAndConditions: input.termsAndConditions ?? row.terms ?? undefined,
    lines: lines.map((line) => ({ itemId: line.item_id, description: line.description, quantity: Number(line.quantity), discountPercent: Number(line.discount_percent),
      unitPrice: Number(line.unit_price), manualPriceReason: `As quoted in CRM ${row.quote_number}` })),
  });
  const salesQuotationId = result?.quotation?.id ?? result?.quotationId ?? null;
  await client.query("UPDATE tenant.crm_quotes SET status = 'upgraded', sales_quotation_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, salesQuotationId, context.userId ?? null]);
  return { ...result, quote: (await getDealQuote(client, context, row.id)).quote };
}

// ------------------------------------------------------------------ the customer's link (no sign-in)

// The quote behind a share token, with the organization context set, or null (unknown token, or CRM switched off).
export async function resolveSharedDealQuote(client, token) {
  if (!/^[0-9a-f]{48}$/.test(String(token ?? ""))) return null;
  const found = (await client.query("SELECT * FROM tenant.crm_resolve_quote_token($1)", [hash(token)])).rows[0];
  if (!found) return null;
  await setTenantContext(client, found.organization_id);
  if (!(await crmIsOn(client, found.organization_id))) return null;
  return { organizationId: found.organization_id, quoteId: found.quote_id };
}

// What the customer's page and PDF show: the quote and its lines (no internal fields).
export async function loadSharedDealQuote(client, organizationId, quoteId) {
  const row = (await client.query(`${QUOTE_SELECT} WHERE quote.organization_id = $1 AND quote.id = $2`, [organizationId, quoteId])).rows[0];
  if (!row) throw new CrmError(404, "Quote not found.", "CRM_QUOTE_NOT_FOUND");
  const lines = (await client.query("SELECT * FROM tenant.crm_quote_lines WHERE organization_id = $1 AND quote_id = $2 ORDER BY line_number", [organizationId, quoteId])).rows;
  return { quote: toQuote(row), lines: lines.map(toLine), capabilities: { create: false, edit: false, upgrade: false } };
}
