// The proforma invoice (CRM plan 4.7): what an Indian buyer asks for before raising a PO or paying an advance — the quotation's
// lines, GST and total, set out as a request for payment, clearly marked as not a tax invoice. It is printed from a confirmed, sent or
// accepted quotation (never a draft), optionally asking for an advance as a percentage of the total, and can be emailed to the
// customer. It changes nothing on the quotation: no status, no numbers taken. The send is recorded on the quotation's history and,
// when the quotation came from a deal, on the deal's timeline.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { recordQuotationEmailOnDeal } from "../../crm/email/outbound.js";
import { requireQuotationAccess, requireQuotationPermission } from "./access.js";
import { QUOTATION_PERMISSIONS, QuotationError, STATUS, dayOf, text } from "./constants.js";
import { assertQuotationVisible, databaseToday, getQuotation } from "./records.js";
import { lockQuotation, recordQuotationEvent } from "./versions.js";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const PROFORMA_STATUSES = Object.freeze([STATUS.confirmed, STATUS.sent, STATUS.accepted]);

export const proformaNumber = (quotationNumber) => `PI-${quotationNumber}`;

function advanceOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new QuotationError(400, "The advance is a percentage between 1 and 100.", "SALES_PROFORMA_ADVANCE_INVALID", { field: "advancePercent" });
  return Math.round(percent * 100) / 100;
}

// Whether this quotation may be set out as a proforma invoice; an open offer must still be valid.
function assertProformaAllowed(stored, validUntil, today) {
  if (stored === STATUS.draft || stored === STATUS.awaitingApproval)
    throw new QuotationError(409, "Confirm this quotation before sending a proforma invoice.", "SALES_PROFORMA_NOT_CONFIRMED");
  if (!PROFORMA_STATUSES.includes(stored)) throw new QuotationError(409, "A proforma invoice can be made only from a confirmed, sent or accepted quotation.", "SALES_PROFORMA_NOT_ALLOWED");
  if (stored !== STATUS.accepted && validUntil && validUntil < today)
    throw new QuotationError(409, "This quotation has expired. Create a revision with a new valid-until date first.", "SALES_PROFORMA_EXPIRED");
}

// The quotation as a proforma invoice (for the document renderer). options: { advancePercent? }
export async function getProformaInvoice(client, context, quotationId, options = {}) {
  requireQuotationAccess(context);
  const advancePercent = advanceOf(options.advancePercent);
  const detail = await getQuotation(client, context, quotationId);
  const quote = detail.quotation;
  const today = await databaseToday(client);
  assertProformaAllowed(quote.lifecycle_status, dayOf(quote.valid_until), today);
  const total = Number(quote.grand_total ?? 0);
  return {
    ...detail,
    proforma: {
      number: proformaNumber(quote.quotation_number), date: today, advancePercent,
      advanceAmount: advancePercent ? Math.round(total * advancePercent) / 100 : null,
    },
  };
}

// Emails the proforma invoice with its PDF (rendered by the caller and passed in as bytes).
// input: { to, cc?, subject?, message?, advancePercent? }
export async function emailProformaInvoice(client, context, quotationId, input = {}, attachment = null, env = process.env) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.send, "You do not have permission to send quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  await assertQuotationVisible(client, context, quote.id);
  assertProformaAllowed(quote.lifecycle_status, dayOf(quote.valid_until), await databaseToday(client));
  const advancePercent = advanceOf(input.advancePercent);
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new QuotationError(400, "Enter the customer's email address.", "SALES_QUOTATION_EMAIL_INVALID", { field: "to" });
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new QuotationError(400, "Check the CC email addresses.", "SALES_QUOTATION_EMAIL_INVALID", { field: "cc" });
  if (!attachment?.content?.length) throw new QuotationError(500, "The proforma invoice PDF could not be produced.", "SALES_QUOTATION_PDF_FAILED");
  const number = proformaNumber(quote.quotation_number);
  const subject = text(input.subject, 300) ?? `Proforma invoice ${number}`;
  const message = text(input.message, 10000)
    ?? `Please find attached our proforma invoice ${number} against quotation ${quote.quotation_number}${advancePercent ? `, with the ${advancePercent}% advance requested` : ""}. It is not a tax invoice.`;
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new QuotationError(409, "Email is not set up for this workspace. Download the proforma invoice and send it yourself.", "SALES_QUOTATION_EMAIL_UNAVAILABLE");
  await recordQuotationEvent(client, context, quote.id, "quotation.proforma_sent", quote.lifecycle_status, quote.lifecycle_status,
    { recipient: [to, ...cc].join(", "), proformaNumber: number, advancePercent });
  if (quote.source_opportunity_id) {
    await client.query("SAVEPOINT proforma_email_on_deal");
    try {
      await recordQuotationEmailOnDeal(client, context, { opportunityId: quote.source_opportunity_id, to, cc, subject, body: message, messageId: result.messageId,
        quotationNumber: quote.quotation_number, documentLabel: `Proforma invoice ${number}` });
      await client.query("RELEASE SAVEPOINT proforma_email_on_deal");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT proforma_email_on_deal");
    }
  }
  return { quotationId: quote.id, proformaNumber: number, messageId: result.messageId };
}
