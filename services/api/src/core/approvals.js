// Global cross-module approval inbox (Prompt 2B Phase 9).
//
// Overlap audit result (see docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv):
// packages/workflows already provides the generic decision/SoD primitives
// (assertApprovalDecision, assertSeparationOfDuties) and several modules
// (accounting, sales) already create rows in public.approval_requests and
// implement their OWN approve/reject side effects on the real document
// (services/api/src/modules/accounting/subledger-approvals.js,
// journals.js; services/api/src/modules/sales/index.js). The recovered
// generic workflow-run engine (executeWorkflowRun, still parked) is a
// DIFFERENT, DB-trigger-driven concern (workflow_definitions/workflow_runs)
// and is not required to build this inbox — it remains parked pending its
// own audit.
//
// What did NOT exist before this file: a cross-module LIST of pending
// approvals, and — a real, disclosed pre-existing gap this file also
// fixes — nothing ever flipped public.approval_requests.status when a
// module's own approve/reject function ran (only one cancellation path
// did, in sales/index.js). Deciding through this module now closes that
// loop; a decision made directly through a module's own existing screen
// (bypassing this inbox) still won't update approval_requests — that
// remains a known limitation, disclosed rather than silently patched
// everywhere it would require touching modules out of this pass's scope.
import { assertApprovalDecision, assertSeparationOfDuties, WorkflowConflictError } from "@vercentlabs/workflows";

import { hasSessionPermission } from "./access-control-runtime.js";

import {
  approveVendorBill, rejectVendorBillApproval,
  approveVendorPayment, rejectVendorPaymentApproval,
  approveCustomerInvoice, rejectCustomerInvoiceApproval,
} from "../modules/accounting/subledger-approvals.js";
import { approveJournalEntry, rejectJournalApproval } from "../modules/accounting/journals.js";
import {
  approveQuotation, rejectQuotationApproval,
  approveSalesOrder, rejectSalesOrderApproval,
  approveSalesOrderAmendment, rejectSalesOrderAmendment,
} from "../modules/sales/index.js";
import {
  approvePosCartDiscountApproval, rejectPosCartDiscountApproval,
  approvePosPaymentOverride, rejectPosPaymentOverrideApproval,
} from "../modules/point-of-sale/index.js";

export class ApprovalError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
    this.code = code;
  }
}

function moduleContext(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.includes("organization_owner") || session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

// Each entry adapts one verified command_key to the underlying module
// function's own (differing) signature and command_payload shape. Only
// command keys whose handler implementation has actually been read and
// verified are registered here — an unregistered command_key is listed
// (visible in the inbox) but its Decide action fails closed with a clear
// "not supported from the global inbox yet" error rather than guessing.
const COMMAND_DISPATCH = Object.freeze({
  "accounting.vendor_bill.approve": {
    approve: (client, context, payload) => approveVendorBill(client, context, payload.documentId, payload.contentHash),
    reject: (client, context, payload) => rejectVendorBillApproval(client, context, payload.documentId),
  },
  "accounting.vendor_payment.approve": {
    approve: (client, context, payload) => approveVendorPayment(client, context, payload.documentId, payload.contentHash),
    reject: (client, context, payload) => rejectVendorPaymentApproval(client, context, payload.documentId),
  },
  "accounting.customer_invoice.approve": {
    approve: (client, context, payload) => approveCustomerInvoice(client, context, payload.documentId, payload.contentHash),
    reject: (client, context, payload) => rejectCustomerInvoiceApproval(client, context, payload.documentId),
  },
  "accounting.journal.approve": {
    approve: (client, context, payload) => approveJournalEntry(client, context, payload.journalEntryId, payload.contentHash),
    reject: (client, context, payload) => rejectJournalApproval(client, context, payload.journalEntryId),
  },
  "sales.quotation.approve": {
    approve: (client, context, payload) => approveQuotation(client, context, payload.quotationId, payload.quotationVersionId),
    reject: (client, context, payload) => rejectQuotationApproval(client, context, payload.quotationId, payload.note),
  },
  "sales.order.approve": {
    approve: (client, context, payload) => approveSalesOrder(client, context, payload.orderId, payload.orderVersionId),
    reject: (client, context, payload) => rejectSalesOrderApproval(client, context, payload.orderId, payload.note),
  },
  "sales.order.amendment.approve": {
    approve: (client, context, payload) =>
      approveSalesOrderAmendment(client, context, payload.orderId, payload.orderVersionId, payload.previousVersionId, payload.resumeStatus),
    reject: (client, context, payload) =>
      rejectSalesOrderAmendment(client, context, payload.orderId, payload.orderVersionId, payload.previousVersionId, payload.resumeStatus),
  },
  "pos.discount.approve": {
    approve: (client, context, payload) => approvePosCartDiscountApproval(client, context, payload),
    reject: (client, context, payload) => rejectPosCartDiscountApproval(client, context, payload),
  },
  "pos.payment.override.approve": {
    approve: (client, context, payload) => approvePosPaymentOverride(client, context, payload),
    reject: (client, context, payload) => rejectPosPaymentOverrideApproval(client, context, payload),
  },
});

// Checkpoint audit (ERP completion gap register, SEC-APPROVAL-002): this
// used to take a bare organizationId and return every pending approval
// org-wide to any authenticated member with no further check — GET
// /api/approvals only calls requireWorkspace() (auth + org membership),
// nothing role- or assignment-specific. A junior rep with no approval
// authority could see every in-flight approval across the whole
// organization (amounts, requester, entity), including ones from modules
// they have no access to at all. Now takes the full session and, unless
// the caller holds org-wide approvals.manage, scopes results to requests
// they requested or are the assigned approver for — the same visibility
// a person needs to act on their own inbox, no more.
export async function listApprovals(client, session, { status = "pending", limit = 100 } = {}) {
  const bounded = Math.min(250, Math.max(1, Number(limit) || 100));
  const canManage = hasSessionPermission(session, "approvals.manage");
  const result = await client.query(
    `SELECT id, entity_type, entity_id, title, status, requested_by, assigned_to,
            requested_at, decided_at, decided_by, decision_note, command_key, version
       FROM public.approval_requests
      WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2)
        AND ($3::boolean OR requested_by = $4 OR assigned_to = $4)
      ORDER BY requested_at DESC
      LIMIT $5`,
    [session.organizationId, status === "all" ? null : status, canManage, session.userId, bounded],
  );
  return result.rows;
}

export async function getPendingApprovalCount(client, organizationId) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM public.approval_requests WHERE organization_id = $1 AND status = 'pending'`,
    [organizationId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function decideApproval(client, session, approvalId, { decision, note }) {
  const locked = await client.query(
    `SELECT id, status, requested_by, command_key, command_payload, version
       FROM public.approval_requests
      WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [approvalId, session.organizationId],
  );
  const approval = locked.rows[0];
  if (!approval) throw new ApprovalError(404, "Approval request not found.");
  if (approval.status !== "pending") {
    throw new ApprovalError(409, `This approval was already ${approval.status}.`);
  }

  const validated = assertApprovalDecision({ decision, note, expectedVersion: approval.version });

  // Self-approval is only meaningless for "cancelled" — a requester
  // withdrawing their OWN pending request is the normal case, not a SoD
  // violation. "approved"/"rejected" are real authorization decisions and
  // must never be made by the same person who requested them.
  if (validated.decision !== "cancelled") {
    try {
      assertSeparationOfDuties({ requestedBy: approval.requested_by, actorUserId: session.userId });
    } catch (error) {
      if (error instanceof WorkflowConflictError) {
        throw new ApprovalError(403, "You cannot decide on your own request.", "SELF_APPROVAL_DENIED");
      }
      throw error;
    }
  } else if (approval.requested_by !== session.userId && !hasSessionPermission(session, "approvals.manage")) {
    // Checkpoint audit (ERP completion gap register, SEC-APPROVAL-001):
    // "approved"/"rejected" dispatch into a module handler that calls its
    // own requirePermission internally (subledger-approvals.js, journals.js,
    // sales/index.js) — genuinely gated. "cancelled" dispatches nowhere (it
    // only flips approval_requests.status, per the comment below) and was
    // skipped by the SoD check above by design, since the requester
    // cancelling their own request is the normal case — but that left
    // ANY authenticated org member free to cancel ANY OTHER user's pending
    // approval with no check at all, not just their own. Only the original
    // requester, or someone holding org-wide approvals.manage, may cancel
    // someone else's request.
    throw new ApprovalError(403, "Only the requester or an approvals manager can cancel this request.", "CANCEL_NOT_PERMITTED");
  }

  // "cancelled" withdraws the approval REQUEST itself (e.g. the requester
  // changed their mind) and never touches the underlying document — the
  // one existing precedent for this (sales/index.js, when a quotation is
  // revised out from under a pending approval) does the same: status flip
  // only, no module call. "approved"/"rejected" always dispatch to the
  // module's own handler, which is the actual authority over the document.
  let outcome = null;
  if (validated.decision !== "cancelled") {
    const handler = COMMAND_DISPATCH[approval.command_key];
    if (!handler) {
      throw new ApprovalError(
        501,
        "This approval type cannot be decided from the global inbox yet. Open the record in its own module.",
        "APPROVAL_COMMAND_NOT_SUPPORTED",
      );
    }
    const context = moduleContext(session);
    const payload = approval.command_payload || {};
    outcome =
      validated.decision === "approved"
        ? await handler.approve(client, context, payload)
        : await handler.reject(client, context, { ...payload, note: validated.note });
  }

  const updated = await client.query(
    `UPDATE public.approval_requests
        SET status = $3, decided_at = now(), decided_by = $4, decision_note = $5, updated_at = now()
      WHERE id = $1 AND organization_id = $2
      RETURNING id, status, decided_at`,
    [approvalId, session.organizationId, validated.decision, session.userId, validated.note],
  );

  return { approval: updated.rows[0], outcome };
}
