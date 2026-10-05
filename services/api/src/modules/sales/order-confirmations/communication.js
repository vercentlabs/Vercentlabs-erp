// Getting the confirmation to the customer, and the customer's answer.
//
// Send: the current confirmation's PDF (built from its snapshot) is emailed
// from Vercentlabs to the order contact or whoever is chosen, and the exact
// PDF sent is kept. A retried request with the same key sends nothing again.
// Mark as sent: it went out another way (another mailbox, WhatsApp, on
// paper). Acknowledgement: the customer confirmed receipt; useful, never
// required for fulfillment. None of this changes the order's status.
//
// Only the current confirmation is sent. A superseded one is history: it
// can be viewed and printed (marked Superseded), never sent as current.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { prepareFileUpload, storeFile } from "../../../core/platform/files/index.js";
import { assertOrderVisible, requireOrderAccess, requireOrderPermission } from "../orders/access.js";
import { OrderError, STATUS, requireUuid, text } from "../orders/constants.js";
import { lockOrder, recordOrderEvent } from "../orders/versions.js";
import { CHANNEL_LABELS, CONFIRMATION_PERMISSIONS, SENT_CHANNELS } from "./constants.js";
import { currentConfirmation } from "./snapshot.js";

export const CONFIRMATION_FILE_ENTITY = "sales.order_confirmation";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// The order (locked) and its current confirmation, for a step on a confirmed order.
async function confirmedOrder(client, context, orderId) {
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (![STATUS.confirmed, STATUS.closed].includes(order.lifecycle_status))
    throw new OrderError(409, order.lifecycle_status === STATUS.draft ? "Confirm the order first: a draft has no current confirmation." : "A cancelled order's confirmation is history and is not sent again.",
      "SALES_ORDER_NOT_CONFIRMED");
  const confirmation = await currentConfirmation(client, context.organizationId, order.id, { lock: true });
  if (!confirmation) throw new OrderError(409, "This order has no current confirmation.", "SALES_ORDER_CONFIRMATION_MISSING");
  return { order, confirmation };
}

async function recordSend(client, context, order, confirmation, send) {
  await client.query(
    `INSERT INTO tenant.sales_order_confirmation_sends (organization_id, confirmation_id, sales_order_id, channel, recipients, subject, note, message_id, pdf_file_id, idempotency_key, sent_by, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()))`,
    [context.organizationId, confirmation.id, order.id, send.channel, send.recipients, send.subject ?? null, send.note ?? null, send.messageId ?? null, send.pdfFileId ?? null,
      send.idempotencyKey ?? null, context.userId ?? null, send.sentAt ?? null]);
  await client.query(
    `UPDATE tenant.sales_order_confirmations SET sent_at = COALESCE($3::timestamptz, now()), sent_by = $4, sent_to = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, confirmation.id, send.sentAt ?? null, context.userId ?? null, send.recipients]);
}

async function replayed(client, context, key) {
  if (!key) return null;
  return (await client.query(
    `SELECT send.sales_order_id, send.recipients, send.message_id, confirmation.id AS confirmation_id, confirmation.version
       FROM tenant.sales_order_confirmation_sends send JOIN tenant.sales_order_confirmations confirmation ON confirmation.id = send.confirmation_id
      WHERE send.organization_id = $1 AND send.idempotency_key = $2`, [context.organizationId, key])).rows[0] ?? null;
}

// input: { to, cc?, subject?, message?, idempotencyKey }   attachment: { fileName, content } (the current confirmation's PDF)
export async function sendOrderConfirmation(client, context, orderId, input = {}, attachment = null, env = process.env) {
  requireOrderPermission(context, CONFIRMATION_PERMISSIONS.send, "You do not have permission to send order confirmations.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new OrderError(400, "A request key is required to send a confirmation.", "SALES_ORDER_VALIDATION");
  const { order, confirmation } = await confirmedOrder(client, context, orderId);
  const previous = await replayed(client, context, key);
  if (previous) {
    if (previous.sales_order_id !== order.id) throw new OrderError(409, "That request key was used for another order.", "SALES_ORDER_VALIDATION");
    return { orderId: order.id, confirmationId: previous.confirmation_id, version: previous.version, sentTo: previous.recipients, messageId: previous.message_id, replayed: true };
  }
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new OrderError(400, "Enter the customer's email address.", "SALES_ORDER_EMAIL_INVALID", { field: "to" });
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new OrderError(400, "Check the CC email addresses.", "SALES_ORDER_EMAIL_INVALID", { field: "cc" });
  if (!attachment?.content?.length) throw new OrderError(500, "The confirmation PDF could not be produced.", "SALES_ORDER_PDF_FAILED");
  const revision = confirmation.version > 1 ? ` (revision ${confirmation.version})` : "";
  const subject = text(input.subject, 300) ?? `Order Confirmation ${order.sales_order_number}${revision}`;
  const customer = order.customer_snapshot?.displayName ?? "";
  const message = text(input.message, 10000)
    ?? `Thank you for your order. Please find attached our order confirmation ${order.sales_order_number}${revision}${customer ? ` for ${customer}` : ""}${order.customer_po_number ? ` against your PO ${order.customer_po_number}` : ""}.`;
  // The exact document sent is kept before it leaves, so the record never lacks it.
  const prepared = await prepareFileUpload({ fileName: attachment.fileName, mimeType: "application/pdf", bytes: attachment.content, maximumBytes: 10 * 1024 * 1024, allowedTypes: ["application/pdf"] }, env);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: CONFIRMATION_FILE_ENTITY, entityId: confirmation.id, prepared, uploadedBy: context.userId ?? null }, { env });
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new OrderError(409, "Email is not set up for this workspace. Download the PDF, send it yourself and mark the confirmation as sent.", "SALES_ORDER_EMAIL_UNAVAILABLE");
  const recipients = [to, ...cc].join(", ");
  await recordSend(client, context, order, confirmation, { channel: "email", recipients, subject, messageId: result.messageId ?? null, pdfFileId: file.id, idempotencyKey: key });
  await recordOrderEvent(client, context, order.id, "sales_order.confirmation_sent", order.lifecycle_status, order.lifecycle_status,
    { confirmationId: confirmation.id, version: confirmation.version, recipient: recipients, subject });
  return { orderId: order.id, confirmationId: confirmation.id, version: confirmation.version, sentTo: recipients, messageId: result.messageId ?? null, replayed: false };
}

// It went out another way. input: { channel, recipient?, note?, sentAt?, idempotencyKey? }
export async function markOrderConfirmationSent(client, context, orderId, input = {}) {
  requireOrderPermission(context, CONFIRMATION_PERMISSIONS.markSent, "You do not have permission to mark order confirmations as sent.");
  const channel = text(input.channel, 40);
  if (!SENT_CHANNELS.some((entry) => entry.code === channel)) throw new OrderError(400, "Choose how the confirmation was sent.", "SALES_ORDER_VALIDATION", { field: "channel" });
  const { order, confirmation } = await confirmedOrder(client, context, orderId);
  const key = text(input.idempotencyKey, 200);
  const previous = await replayed(client, context, key);
  if (previous) return { orderId: order.id, confirmationId: previous.confirmation_id, version: previous.version, replayed: true };
  let sentAt = null;
  if (input.sentAt) {
    const when = new Date(input.sentAt);
    if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60_000 || when < new Date(confirmation.confirmed_at))
      throw new OrderError(400, "The sent date must be between the confirmation and now.", "SALES_ORDER_VALIDATION", { field: "sentAt" });
    sentAt = when.toISOString();
  }
  const recipients = text(input.recipient, 320) ?? order.contact_snapshot?.email ?? null;
  const note = text(input.note, 1000);
  await recordSend(client, context, order, confirmation, { channel, recipients, note, sentAt, idempotencyKey: key });
  await recordOrderEvent(client, context, order.id, "sales_order.confirmation_marked_sent", order.lifecycle_status, order.lifecycle_status,
    { confirmationId: confirmation.id, version: confirmation.version, channel: CHANNEL_LABELS[channel], recipient: recipients ?? undefined, note: note ?? undefined });
  return { orderId: order.id, confirmationId: confirmation.id, version: confirmation.version, replayed: false };
}

// The customer acknowledged the confirmation. input: { acknowledgedAt?, reference?, note? }
export async function recordCustomerAcknowledgement(client, context, orderId, input = {}) {
  requireOrderPermission(context, CONFIRMATION_PERMISSIONS.acknowledge, "You do not have permission to record customer acknowledgements.");
  const { order, confirmation } = await confirmedOrder(client, context, orderId);
  if (confirmation.acknowledged_at) return { orderId: order.id, confirmationId: confirmation.id, acknowledgedAt: confirmation.acknowledged_at, changed: false };
  const reference = text(input.reference, 300);
  const note = text(input.note, 1000);
  if (!reference && !note) throw new OrderError(400, "Say how the customer acknowledged it, for example \"Email confirmation received\".", "SALES_ORDER_VALIDATION", { field: "reference" });
  const when = input.acknowledgedAt ? new Date(input.acknowledgedAt) : new Date();
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60_000 || when < new Date(new Date(confirmation.confirmed_at).toDateString()))
    throw new OrderError(400, "The acknowledgement date must be between the confirmation and now.", "SALES_ORDER_VALIDATION", { field: "acknowledgedAt" });
  await client.query(
    `UPDATE tenant.sales_order_confirmations SET acknowledged_at = $3, acknowledged_by = $4, acknowledgement_reference = $5, acknowledgement_note = $6 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, confirmation.id, when, context.userId ?? null, reference, note]);
  await recordOrderEvent(client, context, order.id, "sales_order.confirmation_acknowledged", order.lifecycle_status, order.lifecycle_status,
    { confirmationId: confirmation.id, version: confirmation.version, reference: reference ?? undefined, note: note ?? undefined });
  return { orderId: order.id, confirmationId: confirmation.id, acknowledgedAt: when, changed: true };
}

// One confirmation with its snapshot, through the order's own access rules.
// Either { confirmationId } or { orderId } (the order's current confirmation; null for a draft).
export async function getOrderConfirmation(client, context, { confirmationId = null, orderId = null } = {}) {
  requireOrderAccess(context);
  const { rows } = await client.query(
    `SELECT confirmation.id, confirmation.sales_order_id, confirmation.version, confirmation.order_number, confirmation.snapshot, confirmation.confirmed_at, confirmation.sent_at,
            confirmation.acknowledged_at, confirmation.superseded_at, sales_order.lifecycle_status AS order_status
       FROM tenant.sales_order_confirmations confirmation
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = confirmation.organization_id AND sales_order.id = confirmation.sales_order_id
      WHERE confirmation.organization_id = $1 AND ${confirmationId ? "confirmation.id = $2" : "confirmation.sales_order_id = $2 AND confirmation.superseded_at IS NULL"}`,
    [context.organizationId, requireUuid(confirmationId ?? orderId, confirmationId ? "Confirmation" : "Sales order")]);
  const confirmation = rows[0];
  if (!confirmation) {
    if (orderId) { await assertOrderVisible(client, context, orderId); return null; }
    throw new OrderError(404, "Order confirmation not found.", "SALES_ORDER_CONFIRMATION_NOT_FOUND");
  }
  // Access to a confirmation is access to its order: never a way around it.
  await assertOrderVisible(client, context, confirmation.sales_order_id);
  return confirmation;
}
