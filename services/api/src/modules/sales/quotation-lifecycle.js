// The quotation's life after it is confirmed, beyond the customer's own
// online decision: marking it sent when it went out by another channel,
// emailing it with its PDF, recording the customer's acceptance or
// rejection on their behalf, and cancelling it. Each step is checked against
// the quotation's state, recorded on the quotation and in its event trail.
//
// Neither acceptance nor rejection nor cancellation changes the opportunity
// the quotation came from: the deal is won or lost only by its own action.
import { finalizeApprovalRequest } from "../../core/platform/approvals/index.js";
import { sendMail, escapeHtml } from "../../core/platform/mail/index.js";
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const text = (value, maximum = 4000) => {
  const result = value == null ? null : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
const OPEN_OFFER = ["approved", "sent", "viewed"];

function can(context, permission) {
  return Boolean(context.permissions?.includes(permission) || context.roleSlugs?.includes("organization_owner"));
}
function requirePermission(context, permission, message = "You do not have permission to perform this action.") {
  if (!can(context, permission)) throw new SalesError(403, message, "SALES_QUOTATION_PERMISSION_DENIED");
}

async function lockQuotation(client, context, id) {
  if (!UUID.test(String(id ?? ""))) throw new SalesError(400, "Quotation is invalid.");
  const { rows } = await client.query(
    `SELECT quote.*, version.version_number, version.contact_snapshot, version.customer_snapshot
       FROM tenant.sales_quotations quote
       LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quote.organization_id AND version.id = quote.current_version_id
      WHERE quote.organization_id = $1 AND quote.id = $2 FOR UPDATE OF quote`,
    [context.organizationId, id],
  );
  if (!rows[0]) throw new SalesError(404, "Quotation not found.");
  return rows[0];
}

async function recordEvent(client, context, quoteId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id)
     VALUES ($1, 'quotation', $2, $3, $4, $5, $6::jsonb, $7)`,
    [context.organizationId, quoteId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null],
  );
}

async function revokeLinks(client, context, quoteId) {
  const links = await client.query(
    `UPDATE tenant.sales_quote_share_links SET revoked_at = COALESCE(revoked_at, now())
      WHERE organization_id = $1 AND quotation_id = $2 AND revoked_at IS NULL RETURNING token_hash`,
    [context.organizationId, quoteId],
  );
  for (const link of links.rows)
    await client.query(`UPDATE public.sales_public_quote_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1`, [link.token_hash]);
}

const validUntilOf = (quote) => (quote.valid_until ? new Date(quote.valid_until).toISOString().slice(0, 10) : null);
async function today(client) {
  return (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
}

async function markSent(client, context, quote, { channel, recipient, note }) {
  if (quote.lifecycle_status === "draft" || quote.lifecycle_status === "pending_approval")
    throw new SalesError(409, "Confirm this quotation before sending it.", "SALES_QUOTATION_NOT_CONFIRMED");
  if (!OPEN_OFFER.includes(quote.lifecycle_status))
    throw new SalesError(409, "This quotation can no longer be sent.", "SALES_QUOTATION_NOT_SENDABLE");
  const validUntil = validUntilOf(quote);
  if (validUntil && validUntil < (await today(client)))
    throw new SalesError(409, "This quotation's validity has passed. Revise it with a new valid-until date before sending.", "SALES_QUOTATION_EXPIRED");
  await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status = CASE WHEN lifecycle_status = 'approved' THEN 'sent' ELSE lifecycle_status END,
            acceptance_status = 'pending', sent_at = now(), sent_by = $3, sent_to = $4, sent_channel = $5, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, context.userId ?? null, recipient, channel],
  );
  await recordEvent(client, context, quote.id, "quotation.sent", quote.lifecycle_status, quote.lifecycle_status === "approved" ? "sent" : quote.lifecycle_status,
    { channel, recipient, note, versionId: quote.current_version_id, versionNumber: quote.version_number });
}

// The quotation went out another way (WhatsApp, the customer's own email,
// in person). input: { recipient?, note? }
export async function markQuotationSent(client, context, quotationId, input = {}) {
  requirePermission(context, "sales.quotation.send", "You do not have permission to send quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  const contactName = [quote.contact_snapshot?.first_name, quote.contact_snapshot?.last_name].filter(Boolean).join(" ") || null;
  await markSent(client, context, quote, { channel: "manual", recipient: text(input.recipient, 320) ?? contactName, note: text(input.note, 1000) });
  return { quotationId: quote.id, status: "sent" };
}

// Emails the quotation with its PDF to the customer. The PDF is rendered by
// the caller (the shared document renderer) and passed in as bytes.
// input: { to, cc?, subject?, message? }   attachment: { fileName, content (Buffer) }
export async function emailQuotation(client, context, quotationId, input = {}, attachment = null, env = process.env) {
  requirePermission(context, "sales.quotation.send", "You do not have permission to send quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new SalesError(400, "Enter the customer's email address.", "SALES_QUOTATION_EMAIL_INVALID");
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new SalesError(400, "Check the CC email addresses.", "SALES_QUOTATION_EMAIL_INVALID");
  if (!attachment?.content?.length) throw new SalesError(500, "The quotation PDF could not be produced.", "SALES_QUOTATION_PDF_FAILED");
  // Checked before anything is sent: a refused send changes nothing.
  await markSent(client, context, quote, { channel: "email", recipient: [to, ...cc].join(", "), note: null });
  const customer = quote.customer_snapshot?.displayName ?? "";
  const subject = text(input.subject, 300) ?? `Quotation ${quote.quotation_number}${quote.version_number > 1 ? ` (revision ${quote.version_number})` : ""}`;
  const message = text(input.message, 10000) ?? `Please find attached our quotation ${quote.quotation_number}${customer ? ` for ${customer}` : ""}, valid until ${validUntilOf(quote) ?? "the date shown"}.`;
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new SalesError(409, "Email is not set up for this workspace. Send the PDF yourself and use Mark as sent.", "SALES_QUOTATION_EMAIL_UNAVAILABLE");
  return { quotationId: quote.id, status: "sent", messageId: result.messageId };
}

// The customer's answer, recorded by a member of staff.
// input: { decision: "accepted" | "rejected", reference?, notes?, customerName? }
export async function recordQuotationDecision(client, context, quotationId, input = {}) {
  const decision = input.decision;
  if (!["accepted", "rejected"].includes(decision)) throw new SalesError(400, "Choose accepted or rejected.", "SALES_QUOTATION_DECISION_INVALID");
  requirePermission(context, decision === "accepted" ? "sales.quotation.accept_on_behalf" : "sales.quotation.reject",
    decision === "accepted" ? "You do not have permission to record a customer's acceptance." : "You do not have permission to record a customer's rejection.");
  const quote = await lockQuotation(client, context, quotationId);
  if (!OPEN_OFFER.includes(quote.lifecycle_status))
    throw new SalesError(409, quote.lifecycle_status === "draft" || quote.lifecycle_status === "pending_approval"
      ? "Confirm and send this quotation before recording the customer's answer."
      : "This quotation already has an outcome.", "SALES_QUOTATION_DECISION_STATE");
  const validUntil = validUntilOf(quote);
  if (decision === "accepted" && validUntil && validUntil < (await today(client)))
    throw new SalesError(409, "This quotation has expired. Revise it with a new validity date before recording acceptance.", "SALES_QUOTATION_EXPIRED");
  const reference = text(input.reference, 200);
  const notes = text(input.notes, 4000);
  const contactName = [quote.contact_snapshot?.first_name, quote.contact_snapshot?.last_name].filter(Boolean).join(" ") || null;
  const customerName = text(input.customerName, 200) ?? contactName ?? quote.customer_snapshot?.displayName ?? "Customer";
  const existing = await client.query(`SELECT 1 FROM tenant.sales_quote_decisions WHERE organization_id = $1 AND quotation_id = $2 AND quotation_version_id = $3`,
    [context.organizationId, quote.id, quote.current_version_id]);
  if (existing.rows[0]) throw new SalesError(409, "A decision has already been recorded for this revision.", "SALES_QUOTATION_DECISION_STATE");
  await client.query(
    `INSERT INTO tenant.sales_quote_decisions (organization_id, quotation_id, quotation_version_id, decision, customer_name, note, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, quote.id, quote.current_version_id, decision, customerName, [reference && `Reference: ${reference}`, notes].filter(Boolean).join("\n") || null, context.userId ?? null],
  );
  await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status = $3, acceptance_status = $3, decision_reference = $4, decision_notes = $5,
            accepted_at = CASE WHEN $3 = 'accepted' THEN now() ELSE accepted_at END, accepted_by = CASE WHEN $3 = 'accepted' THEN $6 ELSE accepted_by END,
            rejected_at = CASE WHEN $3 = 'rejected' THEN now() ELSE rejected_at END, rejected_by = CASE WHEN $3 = 'rejected' THEN $6 ELSE rejected_by END,
            updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, decision, reference, notes, context.userId ?? null],
  );
  await revokeLinks(client, context, quote.id);
  await recordEvent(client, context, quote.id, `quotation.${decision}`, quote.lifecycle_status, decision,
    { recordedByStaff: true, customerName, reference, notes, versionId: quote.current_version_id, versionNumber: quote.version_number });
  return { quotationId: quote.id, decision };
}

// A quotation that will not go ahead. input: { reason }
export async function cancelQuotation(client, context, quotationId, input = {}) {
  requirePermission(context, "sales.quotation.cancel", "You do not have permission to cancel quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  if (quote.lifecycle_status === "cancelled") return { quotationId: quote.id, status: "cancelled", changed: false };
  if (quote.lifecycle_status === "converted" || quote.converted_order_id)
    throw new SalesError(409, "A quotation that became a sales order cannot be cancelled. Cancel the sales order instead.", "SALES_QUOTATION_CONVERTED");
  const reason = text(input.reason, 1000);
  if (!reason) throw new SalesError(400, "Give the reason for cancelling.", "SALES_QUOTATION_CANCEL_REASON_REQUIRED");
  await finalizeApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: "sales.quotation.approve", entityId: quote.id,
    decision: "cancelled", actorUserId: context.userId ?? null, note: "Quotation was cancelled.",
  });
  await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status = 'cancelled', acceptance_status = CASE WHEN acceptance_status = 'pending' THEN 'revoked' ELSE acceptance_status END,
            approval_status = CASE WHEN approval_status = 'pending' THEN 'cancelled' ELSE approval_status END,
            cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, context.userId ?? null, reason],
  );
  await revokeLinks(client, context, quote.id);
  await recordEvent(client, context, quote.id, "quotation.cancelled", quote.lifecycle_status, "cancelled", { reason });
  return { quotationId: quote.id, status: "cancelled", changed: true };
}
