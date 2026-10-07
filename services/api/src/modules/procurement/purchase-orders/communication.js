// Getting a confirmed order to the supplier, and hearing back.
//
// The PDF is built from the confirmed version's snapshot only, so it shows
// exactly what was authorised however late it is printed; internal notes are
// never in it. Send emails that PDF (kept as sent) to the supplier's ordering
// contact or whoever is chosen; a retried request with the same key sends
// nothing again. Mark as sent records an order sent another way; the
// supplier's acknowledgement can be recorded by hand. None of this changes
// the order's lifecycle status.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { prepareFileUpload, storeFile } from "../../../core/platform/files/index.js";
import { loadPurchaseOrder, requirePoAccess, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, SENT_CHANNELS, STATUS, fail, requireUuid, text } from "./constants.js";
import { recordPoEvent } from "./persist.js";

export const PO_FILE_ENTITY = "procurement.purchase_order";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// generatePurchaseOrderPdf's data: the given (or current) confirmed version, else the draft as it stands, marked as a draft.
export async function getPurchaseOrderDocument(client, context, orderId, { version = null } = {}) {
  requirePoAccess(context);
  const order = await loadPurchaseOrder(client, context, orderId);
  const confirmation = (await client.query(
    `SELECT * FROM tenant.purchase_order_confirmations WHERE organization_id = $1 AND purchase_order_id = $2 ${version ? "AND version_number = $3" : ""}
      ORDER BY version_number DESC LIMIT 1`, version ? [context.organizationId, order.id, Number(version)] : [context.organizationId, order.id])).rows[0];
  if (version && !confirmation) throw new PurchaseOrderError(404, `Version ${version} of this order was not found.`, "PURCHASE_ORDER_VERSION_NOT_FOUND");
  const useDraft = !confirmation || (order.status === STATUS.draft && !version);
  if (useDraft) {
    const lines = (await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY line_number`, [context.organizationId, order.id])).rows;
    const taxes = (await client.query(`SELECT * FROM tenant.purchase_order_line_taxes WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY sequence`, [context.organizationId, order.id])).rows;
    const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
    return { draft: true, version: order.version_number, status: order.status, snapshot: { order, lines, taxes, company: { name: company.legal_name || company.name, taxId: company.tax_id } } };
  }
  return { draft: false, version: confirmation.version_number, status: order.status, superseded: Boolean(confirmation.superseded_at), confirmedAt: confirmation.confirmed_at, snapshot: confirmation.snapshot };
}

async function confirmedOrder(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.confirmed) throw new PurchaseOrderError(409, "Confirm the order before sending it to the supplier.", "PURCHASE_ORDER_NOT_CONFIRMED");
  return order;
}

async function replayed(client, context, key) {
  if (!key) return null;
  return (await client.query(`SELECT purchase_order_id, recipients FROM tenant.purchase_order_communications WHERE organization_id = $1 AND idempotency_key = $2`,
    [context.organizationId, key])).rows[0] ?? null;
}

async function recordSent(client, context, order, sent) {
  await client.query(
    `INSERT INTO tenant.purchase_order_communications (organization_id, purchase_order_id, version_number, kind, channel, recipients, subject, note, message_id, pdf_file_id,
       idempotency_key, recorded_by, occurred_at)
     VALUES ($1, $2, $3, 'sent', $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()))`,
    [context.organizationId, order.id, order.version_number, sent.channel, sent.recipients, sent.subject ?? null, sent.note ?? null, sent.messageId ?? null, sent.pdfFileId ?? null,
      sent.idempotencyKey ?? null, context.userId ?? null, sent.sentAt ?? null]);
  await client.query(
    `UPDATE tenant.purchase_orders SET communication_status = CASE WHEN communication_status = 'acknowledged' THEN 'acknowledged' ELSE 'sent' END,
            last_sent_at = COALESCE($3::timestamptz, now()), last_sent_by = $4, last_sent_to = $5, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, sent.sentAt ?? null, context.userId ?? null, sent.recipients]);
}

// sendPurchaseOrder. input: { to?, cc?, subject?, message?, idempotencyKey }. attachment: { fileName, content } — the PDF of the current version.
// The recipient defaults to the supplier contact on the order.
export async function sendPurchaseOrder(client, context, orderId, input = {}, attachment = null, env = process.env) {
  requirePoPermission(context, PO_PERMISSIONS.send, "You do not have permission to send purchase orders.");
  const key = text(input.idempotencyKey, 200);
  if (!key) fail("A request key is required to send an order.", "idempotencyKey");
  const order = await confirmedOrder(client, context, orderId);
  const previous = await replayed(client, context, key);
  if (previous) {
    if (previous.purchase_order_id !== order.id) fail("That request key was used for another order.", "idempotencyKey", "PURCHASE_ORDER_VALIDATION", 409);
    return { id: order.id, sentTo: previous.recipients, replayed: true };
  }
  const to = text(input.to, 320) ?? order.contact_snapshot?.email ?? order.ordering_address_snapshot?.email ?? null;
  if (!to || !EMAIL.test(to)) fail("Enter the supplier's email address.", "to", "PURCHASE_ORDER_EMAIL_INVALID");
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) fail("Check the CC email addresses.", "cc", "PURCHASE_ORDER_EMAIL_INVALID");
  if (!attachment?.content?.length) throw new PurchaseOrderError(500, "The purchase order PDF could not be produced.", "PURCHASE_ORDER_PDF_FAILED");
  const version = Number(order.version_number);
  const subject = text(input.subject, 300) ?? `Purchase Order ${order.purchase_order_number}${version > 1 ? ` (revision ${version})` : ""}`;
  const message = text(input.message, 10000)
    ?? `Dear ${order.contact_snapshot?.name ?? "Sir/Madam"},\n\nPlease find attached our purchase order ${order.purchase_order_number}${version > 1 ? `, revision ${version}, which replaces the earlier version` : ""}. Kindly acknowledge it and confirm the delivery date.\n\nRegards`;
  const prepared = await prepareFileUpload({ fileName: attachment.fileName, mimeType: "application/pdf", bytes: attachment.content, maximumBytes: 10 * 1024 * 1024, allowedTypes: ["application/pdf"] }, env);
  const file = await storeFile(client, { organizationId: context.organizationId, entityType: PO_FILE_ENTITY, entityId: order.id, prepared, uploadedBy: context.userId ?? null }, { env });
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new PurchaseOrderError(409, "Email is not set up for this workspace. Download the PDF, send it yourself and mark the order as sent.", "PURCHASE_ORDER_EMAIL_UNAVAILABLE");
  const recipients = [to, ...cc].join(", ");
  await recordSent(client, context, order, { channel: "email", recipients, subject, messageId: result.messageId ?? null, pdfFileId: file.id, idempotencyKey: key });
  await recordPoEvent(client, context, order.id, "purchase_order.sent", `Version ${version} emailed to ${recipients}`, { details: { version, recipients, subject } });
  return { id: order.id, sentTo: recipients, version, replayed: false };
}

// markPurchaseOrderSent: it went out another way. input: { channel, recipient?, note?, sentAt?, idempotencyKey? }
export async function markPurchaseOrderSent(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.send, "You do not have permission to mark purchase orders as sent.");
  const channel = text(input.channel, 40);
  if (!SENT_CHANNELS.some((entry) => entry.code === channel)) fail("Choose how the order was sent.", "channel");
  const order = await confirmedOrder(client, context, orderId);
  const key = text(input.idempotencyKey, 200);
  if (await replayed(client, context, key)) return { id: order.id, replayed: true };
  let sentAt = null;
  if (input.sentAt) {
    const when = new Date(input.sentAt);
    if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60_000) fail("The sent date cannot be in the future.", "sentAt");
    sentAt = when.toISOString();
  }
  const recipients = text(input.recipient, 320) ?? order.contact_snapshot?.email ?? null;
  const note = text(input.note, 1000);
  await recordSent(client, context, order, { channel, recipients, note, sentAt, idempotencyKey: key });
  await recordPoEvent(client, context, order.id, "purchase_order.marked_sent",
    `Version ${order.version_number} sent by ${SENT_CHANNELS.find((entry) => entry.code === channel).label.toLowerCase()}${recipients ? ` to ${recipients}` : ""}`,
    { details: { channel, recipients, note } });
  return { id: order.id, replayed: false };
}

// The supplier acknowledged the order (by email, phone, their own confirmation number). input: { reference?, note?, acknowledgedAt? }
export async function acknowledgePurchaseOrder(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.send, "You do not have permission to record supplier acknowledgements.");
  const order = await confirmedOrder(client, context, orderId);
  if (order.communication_status === "not_sent") fail("Send the order (or mark it sent) before recording the acknowledgement.", "status", "PURCHASE_ORDER_NOT_SENT", 409);
  const reference = text(input.reference, 200);
  const note = text(input.note, 1000);
  await client.query(
    `INSERT INTO tenant.purchase_order_communications (organization_id, purchase_order_id, version_number, kind, channel, note, recorded_by)
     VALUES ($1, $2, $3, 'acknowledged', 'manual', $4, $5)`, [context.organizationId, order.id, order.version_number, [reference, note].filter(Boolean).join(" · ") || null, context.userId ?? null]);
  await client.query(
    `UPDATE tenant.purchase_orders SET communication_status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $3, acknowledgement_reference = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, context.userId ?? null, reference]);
  await recordPoEvent(client, context, order.id, "purchase_order.acknowledged", `Supplier acknowledged version ${order.version_number}${reference ? ` (${reference})` : ""}`,
    { details: { reference, note } });
  return { id: order.id, communicationStatus: "acknowledged" };
}

export { requireUuid };
