// Telling the customer a refund was paid. Send: the refund voucher PDF is
// emailed from Vercentlabs and the exact PDF sent is kept; a retried request
// with the same key sends nothing again. Mark as sent: it went out another
// way. Sending never changes the refund's financial status.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { prepareFileUpload, storeFile } from "../../../core/platform/files/index.js";
import { text } from "../core.js";
import { REFUND_PERMISSIONS, REFUND_SENT_CHANNELS, REFUND_STATUS, RefundError, requireRefundPermission } from "./constants.js";
import { loadRefund, recordRefundEvent } from "./records.js";

export const REFUND_FILE_ENTITY = "accounting.customer_refund";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function postedRefund(client, context, refundId) {
  const refund = await loadRefund(client, context, refundId, { lock: true });
  if (refund.status !== REFUND_STATUS.posted) throw new RefundError(409, "Post the refund before sending its confirmation.", "ACCOUNTING_REFUND_NOT_POSTED");
  return refund;
}

async function replayed(client, context, key) {
  if (!key) return null;
  return (await client.query(`SELECT refund_id, recipients, message_id FROM tenant.accounting_customer_refund_sends WHERE organization_id = $1 AND idempotency_key = $2`,
    [context.organizationId, key])).rows[0] ?? null;
}

async function recordSend(client, context, refund, send) {
  await client.query(
    `INSERT INTO tenant.accounting_customer_refund_sends (organization_id, refund_id, channel, recipients, subject, note, message_id, pdf_file_id, idempotency_key, sent_by, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()))`,
    [context.organizationId, refund.id, send.channel === "email" ? "email" : "other", send.recipients, send.subject ?? null, send.note ?? null, send.messageId ?? null,
      send.pdfFileId ?? null, send.idempotencyKey ?? null, context.userId ?? null, send.sentAt ?? null]);
  await client.query(
    `UPDATE tenant.accounting_customer_refunds SET sent_at = COALESCE($3::timestamptz, now()), sent_by = $4, sent_to = $5, sent_channel = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, refund.id, send.sentAt ?? null, context.userId ?? null, send.recipients, send.channel]);
}

// input: { to, cc?, subject?, message?, idempotencyKey }   attachment: { fileName, content } (the refund voucher PDF)
export async function sendRefundConfirmation(client, context, refundId, input = {}, attachment = null, env = process.env) {
  requireRefundPermission(context, REFUND_PERMISSIONS.send, "You do not have permission to send refund confirmations.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new RefundError(400, "A request key is required to send a refund confirmation.", "ACCOUNTING_REFUND_VALIDATION");
  const refund = await postedRefund(client, context, refundId);
  const previous = await replayed(client, context, key);
  if (previous) {
    if (previous.refund_id !== refund.id) throw new RefundError(409, "That request key was used for another refund.", "ACCOUNTING_REFUND_VALIDATION");
    return { refundId: refund.id, sentTo: previous.recipients, messageId: previous.message_id, replayed: true };
  }
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new RefundError(400, "Enter the customer's email address.", "ACCOUNTING_REFUND_EMAIL_INVALID", { field: "to" });
  const cc = text(input.cc, 1000).split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new RefundError(400, "Check the CC email addresses.", "ACCOUNTING_REFUND_EMAIL_INVALID", { field: "cc" });
  if (!attachment?.content?.length) throw new RefundError(500, "The refund voucher could not be produced.", "ACCOUNTING_REFUND_PDF_FAILED");
  const subject = text(input.subject, 300) || `Refund ${refund.refund_number}`;
  const message = text(input.message, 10000)
    || `We have refunded ${Number(refund.amount).toFixed(2)} ${refund.currency_code}${refund.external_reference ? ` (reference ${refund.external_reference})` : ""}. The refund voucher ${refund.refund_number} is attached.`;
  const prepared = await prepareFileUpload({ fileName: attachment.fileName, mimeType: "application/pdf", bytes: attachment.content, maximumBytes: 10 * 1024 * 1024, allowedTypes: ["application/pdf"] }, env);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: REFUND_FILE_ENTITY, entityId: refund.id, prepared, uploadedBy: context.userId ?? null }, { env });
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new RefundError(409, "Email is not set up for this workspace. Download the voucher, send it yourself and mark the confirmation as sent.", "ACCOUNTING_REFUND_EMAIL_UNAVAILABLE");
  const recipients = [to, ...cc].join(", ");
  await recordSend(client, context, refund, { channel: "email", recipients, subject, messageId: result.messageId ?? null, pdfFileId: file.id, idempotencyKey: key });
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.sent", REFUND_STATUS.posted, REFUND_STATUS.posted, { recipient: recipients, subject });
  return { refundId: refund.id, sentTo: recipients, messageId: result.messageId ?? null, replayed: false };
}

// It went out another way. input: { channel, recipient?, note?, idempotencyKey? }
export async function markRefundConfirmationSent(client, context, refundId, input = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.send, "You do not have permission to mark refund confirmations as sent.");
  const channel = text(input.channel, 40);
  if (!REFUND_SENT_CHANNELS.some((entry) => entry.code === channel)) throw new RefundError(400, "Choose how the confirmation was sent.", "ACCOUNTING_REFUND_VALIDATION", { field: "channel" });
  const refund = await postedRefund(client, context, refundId);
  const key = text(input.idempotencyKey, 200) || null;
  if (await replayed(client, context, key)) return { refundId: refund.id, replayed: true };
  const recipients = text(input.recipient, 320) || null;
  const note = text(input.note, 1000) || null;
  await recordSend(client, context, refund, { channel, recipients, note, idempotencyKey: key });
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.marked_sent", REFUND_STATUS.posted, REFUND_STATUS.posted,
    { channel: REFUND_SENT_CHANNELS.find((entry) => entry.code === channel).label, recipient: recipients ?? undefined, note: note ?? undefined });
  return { refundId: refund.id, replayed: false };
}
