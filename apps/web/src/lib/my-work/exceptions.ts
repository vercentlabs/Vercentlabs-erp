// Exceptions aggregation (Prompt 8, Part 7). Only categories with real,
// already-computed evidence are surfaced — no fabricated source is added
// for symmetry. Four categories reuse existing *governance dashboard*
// functions verbatim (they already return an open-exception-case list
// alongside their own summary/policy data, so this file adds zero new SQL
// for them): Finance Exceptions (accounting receivables/payables/banking
// governance) and Workflow Exceptions (procurement governance). Two more
// reuse existing secured list functions with an in-process filter for a
// condition the dashard already counts but doesn't list: SLA Breaches
// (support tickets) and Quality Holds (quality holds).
//
// Deliberately NOT implemented (documented gap, not fabricated): Stock
// Exceptions (low-stock/negative-stock/expired-batch) — real underlying
// columns exist but no existing query computes them, and a correct
// warehouse-aware low-stock join was judged out of scope for this prompt.
// Accounting close-task blockers, failed workflow executions and payment/
// posting failures were explicitly confirmed absent by the Prompt 8 audit
// and are not represented here either.
import {
  getBankingGovernanceDashboard,
  getPayablesGovernanceDashboard,
  getProcurementGovernanceDashboard,
  getReceivablesGovernanceDashboard,
  listQualityResource,
  listSupportResource,
} from "@vercentlabs/api";

import { accountingContext } from "@/lib/accounting";
import type { WorkspaceSessionContext } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { assertModuleAccessible } from "@/lib/module-access";
import { classifyDueAt, type WorkItem } from "@/lib/my-work/types";
import { procurementContext } from "@/lib/procurement";
import { qualityContext } from "@/lib/quality";
import { supportContext } from "@/lib/support";

type ExceptionRow = Record<string, unknown>;
type GovernanceDashboard = {
  collectionCases?: ExceptionRow[];
  exceptionCases?: ExceptionRow[];
};

const PROCUREMENT_ENTITY_HREF: Record<string, string> = {
  suppliers: "/procurement/suppliers/",
  requisitions: "/procurement/requisitions/",
  "sourcing-events": "/procurement/sourcing/",
  agreements: "/procurement/contracts/",
  "purchase-orders": "/procurement/orders/",
  receipts: "/procurement/receipts/",
};

async function financeReceivableExceptions(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "accounting");
    const context = accountingContext(session);
    const dashboard = (await tenantTransaction(session.organizationId, (client) =>
      getReceivablesGovernanceDashboard(client, context),
    )) as unknown as GovernanceDashboard;
    return (dashboard.collectionCases || [])
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `receivable-exception:${row.id}`,
        kind: "exception" as const,
        moduleId: "accounting" as const,
        source: "Finance exception — collections",
        title: `Collection case — ${row.invoice_number || row.invoiceNumber || "invoice"}`,
        subtitle: row.customer_name ? String(row.customer_name) : undefined,
        dueAt: row.next_action_at
          ? new Date(row.next_action_at as string).toISOString()
          : undefined,
        urgency: classifyDueAt(row.next_action_at as string | null, session.timezone),
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: `/accounting/receivables/${row.customer_invoice_id}`,
      }));
  } catch {
    return [];
  }
}

async function financePayableExceptions(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "accounting");
    const context = accountingContext(session);
    const dashboard = (await tenantTransaction(session.organizationId, (client) =>
      getPayablesGovernanceDashboard(client, context),
    )) as unknown as GovernanceDashboard;
    return (dashboard.exceptionCases || [])
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `payable-exception:${row.id}`,
        kind: "exception" as const,
        moduleId: "accounting" as const,
        source: "Finance exception — payables",
        title: `Payables exception — ${row.bill_number || "bill"}`,
        subtitle: row.supplier_name ? String(row.supplier_name) : undefined,
        dueAt: row.next_action_at
          ? new Date(row.next_action_at as string).toISOString()
          : undefined,
        urgency: classifyDueAt(row.next_action_at as string | null, session.timezone),
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: `/accounting/payables/${row.vendor_bill_id}`,
      }));
  } catch {
    return [];
  }
}

async function financeReconciliationExceptions(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "accounting");
    const context = accountingContext(session);
    const dashboard = (await tenantTransaction(session.organizationId, (client) =>
      getBankingGovernanceDashboard(client, context),
    )) as unknown as GovernanceDashboard;
    return (dashboard.exceptionCases || [])
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `reconciliation-exception:${row.id}`,
        kind: "exception" as const,
        moduleId: "accounting" as const,
        source: "Finance exception — reconciliation",
        title: `Reconciliation exception — ${row.statement_number || "statement"}`,
        subtitle: row.bank_name ? String(row.bank_name) : undefined,
        dueAt: row.next_action_at
          ? new Date(row.next_action_at as string).toISOString()
          : undefined,
        urgency: classifyDueAt(row.next_action_at as string | null, session.timezone),
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: "/accounting/banking",
      }));
  } catch {
    return [];
  }
}

async function workflowProcurementExceptions(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "procurement");
    const context = procurementContext(session);
    const dashboard = (await tenantTransaction(session.organizationId, (client) =>
      getProcurementGovernanceDashboard(client, context),
    )) as unknown as GovernanceDashboard;
    return (dashboard.exceptionCases || [])
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `procurement-exception:${row.id}`,
        kind: "exception" as const,
        moduleId: "procurement" as const,
        source: "Workflow exception — procurement",
        title: `${String(row.reason_code || "Exception").replaceAll("_", " ")} (${row.entity_type})`,
        subtitle: row.company_name ? String(row.company_name) : undefined,
        dueAt: row.next_action_at
          ? new Date(row.next_action_at as string).toISOString()
          : undefined,
        urgency: classifyDueAt(row.next_action_at as string | null, session.timezone),
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: `${PROCUREMENT_ENTITY_HREF[String(row.entity_type)] || "/procurement/governance"}${row.entity_id || ""}`,
      }));
  } catch {
    return [];
  }
}

async function slaBreaches(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "support");
    const context = supportContext(session);
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listSupportResource(client, context, "tickets", { limit: 200 }),
    );
    const now = Date.now();
    return rows
      .filter((row: Record<string, unknown>) => {
        if (row.status === "resolved" || row.status === "closed" || row.status === "cancelled")
          return false;
        const firstResponseBreach =
          row.first_response_due_at &&
          !row.first_responded_at &&
          new Date(row.first_response_due_at as string).getTime() < now;
        const resolutionBreach =
          row.resolution_due_at &&
          new Date(row.resolution_due_at as string).getTime() < now;
        return Boolean(firstResponseBreach || resolutionBreach);
      })
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `sla-breach:${row.id}`,
        kind: "exception" as const,
        moduleId: "support" as const,
        source: "SLA breach",
        title: String(row.subject || row.ticket_number || "Support ticket"),
        dueAt: row.resolution_due_at
          ? new Date(row.resolution_due_at as string).toISOString()
          : undefined,
        urgency: "overdue" as const,
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: "/support/tickets",
      }));
  } catch {
    return [];
  }
}

async function qualityHolds(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "quality");
    const context = qualityContext(session);
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listQualityResource(client, context, "holds", { limit: 200 }),
    );
    return rows
      .filter((row: Record<string, unknown>) => row.status === "active")
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `quality-hold:${row.id}`,
        kind: "exception" as const,
        moduleId: "quality" as const,
        source: "Quality hold",
        title: String(row.reason || row.hold_number || "Quality hold"),
        dueAt: row.created_at
          ? new Date(row.created_at as string).toISOString()
          : undefined,
        urgency: "overdue" as const,
        status: row.status ? String(row.status) : undefined,
        href: "/quality/holds",
      }));
  } catch {
    return [];
  }
}

export async function listMyExceptions(
  session: WorkspaceSessionContext,
  limit = 50,
): Promise<WorkItem[]> {
  const results = await Promise.allSettled([
    financeReceivableExceptions(session, limit),
    financePayableExceptions(session, limit),
    financeReconciliationExceptions(session, limit),
    workflowProcurementExceptions(session, limit),
    slaBreaches(session, limit),
    qualityHolds(session, limit),
  ]);
  const items = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  items.sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
  return items.slice(0, limit);
}
