// The one cross-module approval command registry: connects the platform
// approval catalogue (core/platform/approvals/catalog.js) to the business
// module that owns each decision. Built on @vercentlabs/workflows'
// createCommandRegistry; each command's execute() calls the module's own
// approve/reject function, which enforces the business permission, the
// document state and SoD, and closes the shared request in the same
// transaction.
import { createCommandRegistry } from "@vercentlabs/workflows";

import { APPROVAL_COMMANDS, ApprovalError, getApprovalCommand } from "../../core/platform/approvals/index.js";
import { approveBudget, rejectBudgetApproval } from "../../modules/accounting/advanced.js";
import { approveJournalEntry, rejectJournalApproval } from "../../modules/accounting/journals.js";
import {
  approveCustomerInvoice, rejectCustomerInvoiceApproval,
  approveVendorBill, rejectVendorBillApproval,
  approveVendorPayment, rejectVendorPaymentApproval,
} from "../../modules/accounting/subledger-approvals.js";
import {
  approvePosCartDiscountApproval, rejectPosCartDiscountApproval,
  approvePosPaymentOverride, rejectPosPaymentOverrideApproval,
} from "../../modules/point-of-sale/index.js";
import {
  approveQuotation, rejectQuotationApproval,
  approveSalesOrder, rejectSalesOrderApproval,
  approveSalesOrderAmendment, rejectSalesOrderAmendment,
} from "../../modules/sales/index.js";

// key -> { approve, reject, href }. Only verified handlers are listed.
const HANDLERS = Object.freeze({
  "accounting.customer_invoice.approve": {
    approve: (client, context, p) => approveCustomerInvoice(client, context, p.documentId, p.contentHash),
    reject: (client, context, p) => rejectCustomerInvoiceApproval(client, context, p.documentId),
    href: () => "/accounting/customer-invoices",
  },
  "accounting.vendor_bill.approve": {
    approve: (client, context, p) => approveVendorBill(client, context, p.documentId, p.contentHash),
    reject: (client, context, p) => rejectVendorBillApproval(client, context, p.documentId),
    href: () => "/accounting/supplier-invoices",
  },
  "accounting.vendor_payment.approve": {
    approve: (client, context, p) => approveVendorPayment(client, context, p.documentId, p.contentHash),
    reject: (client, context, p) => rejectVendorPaymentApproval(client, context, p.documentId),
    href: () => "/accounting/payments",
  },
  "accounting.journal.approve": {
    approve: (client, context, p) => approveJournalEntry(client, context, p.journalEntryId, p.contentHash),
    reject: (client, context, p) => rejectJournalApproval(client, context, p.journalEntryId),
    href: () => "/accounting/journals",
  },
  "accounting.budget.approve": {
    approve: (client, context, p) => approveBudget(client, context, p.budgetId),
    reject: (client, context, p) => rejectBudgetApproval(client, context, p.budgetId),
    href: () => "/accounting/budgets",
  },
  "sales.quotation.approve": {
    approve: (client, context, p) => approveQuotation(client, context, p.quotationId, p.quotationVersionId),
    reject: (client, context, p) => rejectQuotationApproval(client, context, p.quotationId, p.note),
    href: (p) => `/sales/quotations/${p.quotationId}`,
  },
  "sales.order.approve": {
    approve: (client, context, p) => approveSalesOrder(client, context, p.orderId, p.orderVersionId),
    reject: (client, context, p) => rejectSalesOrderApproval(client, context, p.orderId, p.note),
    href: (p) => `/sales/orders/${p.orderId}`,
  },
  "sales.order.amendment.approve": {
    approve: (client, context, p) => approveSalesOrderAmendment(client, context, p.orderId, p.orderVersionId, p.previousVersionId, p.resumeStatus),
    reject: (client, context, p) => rejectSalesOrderAmendment(client, context, p.orderId, p.orderVersionId, p.previousVersionId, p.resumeStatus),
    href: (p) => `/sales/orders/${p.orderId}`,
  },
  "pos.discount.approve": {
    approve: (client, context, p) => approvePosCartDiscountApproval(client, context, p),
    reject: (client, context, p) => rejectPosCartDiscountApproval(client, context, p),
    href: () => "/pos/discount-approvals",
  },
  "pos.payment.override.approve": {
    approve: (client, context, p) => approvePosPaymentOverride(client, context, p),
    reject: (client, context, p) => rejectPosPaymentOverrideApproval(client, context, p),
    href: () => "/pos/transactions",
  },
});

export const APPROVAL_COMMAND_REGISTRY = createCommandRegistry(
  APPROVAL_COMMANDS.filter((command) => HANDLERS[command.key]).map((command) => ({
    key: command.key,
    validate(payload) {
      for (const name of command.payload) {
        if (typeof payload?.[name] !== "string" || !payload[name]) throw new ApprovalError(422, "This approval request is incomplete.", "APPROVAL_PAYLOAD_INVALID");
      }
      return payload;
    },
    execute({ client, context, decision, note }, payload) {
      const handler = HANDLERS[command.key];
      return decision === "approved" ? handler.approve(client, context, payload) : handler.reject(client, context, { ...payload, note });
    },
  })),
);

export function approvalHref(commandKey, payload) {
  const handler = HANDLERS[commandKey];
  return handler && getApprovalCommand(commandKey) ? handler.href(payload || {}) : null;
}

export const REGISTERED_APPROVAL_COMMAND_KEYS = Object.freeze(APPROVAL_COMMAND_REGISTRY.keys());
