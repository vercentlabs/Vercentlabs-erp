// Getting a posted credit note to the customer. Send: its PDF (built from the
// credit note's own snapshots) is emailed from Vercentlabs, and the exact PDF
// sent is kept; a retried request with the same key sends nothing again.
// Mark as sent: it went out another way. Sending never changes the credit
// note's status: it is posted whether or not it was sent.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { prepareFileUpload, storeFile } from "../../../core/platform/files/index.js";
import { text } from "../orders/constants.js";
import { loadCreditNote, recordCreditNoteEvent, requireCreditNotePermission } from "./access.js";
import { CREDIT_NOTE_PERMISSIONS, CreditNoteError, FINANCE_POSTED, SENT_CHANNELS } from "./constants.js";

export const CREDIT_NOTE_FILE_ENTITY = "sales.credit_note";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function postedCreditNote(client, context, creditNoteId) {
  const creditNote = await loadCreditNote(client, context, creditNoteId, { lock: true });
  if (!FINANCE_POSTED.includes(creditNote.status)) throw new CreditNoteError(409, "Post the credit note before sending it.", "SALES_CREDIT_NOTE_NOT_POSTED");
  return creditNote;
}

async function replayed(client, context, key) {
  if (!key) return null;
  return (await client.query(`SELECT customer_invoice_id, recipients, message_id FROM tenant.sales_credit_note_sends WHERE organization_id = $1 AND idempotency_key = $2`,
    [context.organizationId, key])).rows[0] ?? null;
}

async function recordSend(client, context, creditNote, send) {
  await client.query(
    `INSERT INTO tenant.sales_credit_note_sends (organization_id, customer_invoice_id, channel, recipients, subject, note, message_id, pdf_file_id, idempotency_key, sent_by, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()))`,
    [context.organizationId, creditNote.id, send.channel === "email" ? "email" : "other", send.recipients, send.subject ?? null, send.note ?? null, send.messageId ?? null,
      send.pdfFileId ?? null, send.idempotencyKey ?? null, context.userId ?? null, send.sentAt ?? null]);
  await client.query(
    `UPDATE tenant.sales_credit_notes SET sent_at = COALESCE($3::timestamptz, now()), sent_by = $4, sent_to = $5, sent_channel = $6, updated_at = now()
      WHERE organization_id = $1 AND customer_invoice_id = $2`,
    [context.organizationId, creditNote.id, send.sentAt ?? null, context.userId ?? null, send.recipients, send.channel]);
}

// input: { to, cc?, subject?, message?, idempotencyKey }   attachment: { fileName, content } (the credit note PDF)
export async function sendCreditNote(client, context, creditNoteId, input = {}, attachment = null, env = process.env) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.send, "You do not have permission to send credit notes.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new CreditNoteError(400, "A request key is required to send a credit note.", "SALES_CREDIT_NOTE_VALIDATION");
  const creditNote = await postedCreditNote(client, context, creditNoteId);
  const previous = await replayed(client, context, key);
  if (previous) {
    if (previous.customer_invoice_id !== creditNote.id) throw new CreditNoteError(409, "That request key was used for another credit note.", "SALES_CREDIT_NOTE_VALIDATION");
    return { creditNoteId: creditNote.id, sentTo: previous.recipients, messageId: previous.message_id, replayed: true };
  }
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new CreditNoteError(400, "Enter the customer's email address.", "SALES_CREDIT_NOTE_EMAIL_INVALID", { field: "to" });
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new CreditNoteError(400, "Check the CC email addresses.", "SALES_CREDIT_NOTE_EMAIL_INVALID", { field: "cc" });
  if (!attachment?.content?.length) throw new CreditNoteError(500, "The credit note PDF could not be produced.", "SALES_CREDIT_NOTE_PDF_FAILED");
  const subject = text(input.subject, 300) ?? `Credit note ${creditNote.invoice_number} against invoice ${creditNote.source_invoice_number}`;
  const customer = creditNote.sales_customer_snapshot?.displayName ?? "";
  const message = text(input.message, 10000)
    ?? `Please find attached our credit note ${creditNote.invoice_number}${customer ? ` for ${customer}` : ""} against invoice ${creditNote.source_invoice_number}.`;
  const prepared = await prepareFileUpload({ fileName: attachment.fileName, mimeType: "application/pdf", bytes: attachment.content, maximumBytes: 10 * 1024 * 1024, allowedTypes: ["application/pdf"] }, env);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: CREDIT_NOTE_FILE_ENTITY, entityId: creditNote.id, prepared, uploadedBy: context.userId ?? null }, { env });
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new CreditNoteError(409, "Email is not set up for this workspace. Download the PDF, send it yourself and mark the credit note as sent.", "SALES_CREDIT_NOTE_EMAIL_UNAVAILABLE");
  const recipients = [to, ...cc].join(", ");
  await recordSend(client, context, creditNote, { channel: "email", recipients, subject, messageId: result.messageId ?? null, pdfFileId: file.id, idempotencyKey: key });
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.sent", "posted", "posted", { recipient: recipients, subject });
  return { creditNoteId: creditNote.id, sentTo: recipients, messageId: result.messageId ?? null, replayed: false };
}

// It went out another way. input: { channel, recipient?, note?, sentAt?, idempotencyKey? }
export async function markCreditNoteSent(client, context, creditNoteId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.send, "You do not have permission to mark credit notes as sent.");
  const channel = text(input.channel, 40);
  if (!SENT_CHANNELS.some((entry) => entry.code === channel)) throw new CreditNoteError(400, "Choose how the credit note was sent.", "SALES_CREDIT_NOTE_VALIDATION", { field: "channel" });
  const creditNote = await postedCreditNote(client, context, creditNoteId);
  const key = text(input.idempotencyKey, 200);
  if (await replayed(client, context, key)) return { creditNoteId: creditNote.id, replayed: true };
  let sentAt = null;
  if (input.sentAt) {
    const when = new Date(input.sentAt);
    if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60_000 || when < new Date(String(creditNote.invoice_date).slice(0, 10)))
      throw new CreditNoteError(400, "The sent date must be between the credit note date and now.", "SALES_CREDIT_NOTE_VALIDATION", { field: "sentAt" });
    sentAt = when.toISOString();
  }
  const recipients = text(input.recipient, 320) ?? creditNote.contact_snapshot?.email ?? null;
  const note = text(input.note, 1000);
  await recordSend(client, context, creditNote, { channel, recipients, note, sentAt, idempotencyKey: key });
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.marked_sent", "posted", "posted",
    { channel: SENT_CHANNELS.find((entry) => entry.code === channel).label, recipient: recipients ?? undefined, note: note ?? undefined });
  return { creditNoteId: creditNote.id, replayed: false };
}
