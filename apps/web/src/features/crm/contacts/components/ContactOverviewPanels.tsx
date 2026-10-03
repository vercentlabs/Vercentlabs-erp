"use client";

// The contact's summary cards and read-only related lists. Quotations,
// orders, projects and tickets are read from their modules and shown only to
// people who can open those modules.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, MetricCard, StatusBadge } from "@vercentlabs/design-system";

import { FollowUpCell } from "@/features/crm/leads/lead-format";
import { formatDate, formatMoney, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getContactSummary, listContactRelated, type ContactRelatedList } from "../api/contacts-api";
import { ErrorBanner, LIVE_CONTACT_QUERY } from "../contact-format";

export function ContactSummaryCards({ contactId }: { contactId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "summary"), queryFn: () => getContactSummary(contactId), ...LIVE_CONTACT_QUERY });
  const summary = query.data;
  if (query.isLoading) return <LoadingState label="Loading summary" rows={2} />;
  if (!summary) return <ErrorBanner message="Could not load the contact summary." />;
  const cards: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Open opportunities", value: summary.openOpportunities },
    { label: "Open tasks and follow-ups", value: summary.openTasks },
    ...(summary.openQuotations !== undefined ? [{ label: "Open quotations", value: summary.openQuotations }] : []),
    ...(summary.openTickets !== undefined ? [{ label: "Open support tickets", value: summary.openTickets }] : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => <MetricCard key={card.label} label={card.label} value={card.value} />)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-secondary">
        <span>Next follow-up: <FollowUpCell value={summary.nextFollowUpAt} /></span>
        <span>Last activity: {summary.lastActivityAt ? formatDate(summary.lastActivityAt) : "None yet"}</span>
      </div>
    </div>
  );
}

const LIST_COPY: Record<ContactRelatedList, { title: string; empty: string }> = {
  opportunities: { title: "Opportunities", empty: "This person is not on any opportunity yet." },
  quotations: { title: "Quotations", empty: "No quotations are addressed to this person." },
  orders: { title: "Sales orders", empty: "No sales orders name this person." },
  projects: { title: "Projects", empty: "No projects for this person's company." },
  tickets: { title: "Support tickets", empty: "This person has not raised any support tickets." },
};

function statusTone(status: string | null): "success" | "danger" | "info" | "neutral" | "warning" {
  if (!status) return "neutral";
  if (["won", "paid", "accepted", "converted", "completed", "closed", "resolved", "fulfilled"].includes(status)) return "success";
  if (["lost", "rejected", "cancelled", "overdue"].includes(status)) return "danger";
  if (["draft", "on_hold", "pending_customer", "pending_internal"].includes(status)) return "warning";
  return "info";
}

export function ContactRelatedListPanel({ contactId, list, currency, action }: { contactId: string; list: ContactRelatedList; currency?: string; action?: React.ReactNode }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "related", list), queryFn: () => listContactRelated(contactId, list), ...LIVE_CONTACT_QUERY });
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
              <span className="text-text-secondary">
                {[row.kind, row.stage, row.amount !== null ? formatMoney(row.currencyCode ?? currency, row.amount) : null,
                  row.priority ? `Priority: ${row.priority}` : null, row.date ? formatDate(row.date) : null, row.ownerName].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
