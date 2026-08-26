import {
  approveBudget,
  approveCustomerInvoice,
  approveJournalEntry,
  approveVendorBill,
  approveVendorPayment,
  approveQuotation,
  approveSalesOrder,
  approveSalesOrderAmendment,
  completeCrmActivity,
  moveOpportunityStage,
  rejectBudgetApproval,
  rejectCustomerInvoiceApproval,
  rejectJournalApproval,
  rejectVendorBillApproval,
  rejectVendorPaymentApproval,
  rejectQuotationApproval,
  rejectSalesOrderApproval,
  rejectSalesOrderAmendment,
} from "@vercentlabs/api";
import { createCommandRegistry } from "@vercentlabs/workflows";
import type { PoolClient } from "pg";
import { z } from "zod";

import type { WorkspaceSessionContext } from "@/core/auth";
import { PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { accountingContext } from "@/modules/accounting";

type CommandContext = {
  client: PoolClient;
  session: WorkspaceSessionContext;
};

export type ApprovalCommand = {
  key: string;
  permission: string;
  entityType: string;
  entityId(payload: Record<string, unknown>): string;
  title(payload: Record<string, unknown>): string;
  validate(payload: unknown): Record<string, unknown>;
  execute(
    context: CommandContext,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  reject?(
    context: CommandContext,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
};

const uuid = z.string().uuid();

const salesContext = (session: WorkspaceSessionContext) => ({
  organizationId: session.organizationId,
  userId: session.userId,
  activeCompanyId: session.activeCompanyId,
  activeBranchId: session.activeBranchId,
  allowAllCompanies: session.roleSlugs.some((role) =>
    [
      "organization_owner",
      "system_administrator",
      "company_administrator",
    ].includes(role),
  ),
  permissions: session.permissions,
  roleSlugs: session.roleSlugs,
});

const definitions: ApprovalCommand[] = [
  {
    key: "accounting.budget.approve",
    permission: PERMISSIONS.accountingBudgetManage,
    entityType: "accounting_budget",
    entityId: (payload) => String(payload.budgetId),
    title: (payload) => `Approve accounting budget ${String(payload.budgetId)}`,
    validate: (payload) => z.object({ budgetId: uuid }).strict().parse(payload),
    execute: ({ client, session }, payload) => approveBudget(client, accountingContext(session), String(payload.budgetId)),
    reject: ({ client, session }, payload) => rejectBudgetApproval(client, accountingContext(session), String(payload.budgetId)),
  },
  {
    key: "accounting.customer_invoice.approve",
    permission: PERMISSIONS.accountingReceivablesApprove,
    entityType: "accounting_customer_invoice",
    entityId: (payload) => String(payload.documentId),
    title: (payload) => `Approve customer invoice ${String(payload.documentId)}`,
    validate: (payload) => z.object({ documentId: uuid, contentHash: z.string().min(32).max(128) }).strict().parse(payload),
    execute: ({ client, session }, payload) => approveCustomerInvoice(client, accountingContext(session), String(payload.documentId), String(payload.contentHash)),
    reject: ({ client, session }, payload) => rejectCustomerInvoiceApproval(client, accountingContext(session), String(payload.documentId)),
  },
  {
    key: "accounting.vendor_bill.approve",
    permission: PERMISSIONS.accountingPayablesApprove,
    entityType: "accounting_vendor_bill",
    entityId: (payload) => String(payload.documentId),
    title: (payload) => `Approve vendor bill ${String(payload.documentId)}`,
    validate: (payload) => z.object({ documentId: uuid, contentHash: z.string().min(32).max(128) }).strict().parse(payload),
    execute: ({ client, session }, payload) => approveVendorBill(client, accountingContext(session), String(payload.documentId), String(payload.contentHash)),
    reject: ({ client, session }, payload) => rejectVendorBillApproval(client, accountingContext(session), String(payload.documentId)),
  },
  {
    key: "accounting.vendor_payment.approve",
    permission: PERMISSIONS.accountingPaymentsApprove,
    entityType: "accounting_vendor_payment",
    entityId: (payload) => String(payload.documentId),
    title: (payload) => `Approve vendor payment ${String(payload.documentId)}`,
    validate: (payload) => z.object({ documentId: uuid, contentHash: z.string().min(32).max(128) }).strict().parse(payload),
    execute: ({ client, session }, payload) => approveVendorPayment(client, accountingContext(session), String(payload.documentId), String(payload.contentHash)),
    reject: ({ client, session }, payload) => rejectVendorPaymentApproval(client, accountingContext(session), String(payload.documentId)),
  },
  {
    key: "accounting.journal.approve",
    permission: PERMISSIONS.accountingJournalApprove,
    entityType: "accounting_journal_entry",
    entityId: (payload) => String(payload.journalEntryId),
    title: (payload) => `Approve accounting journal ${String(payload.journalEntryId)}`,
    validate: (payload) => z.object({ journalEntryId: uuid, contentHash: z.string().min(32).max(128) }).strict().parse(payload),
    execute: ({ client, session }, payload) => approveJournalEntry(client, accountingContext(session), String(payload.journalEntryId), String(payload.contentHash)),
    reject: ({ client, session }, payload) => rejectJournalApproval(client, accountingContext(session), String(payload.journalEntryId)),
  },
  {
    key: "sales.quotation.approve",
    permission: PERMISSIONS.salesQuotationApprove,
    entityType: "sales_quotation",
    entityId: (payload) => String(payload.quotationId),
    title: (payload) =>
      `Approve Sales quotation ${String(payload.quotationId)}`,
    validate: (payload) =>
      z
        .object({ quotationId: uuid, quotationVersionId: uuid })
        .strict()
        .parse(payload),
    execute: ({ client, session }, payload) =>
      approveQuotation(
        client,
        salesContext(session),
        String(payload.quotationId),
        String(payload.quotationVersionId),
      ),
    reject: ({ client, session }, payload) =>
      rejectQuotationApproval(
        client,
        salesContext(session),
        String(payload.quotationId),
      ),
  },
  {
    key: "sales.order.approve",
    permission: PERMISSIONS.salesOrderApprove,
    entityType: "sales_order",
    entityId: (payload) => String(payload.orderId),
    title: (payload) => `Approve Sales order ${String(payload.orderId)}`,
    validate: (payload) =>
      z
        .object({ orderId: uuid, orderVersionId: uuid })
        .strict()
        .parse(payload),
    execute: ({ client, session }, payload) =>
      approveSalesOrder(
        client,
        salesContext(session),
        String(payload.orderId),
        String(payload.orderVersionId),
      ),
    reject: ({ client, session }, payload) =>
      rejectSalesOrderApproval(
        client,
        salesContext(session),
        String(payload.orderId),
      ),
  },
  {
    key: "sales.order.amendment.approve",
    permission: PERMISSIONS.salesOrderApprove,
    entityType: "sales_order_amendment",
    entityId: (payload) => String(payload.orderId),
    title: (payload) =>
      `Approve Sales order amendment ${String(payload.orderId)}`,
    validate: (payload) =>
      z
        .object({
          orderId: uuid,
          orderVersionId: uuid,
          previousVersionId: uuid,
          resumeStatus: z.enum(["confirmed", "on_hold"]),
        })
        .strict()
        .parse(payload),
    execute: ({ client, session }, payload) =>
      approveSalesOrderAmendment(
        client,
        salesContext(session),
        String(payload.orderId),
        String(payload.orderVersionId),
        String(payload.previousVersionId),
        payload.resumeStatus as "confirmed" | "on_hold",
      ),
    reject: ({ client, session }, payload) =>
      rejectSalesOrderAmendment(
        client,
        salesContext(session),
        String(payload.orderId),
        String(payload.orderVersionId),
        String(payload.previousVersionId),
        payload.resumeStatus as "confirmed" | "on_hold",
      ),
  },
  {
    key: "crm.opportunity.stage_change",
    permission: PERMISSIONS.crmOpportunitiesManage,
    entityType: "opportunity",
    entityId: (payload) => String(payload.opportunityId),
    title: (payload) =>
      `Move opportunity ${String(payload.opportunityId)} to the requested stage`,
    validate: (payload) =>
      z
        .object({
          opportunityId: uuid,
          stageId: uuid,
          note: z.string().trim().max(1000).optional().nullable(),
          outcomeReasonId: uuid.optional().nullable(),
          outcomeNotes: z.string().trim().max(4000).optional().nullable(),
          expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
          expectedStageId: uuid.optional().nullable(),
        })
        .strict()
        .parse(payload),
    execute: async ({ client, session }, payload) =>
      moveOpportunityStage(
        client,
        await crmApiContext(session),
        String(payload.opportunityId),
        String(payload.stageId),
        payload.note ? String(payload.note) : null,
        {
          expectedUpdatedAt: payload.expectedUpdatedAt
            ? String(payload.expectedUpdatedAt)
            : undefined,
          expectedStageId: payload.expectedStageId
            ? String(payload.expectedStageId)
            : null,
          outcomeReasonId: payload.outcomeReasonId
            ? String(payload.outcomeReasonId)
            : null,
          outcomeNotes: payload.outcomeNotes
            ? String(payload.outcomeNotes)
            : null,
        },
      ),
  },
  {
    key: "crm.activity.complete",
    permission: PERMISSIONS.crmActivitiesManage,
    entityType: "activity",
    entityId: (payload) => String(payload.activityId),
    title: (payload) =>
      `Complete CRM activity ${String(payload.activityId)}`,
    validate: (payload) =>
      z
        .object({
          activityId: uuid,
          outcome: z.string().trim().max(2000).optional().nullable(),
        })
        .strict()
        .parse(payload),
    execute: async ({ client, session }, payload) =>
      completeCrmActivity(
        client,
        await crmApiContext(session),
        String(payload.activityId),
        payload.outcome ? String(payload.outcome) : null,
      ),
  },
];

const registry = createCommandRegistry(definitions);

export function getApprovalCommand(key: string) {
  return registry.get(key) as ApprovalCommand | null;
}

export function approvalCommandKeys() {
  return registry.keys();
}
