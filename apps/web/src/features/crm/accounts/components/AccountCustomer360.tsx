"use client";

// Customer 360: summary cards across CRM, Sales, Finance, Projects and
// Support, and the read-only related lists behind them. Each module's data
// is shown only to people who can open that module.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, MetricCard, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatMoney, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getAccountSummary, listAccountRelated, type AccountRelatedList, type AccountRelatedRow } from "../api/accounts-api";
import { ErrorBanner } from "../account-format";
import { LIVE_ACCOUNT_QUERY } from "../live-query";

export function AccountSummaryCards({ accountId, currency }: { accountId: string; currency: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", accountId, "summary"), queryFn: () => getAccountSummary(accountId), ...LIVE_ACCOUNT_QUERY });
  const summary = query.data;
  if (query.isLoading) return <LoadingState label="Loading summary" rows={2} />;
  if (!summary) return <ErrorBanner message="Could not load the account summary." />;
  const money = (value: number) => formatMoney(currency, value);
  const cards: Array<{ label: string; value: React.ReactNode }> = [
    { label: `Open opportunities · ${money(summary.crm.openPipelineValue)}`, value: summary.crm.openOpportunities },
    { label: `Won · ${money(summary.crm.wonValue)}`, value: summary.crm.wonOpportunities },
    { label: "Contacts", value: summary.crm.contacts },
    { label: "Open tasks and follow-ups", value: summary.crm.openTasks },
    ...(summary.sales ? [
      { label: `Open quotations · ${money(summary.sales.openQuotationValue)}`, value: summary.sales.openQuotations },
      { label: `Sales orders · ${money(summary.sales.orderValue)}`, value: summary.sales.orders },
    ] : []),
    ...(summary.finance ? [
      { label: "Outstanding", value: money(summary.finance.outstanding) },
      { label: "Overdue", value: money(summary.finance.overdue) },
    ] : []),
    ...(summary.projects ? [{ label: "Active projects", value: summary.projects.active }] : []),
    ...(summary.support ? [{ label: "Open support tickets", value: summary.support.openTickets }] : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => <MetricCard key={card.label} label={card.label} value={card.value} />)}
      </div>
      <p className="text-xs text-text-muted">
        {[
          summary.crm.lastActivityAt ? `Last activity ${formatDate(summary.crm.lastActivityAt)}` : "No activity yet",
          summary.sales?.lastOrderDate ? `last order ${formatDate(summary.sales.lastOrderDate)}` : null,
          summary.finance?.lastPaymentDate ? `last payment ${formatDate(summary.finance.lastPaymentDate)}` : null,
        ].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

const LIST_COPY: Record<AccountRelatedList, { title: string; empty: string }> = {
  leads: { title: "Leads", empty: "No leads have been converted into this account." },
  opportunities: { title: "Opportunities", empty: "No opportunities yet. Create one to start tracking a deal with this company." },
  quotations: { title: "Quotations", empty: "No quotations for this account." },
  orders: { title: "Sales orders", empty: "No sales orders for this account." },
  returns: { title: "Returns", empty: "No returns for this account." },
  invoices: { title: "Invoices", empty: "No invoices for this account." },
  payments: { title: "Payments", empty: "No payments received from this account." },
  projects: { title: "Projects", empty: "No projects for this account." },
  tickets: { title: "Support tickets", empty: "No support tickets for this account." },
};

function statusTone(status: string | null): "success" | "danger" | "info" | "neutral" | "warning" {
  if (!status) return "neutral";
  if (["won", "paid", "accepted", "converted", "completed", "closed", "resolved", "applied", "fulfilled"].includes(status)) return "success";
  if (["lost", "rejected", "cancelled", "overdue", "disqualified", "reversed"].includes(status)) return "danger";
  if (["draft", "on_hold", "pending_customer", "pending_internal", "partially_paid"].includes(status)) return "warning";
  return "info";
}

function RowDetail({ row, list, currency }: { row: AccountRelatedRow; list: AccountRelatedList; currency: string }) {
  const money = (value: number | null) => (value === null ? null : formatMoney(row.currencyCode ?? currency, value));
  const parts = [
    row.stage,
    row.kind ? humanize(row.kind) : null,
    row.amount !== null ? money(row.amount) : null,
    row.outstanding ? `${money(row.outstanding)} outstanding` : null,
    row.paymentStatus ? `Payment: ${humanize(row.paymentStatus)}` : null,
    row.percentComplete !== null ? `${row.percentComplete}% complete` : null,
    row.priority ? `Priority: ${row.priority}` : null,
    row.date ? `${list === "opportunities" ? "Expected close" : list === "projects" ? "Planned end" : "Date"}: ${formatDate(row.date)}` : null,
    row.dueDate ? `${list === "quotations" ? "Valid until" : "Due"}: ${formatDate(row.dueDate)}` : null,
    row.ownerName,
  ].filter(Boolean);
  return <span className="text-text-secondary">{parts.join(" · ")}</span>;
}

export function AccountRelatedListPanel({ accountId, list, currency, action }: { accountId: string; list: AccountRelatedList; currency: string; action?: React.ReactNode }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", accountId, "related", list), queryFn: () => listAccountRelated(accountId, list), ...LIVE_ACCOUNT_QUERY });
  const copy = LIST_COPY[list];
  const rows = query.data ?? [];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{copy.title}</h2>
        {action}
      </div>
      {query.isLoading ? <LoadingState label={`Loading ${copy.title.toLowerCase()}`} rows={3} /> : query.isError ? <ErrorBanner message={`Could not load ${copy.title.toLowerCase()}.`} /> : rows.length === 0 ? (
        <EmptyState title={`No ${copy.title.toLowerCase()}`} description={copy.empty} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {row.href ? <Link href={row.href} className="font-medium hover:underline">{row.title ?? row.code}</Link> : <span className="font-medium">{row.title ?? row.code}</span>}
                {row.title && row.code && <span className="text-xs text-text-muted">{row.code}</span>}
                {row.status && <StatusBadge tone={statusTone(row.status)}>{humanize(row.status)}</StatusBadge>}
              </div>
              <RowDetail row={row} list={list} currency={currency} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
