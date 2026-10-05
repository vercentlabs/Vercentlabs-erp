// Getting a posted invoice to the customer. Send: its PDF (built from the
// invoice's own snapshots) is emailed from Vercentlabs to the customer's
// billing contact or whoever is chosen, and the exact PDF sent is kept; a
// retried request with the same key sends nothing again. Mark as sent: it
// went out another way. Sending never changes the invoice's status: an
// invoice is posted whether or not it was sent.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { prepareFileUpload, storeFile } from "../../../core/platform/files/index.js";
import { text } from "../orders/constants.js";
import { loadInvoice, requireInvoicePermission } from "./access.js";
import { FINANCE_POSTED, INVOICE_PERMISSIONS, InvoiceError, SENT_CHANNELS } from "./constants.js";
import { recordInvoiceEvent } from "./records.js";

export const INVOICE_FILE_ENTITY = "sales.invoice";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function postedInvoice(client, context, invoiceId) {
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (!FINANCE_POSTED.includes(invoice.status)) throw new InvoiceError(409, "Post the invoice before sending it.", "SALES_INVOICE_NOT_POSTED");
  return invoice;
}

async function replayed(client, context, key) {
  if (!key) return null;
  return (await client.query(`SELECT customer_invoice_id, recipients, message_id FROM tenant.sales_invoice_sends WHERE organization_id = $1 AND idempotency_key = $2`,
    [context.organizationId, key])).rows[0] ?? null;
}

async function recordSend(client, context, invoice, send) {
  await client.query(
    `INSERT INTO tenant.sales_invoice_sends (organization_id, customer_invoice_id, channel, recipients, subject, note, message_id, pdf_file_id, idempotency_key, sent_by, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()))`,
    [context.organizationId, invoice.id, send.channel === "email" ? "email" : "other", send.recipients, send.subject ?? null, send.note ?? null, send.messageId ?? null,
      send.pdfFileId ?? null, send.idempotencyKey ?? null, context.userId ?? null, send.sentAt ?? null]);
  await client.query(
    `UPDATE tenant.sales_invoices SET sent_at = COALESCE($3::timestamptz, now()), sent_by = $4, sent_to = $5, sent_channel = $6, updated_at = now()
      WHERE organization_id = $1 AND customer_invoice_id = $2`,
    [context.organizationId, invoice.id, send.sentAt ?? null, context.userId ?? null, send.recipients, send.channel]);
}

// input: { to, cc?, subject?, message?, idempotencyKey }   attachment: { fileName, content } (the invoice PDF)
export async function sendSalesInvoice(client, context, invoiceId, input = {}, attachment = null, env = process.env) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.send, "You do not have permission to send invoices.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new InvoiceError(400, "A request key is required to send an invoice.", "SALES_INVOICE_VALIDATION");
  const invoice = await postedInvoice(client, context, invoiceId);
  const previous = await replayed(client, context, key);
  if (previous) {
    if (previous.customer_invoice_id !== invoice.id) throw new InvoiceError(409, "That request key was used for another invoice.", "SALES_INVOICE_VALIDATION");
    return { invoiceId: invoice.id, sentTo: previous.recipients, messageId: previous.message_id, replayed: true };
  }
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new InvoiceError(400, "Enter the customer's email address.", "SALES_INVOICE_EMAIL_INVALID", { field: "to" });
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new InvoiceError(400, "Check the CC email addresses.", "SALES_INVOICE_EMAIL_INVALID", { field: "cc" });
  if (!attachment?.content?.length) throw new InvoiceError(500, "The invoice PDF could not be produced.", "SALES_INVOICE_PDF_FAILED");
  const subject = text(input.subject, 300) ?? `Invoice ${invoice.invoice_number}`;
  const customer = invoice.sales_customer_snapshot?.displayName ?? "";
  const message = text(input.message, 10000)
    ?? `Please find attached our invoice ${invoice.invoice_number}${customer ? ` for ${customer}` : ""}${invoice.customer_po_number ? ` against your PO ${invoice.customer_po_number}` : ""}, due on ${String(invoice.due_date).slice(0, 10)}.`;
  // The exact document sent is kept before it leaves, so the record never lacks it.
  const prepared = await prepareFileUpload({ fileName: attachment.fileName, mimeType: "application/pdf", bytes: attachment.content, maximumBytes: 10 * 1024 * 1024, allowedTypes: ["application/pdf"] }, env);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: INVOICE_FILE_ENTITY, entityId: invoice.id, prepared, uploadedBy: context.userId ?? null }, { env });
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new InvoiceError(409, "Email is not set up for this workspace. Download the PDF, send it yourself and mark the invoice as sent.", "SALES_INVOICE_EMAIL_UNAVAILABLE");
  const recipients = [to, ...cc].join(", ");
  await recordSend(client, context, invoice, { channel: "email", recipients, subject, messageId: result.messageId ?? null, pdfFileId: file.id, idempotencyKey: key });
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.sent", "posted", "posted", { recipient: recipients, subject });
  return { invoiceId: invoice.id, sentTo: recipients, messageId: result.messageId ?? null, replayed: false };
}

// It went out another way. input: { channel, recipient?, note?, sentAt?, idempotencyKey? }
export async function markSalesInvoiceSent(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.send, "You do not have permission to mark invoices as sent.");
  const channel = text(input.channel, 40);
  if (!SENT_CHANNELS.some((entry) => entry.code === channel)) throw new InvoiceError(400, "Choose how the invoice was sent.", "SALES_INVOICE_VALIDATION", { field: "channel" });
  const invoice = await postedInvoice(client, context, invoiceId);
  const key = text(input.idempotencyKey, 200);
  if (await replayed(client, context, key)) return { invoiceId: invoice.id, replayed: true };
  let sentAt = null;
  if (input.sentAt) {
    const when = new Date(input.sentAt);
    if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60_000 || when < new Date(String(invoice.invoice_date).slice(0, 10)))
      throw new InvoiceError(400, "The sent date must be between the invoice date and now.", "SALES_INVOICE_VALIDATION", { field: "sentAt" });
    sentAt = when.toISOString();
  }
  const recipients = text(input.recipient, 320) ?? invoice.contact_snapshot?.email ?? null;
  const note = text(input.note, 1000);
  await recordSend(client, context, invoice, { channel, recipients, note, sentAt, idempotencyKey: key });
  await recordInvoiceEvent(client, context, invoice.id, "sales_invoice.marked_sent", "posted", "posted",
    { channel: SENT_CHANNELS.find((entry) => entry.code === channel).label, recipient: recipients ?? undefined, note: note ?? undefined });
  return { invoiceId: invoice.id, replayed: false };
}
