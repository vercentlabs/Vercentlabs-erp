// A quotation's life: Draft → Confirmed → Sent → Accepted / Rejected, or
// Cancelled; Expired is derived from Valid Until; a sent revision supersedes
// the quotation it revises. Each step is checked against the quotation's
// state and recorded in its event trail.
//
// Confirming checks the quotation and, above the approval thresholds in
// Sales settings, routes it for approval first (Awaiting approval → approved
// = Confirmed). Neither acceptance nor rejection changes the opportunity: an
// accepted quotation makes the deal eligible to be won; the deal is won or
// lost only by its own action.
import { createApprovalRequest, finalizeApprovalRequest } from "../../../core/platform/approvals/index.js";
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { decimal } from "../money.js";
import { assertNotSelfApproval, closeApprovalRequest, resolveApprover } from "../index.js";
import { requireQuotationPermission } from "./access.js";
import { OPEN_STATUSES, QUOTATION_PERMISSIONS, QuotationError, STATUS, dayOf, text } from "./constants.js";
import { assertQuotationVisible, databaseToday } from "./records.js";
import { lockQuotation, recordQuotationEvent } from "./versions.js";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function lockVisible(client, context, quotationId) {
  const quote = await lockQuotation(client, context, quotationId);
  await assertQuotationVisible(client, context, quote.id);
  return quote;
}
function checkVersion(quote, expectedVersionNumber) {
  if (expectedVersionNumber != null && Number(expectedVersionNumber) !== Number(quote.version_number))
    throw new QuotationError(409, "Someone else changed this quotation. Reload it and try again.", "SALES_QUOTATION_VERSION_CONFLICT");
}

// The checks a quotation must pass before it is confirmed. Returns the list of problems.
async function confirmationProblems(client, context, quote, today) {
  const { rows } = await client.query(
    `SELECT version.billing_address_id, version.grand_total, version.currency_code, party.status AS party_status, party.party_type, party.sales_block,
            party.sales_block_reason,
            (SELECT count(*) FROM tenant.sales_quotation_lines line WHERE line.organization_id = version.organization_id AND line.quotation_version_id = version.id)::int AS lines,
            (SELECT count(*) FROM tenant.sales_quotation_lines line WHERE line.organization_id = version.organization_id AND line.quotation_version_id = version.id
                AND line.unit_price = 0 AND NOT line.manual_price_override)::int AS unpriced,
            (SELECT count(*) FROM tenant.sales_quotation_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
              WHERE line.organization_id = version.organization_id AND line.quotation_version_id = version.id AND (item.status <> 'active' OR NOT item.is_sellable))::int AS unsellable
       FROM tenant.sales_quotation_versions version
       JOIN tenant.business_parties party ON party.organization_id = version.organization_id AND party.id = $3
      WHERE version.organization_id = $1 AND version.id = $2`,
    [context.organizationId, quote.current_version_id, quote.party_id]);
  const facts = rows[0];
  const problems = [];
  if (!facts) return ["The quotation has no content."];
  if (facts.party_status !== "active" || !["customer", "both"].includes(facts.party_type)) problems.push("The customer is not an active customer.");
  if (facts.sales_block === "all") problems.push(`The customer is blocked for new quotations: ${facts.sales_block_reason}`);
  if (!facts.lines) problems.push("Add at least one line.");
  if (facts.unpriced) problems.push(`${facts.unpriced} line(s) have no price. Enter a price or choose another price list.`);
  if (facts.unsellable) problems.push(`${facts.unsellable} line(s) are for products that are no longer sold.`);
  if (!facts.billing_address_id) problems.push("Choose the billing address.");
  if (!facts.currency_code) problems.push("Choose the currency.");
  const validUntil = dayOf(quote.valid_until);
  if (!validUntil) problems.push("Choose the date the quotation is valid until.");
  else if (validUntil < today) problems.push("Valid until is in the past. Choose a later date.");
  else if (validUntil < dayOf(quote.quotation_date)) problems.push("Valid until is before the quotation date.");
  return problems;
}

// Draft → Confirmed (or Awaiting approval above the thresholds).
// input: { expectedVersionNumber?, assignedTo? }
export async function confirmQuotation(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.confirm, "You do not have permission to confirm quotations.");
  const quote = await lockVisible(client, context, quotationId);
  if (quote.lifecycle_status === STATUS.confirmed) return { quotationId: quote.id, status: "confirmed", approvalRequired: false, changed: false };
  if (quote.lifecycle_status !== STATUS.draft) throw new QuotationError(409, "Only a draft can be confirmed.", "SALES_QUOTATION_NOT_DRAFT");
  checkVersion(quote, input.expectedVersionNumber);
  const today = await databaseToday(client);
  const problems = await confirmationProblems(client, context, quote, today);
  if (problems.length) throw new QuotationError(422, problems[0], "SALES_QUOTATION_NOT_READY", { problems });
  const settings = (await client.query(`SELECT quotation_approval_amount, quotation_approval_discount, minimum_margin_percent FROM tenant.sales_settings WHERE organization_id = $1`,
    [context.organizationId])).rows[0] ?? {};
  const reasons = [];
  if (decimal(settings.quotation_approval_amount || 0) > 0n && decimal(quote.grand_total) >= decimal(settings.quotation_approval_amount)) reasons.push("amount");
  // A threshold left at zero is not applied.
  if (decimal(quote.maximum_discount_percent || 0) > decimal(settings.quotation_approval_discount || 100)) reasons.push("discount");
  if (decimal(quote.margin_percent || 0) < decimal(settings.minimum_margin_percent || -100)) reasons.push("margin");
  if (!reasons.length) {
    await client.query(
      `UPDATE tenant.sales_quotations SET lifecycle_status = $3, approval_status = 'not_required', confirmed_at = now(), confirmed_by = $4, updated_by = $4, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, quote.id, STATUS.confirmed, context.userId ?? null]);
    await recordQuotationEvent(client, context, quote.id, "quotation.confirmed", STATUS.draft, STATUS.confirmed, { versionId: quote.current_version_id, versionNumber: quote.version_number });
    return { quotationId: quote.id, status: "confirmed", approvalRequired: false, changed: true };
  }
  const route = await resolveApprover(client, context, input.assignedTo || null);
  const approval = await createApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: "sales.quotation.approve", entityId: quote.id, title: `Approve quotation ${quote.quotation_number}`,
    requestedBy: context.userId, assignedTo: route.assignee, payload: { quotationId: quote.id, quotationVersionId: quote.current_version_id },
  });
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status = $3, approval_status = 'pending', updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, STATUS.awaitingApproval, context.userId ?? null]);
  await recordQuotationEvent(client, context, quote.id, "quotation.submitted", STATUS.draft, STATUS.awaitingApproval,
    { approvalId: approval.id, reasons, versionId: quote.current_version_id, assignedTo: route.assignee, delegatedFrom: route.delegatedFrom });
  return { quotationId: quote.id, status: "awaiting_approval", approvalRequired: true, approvalId: approval.id, reasons, changed: true };
}

// Called from the quotation page and from the approvals inbox.
export async function approveQuotation(client, context, quotationId, quotationVersionId = null) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.approve, "You do not have permission to approve quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  if (quote.lifecycle_status !== STATUS.awaitingApproval) throw new QuotationError(409, "The quotation is not awaiting approval.", "SALES_QUOTATION_NOT_PENDING");
  if (quotationVersionId && quote.current_version_id !== quotationVersionId)
    throw new QuotationError(409, "The quotation was changed after this approval was requested.", "SALES_QUOTATION_VERSION_CONFLICT");
  await assertNotSelfApproval(client, context, "sales_quotation", quote.id);
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status = $3, approval_status = 'approved', confirmed_at = now(), confirmed_by = $4, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, STATUS.confirmed, context.userId ?? null]);
  await closeApprovalRequest(client, context, "sales_quotation", quote.id, "approved");
  await recordQuotationEvent(client, context, quote.id, "quotation.approved", STATUS.awaitingApproval, STATUS.confirmed, { versionId: quote.current_version_id });
  return { quotationId: quote.id, quotationVersionId: quote.current_version_id, status: "confirmed" };
}

// The approver sends it back to Draft.
export async function rejectQuotationApproval(client, context, quotationId, note = null) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.approve, "You do not have permission to approve quotations.");
  const reason = text(note, 2000);
  const quote = await lockQuotation(client, context, quotationId);
  if (quote.lifecycle_status !== STATUS.awaitingApproval) throw new QuotationError(409, "The quotation is not awaiting approval.", "SALES_QUOTATION_NOT_PENDING");
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status = $3, approval_status = 'rejected', updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, STATUS.draft, context.userId ?? null]);
  await closeApprovalRequest(client, context, "sales_quotation", quote.id, "rejected", reason);
  await recordQuotationEvent(client, context, quote.id, "quotation.approval_rejected", STATUS.awaitingApproval, STATUS.draft, { reason });
  return { quotationId: quote.id, status: "draft" };
}

// When a revision first goes to the customer, the quotation it revises is
// superseded and the opportunity's primary quotation moves to the revision.
async function supersedePrevious(client, context, quote) {
  if (!quote.revision_of_quotation_id || quote.sent_at) return;
  const previous = (await client.query(`SELECT id, quotation_number, lifecycle_status FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, quote.revision_of_quotation_id])).rows[0];
  if (!previous) return;
  if ([STATUS.draft, STATUS.awaitingApproval, ...OPEN_STATUSES].includes(previous.lifecycle_status)) {
    await client.query(
      `UPDATE tenant.sales_quotations
          SET lifecycle_status = $3, acceptance_status = CASE WHEN acceptance_status = 'pending' THEN 'revoked' ELSE acceptance_status END,
              superseded_at = now(), superseded_by_quotation_id = $4, updated_by = $5, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, previous.id, STATUS.superseded, quote.id, context.userId ?? null]);
    await finalizeApprovalRequest(client, {
      organizationId: context.organizationId, commandKey: "sales.quotation.approve", entityId: previous.id, decision: "cancelled", actorUserId: context.userId ?? null,
      note: `Superseded by ${quote.quotation_number}.`,
    });
    await recordQuotationEvent(client, context, previous.id, "quotation.superseded", previous.lifecycle_status, STATUS.superseded,
      { supersededBy: quote.id, supersededByNumber: quote.quotation_number });
  }
  if (quote.source_opportunity_id)
    await client.query(
      `UPDATE tenant.crm_opportunities SET primary_quotation_id = $4, updated_by = $5 WHERE organization_id = $1 AND id = $2 AND primary_quotation_id = $3`,
      [context.organizationId, quote.source_opportunity_id, previous.id, quote.id, context.userId ?? null]);
}

async function markSent(client, context, quote, { channel, recipient, note }) {
  if (quote.lifecycle_status === STATUS.draft || quote.lifecycle_status === STATUS.awaitingApproval)
    throw new QuotationError(409, "Confirm this quotation before sending it.", "SALES_QUOTATION_NOT_CONFIRMED");
  if (!OPEN_STATUSES.includes(quote.lifecycle_status)) throw new QuotationError(409, "This quotation can no longer be sent.", "SALES_QUOTATION_NOT_SENDABLE");
  const validUntil = dayOf(quote.valid_until);
  if (validUntil && validUntil < (await databaseToday(client)))
    throw new QuotationError(409, "This quotation has expired. Create a revision with a new valid-until date to send it again.", "SALES_QUOTATION_EXPIRED");
  await supersedePrevious(client, context, quote);
  await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status = $6, acceptance_status = 'pending', sent_at = now(), sent_by = $3, sent_to = $4, sent_channel = $5, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, context.userId ?? null, recipient, channel, STATUS.sent]);
  await recordQuotationEvent(client, context, quote.id, quote.lifecycle_status === STATUS.sent ? "quotation.resent" : "quotation.sent", quote.lifecycle_status, STATUS.sent,
    { channel, recipient, note, versionId: quote.current_version_id, versionNumber: quote.version_number });
}

const contactName = (quote) => [quote.contact_snapshot?.first_name, quote.contact_snapshot?.last_name].filter(Boolean).join(" ") || null;

// The quotation went out another way (in person, WhatsApp, the customer's own email).
// input: { recipient?, note? }
export async function markQuotationSent(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.send, "You do not have permission to send quotations.");
  const quote = await lockVisible(client, context, quotationId);
  await markSent(client, context, quote, { channel: "manual", recipient: text(input.recipient, 320) ?? contactName(quote), note: text(input.note, 1000) });
  return { quotationId: quote.id, status: "sent" };
}

// Emails the quotation with its PDF (rendered by the caller from the stored
// quotation and passed in as bytes). input: { to, cc?, subject?, message? }
export async function emailQuotation(client, context, quotationId, input = {}, attachment = null, env = process.env) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.send, "You do not have permission to send quotations.");
  const quote = await lockVisible(client, context, quotationId);
  const to = text(input.to, 320);
  if (!to || !EMAIL.test(to)) throw new QuotationError(400, "Enter the customer's email address.", "SALES_QUOTATION_EMAIL_INVALID", { field: "to" });
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new QuotationError(400, "Check the CC email addresses.", "SALES_QUOTATION_EMAIL_INVALID", { field: "cc" });
  if (!attachment?.content?.length) throw new QuotationError(500, "The quotation PDF could not be produced.", "SALES_QUOTATION_PDF_FAILED");
  // Checked before anything is sent: a refused send changes nothing.
  await markSent(client, context, quote, { channel: "email", recipient: [to, ...cc].join(", "), note: null });
  const customer = quote.customer_snapshot?.displayName ?? "";
  const subject = text(input.subject, 300) ?? `Quotation ${quote.quotation_number}`;
  const message = text(input.message, 10000)
    ?? `Please find attached our quotation ${quote.quotation_number}${customer ? ` for ${customer}` : ""}, valid until ${dayOf(quote.valid_until) ?? "the date shown"}.`;
  const result = await sendMail({
    to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: [{ filename: attachment.fileName, content: attachment.content, contentType: "application/pdf" }],
  }, env);
  if (!result.sent)
    throw new QuotationError(409, "Email is not set up for this workspace. Download the PDF, send it yourself and use Mark as sent.", "SALES_QUOTATION_EMAIL_UNAVAILABLE");
  return { quotationId: quote.id, status: "sent", messageId: result.messageId };
}

// The customer's answer, recorded by a member of staff.
// input: { decision: "accepted" | "rejected", reference?, notes?, customerName? }
export async function recordQuotationDecision(client, context, quotationId, input = {}) {
  const decision = input.decision;
  if (![STATUS.accepted, STATUS.rejected].includes(decision)) throw new QuotationError(400, "Choose accepted or rejected.", "SALES_QUOTATION_DECISION_INVALID");
  requireQuotationPermission(context, decision === STATUS.accepted ? QUOTATION_PERMISSIONS.accept : QUOTATION_PERMISSIONS.reject,
    decision === STATUS.accepted ? "You do not have permission to record a customer's acceptance." : "You do not have permission to record a customer's rejection.");
  const quote = await lockVisible(client, context, quotationId);
  if (quote.lifecycle_status === decision) return { quotationId: quote.id, decision, changed: false };
  if (!OPEN_STATUSES.includes(quote.lifecycle_status))
    throw new QuotationError(409, quote.lifecycle_status === STATUS.draft || quote.lifecycle_status === STATUS.awaitingApproval
      ? "Confirm this quotation before recording the customer's answer."
      : "This quotation already has an outcome.", "SALES_QUOTATION_DECISION_STATE");
  const validUntil = dayOf(quote.valid_until);
  if (decision === STATUS.accepted && validUntil && validUntil < (await databaseToday(client)))
    throw new QuotationError(409, "This quotation has expired. Create a revision with a new validity date before recording acceptance.", "SALES_QUOTATION_EXPIRED");
  const reference = text(input.reference, 200);
  const notes = text(input.notes ?? input.reason, 4000);
  if (decision === STATUS.rejected && !notes)
    throw new QuotationError(400, "Give the reason the customer rejected the quotation.", "SALES_QUOTATION_REJECT_REASON_REQUIRED", { field: "notes" });
  const customerName = text(input.customerName, 200) ?? contactName(quote) ?? quote.customer_snapshot?.displayName ?? "Customer";
  await client.query(
    `INSERT INTO tenant.sales_quote_decisions (organization_id, quotation_id, quotation_version_id, decision, customer_name, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, quote.id, quote.current_version_id, decision, customerName, [reference && `Reference: ${reference}`, notes].filter(Boolean).join("\n") || null, context.userId ?? null]);
  await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status = $3, acceptance_status = $3, decision_reference = $4, decision_notes = $5,
            accepted_at = CASE WHEN $3 = 'accepted' THEN now() ELSE accepted_at END, accepted_by = CASE WHEN $3 = 'accepted' THEN $6 ELSE accepted_by END,
            rejected_at = CASE WHEN $3 = 'rejected' THEN now() ELSE rejected_at END, rejected_by = CASE WHEN $3 = 'rejected' THEN $6 ELSE rejected_by END,
            updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, decision, reference, notes, context.userId ?? null]);
  await recordQuotationEvent(client, context, quote.id, `quotation.${decision}`, quote.lifecycle_status, decision,
    { recordedByStaff: true, customerName, reference, notes, versionId: quote.current_version_id, versionNumber: quote.version_number });
  return { quotationId: quote.id, decision, changed: true };
}

// A quotation that will not go ahead. input: { reason }
export async function cancelQuotation(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.cancel, "You do not have permission to cancel quotations.");
  const quote = await lockVisible(client, context, quotationId);
  if (quote.lifecycle_status === STATUS.cancelled) return { quotationId: quote.id, status: "cancelled", changed: false };
  if (quote.converted_order_id)
    throw new QuotationError(409, "A quotation that became a sales order cannot be cancelled. Cancel the sales order instead.", "SALES_QUOTATION_CONVERTED");
  if (![STATUS.draft, STATUS.awaitingApproval, ...OPEN_STATUSES].includes(quote.lifecycle_status))
    throw new QuotationError(409, "This quotation already has an outcome and cannot be cancelled.", "SALES_QUOTATION_NOT_CANCELLABLE");
  const reason = text(input.reason, 1000);
  if (!reason) throw new QuotationError(400, "Give the reason for cancelling.", "SALES_QUOTATION_CANCEL_REASON_REQUIRED", { field: "reason" });
  await finalizeApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: "sales.quotation.approve", entityId: quote.id, decision: "cancelled", actorUserId: context.userId ?? null,
    note: "Quotation was cancelled.",
  });
  await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status = $5, acceptance_status = CASE WHEN acceptance_status = 'pending' THEN 'revoked' ELSE acceptance_status END,
            approval_status = CASE WHEN approval_status = 'pending' THEN 'cancelled' ELSE approval_status END,
            cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, context.userId ?? null, reason, STATUS.cancelled]);
  await recordQuotationEvent(client, context, quote.id, "quotation.cancelled", quote.lifecycle_status, STATUS.cancelled, { reason });
  return { quotationId: quote.id, status: "cancelled", changed: true };
}
