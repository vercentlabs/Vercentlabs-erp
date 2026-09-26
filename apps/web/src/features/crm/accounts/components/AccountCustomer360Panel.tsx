"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ErrorState, Timeline, type TimelineEntry } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDateTime, formatMoney, humanize } from "@/shared/format/human";
import { AccountApiError, getCustomer360 } from "../api/accounts-api";
import type { Customer360TimelineEntry } from "../types";

const timelineTone: Record<Customer360TimelineEntry["entry_type"], TimelineEntry["tone"]> = {
  activity: "neutral",
  communication: "neutral",
  opportunity: "info",
  quotation: "neutral",
  sales_order: "info",
  invoice: "warning",
  receipt: "success",
  support: "danger",
};

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-canvas px-3 py-2">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-lg font-semibold text-text tabular-nums">{value}</span>
    </div>
  );
}

// F002 gap-closure — getCustomer360 (account-intelligence.js) unifies the
// Account, its hierarchy, Contacts and a cross-module timeline (CRM
// activities/communications, Sales quotations/orders, Accounting
// invoices/receipts, support) into one read. It already existed, fully
// built and already covered by getCustomer360ForCaller's sensitive-field
// projection, but had no route or frontend caller anywhere before this pass.
export function AccountCustomer360Panel({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId, "customer-360"),
    queryFn: () => getCustomer360(accountId),
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading 360 view…</p>;
  if (query.isError) {
    return (
      <ErrorState
        title="Could not load the 360 view"
        description={query.error instanceof AccountApiError ? query.error.message : undefined}
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  const view = query.data?.view;
  if (!view) return null;

  const entries: TimelineEntry[] = view.timeline.map((row) => ({
    id: row.entry_id,
    tone: timelineTone[row.entry_type] ?? "neutral",
    title: `${humanize(row.entry_type)}${row.title ? ` — ${row.title}` : ""}`,
    description: [row.status ? humanize(row.status) : null, row.amount !== null ? formatMoney(row.currency_code, row.amount) : null].filter(Boolean).join(" · ") || undefined,
    timestamp: formatDateTime(row.occurred_at),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Opportunities" value={view.metrics.opportunities} />
        {/* Sales/Accounting figures come back only for callers with that module's view permission. */}
        {view.sourceCoverage.quotations && <MetricTile label="Quotations" value={view.metrics.quotations} />}
        {view.sourceCoverage.orders && <MetricTile label="Orders" value={view.metrics.orders} />}
        {view.sourceCoverage.invoices && <MetricTile label="Invoices" value={view.metrics.invoices} />}
        {view.sourceCoverage.invoices && <MetricTile label="Outstanding" value={formatMoney(null, view.metrics.outstanding) || "0"} />}
        <MetricTile label="Open service cases" value={view.metrics.open_service_cases} />
      </div>

      {(view.hierarchy.ancestors.length > 0 || view.hierarchy.descendants.length > 0) && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text">Hierarchy</p>
          {view.hierarchy.ancestors.length > 0 && (
            <p className="text-sm text-text-secondary">
              {view.hierarchy.ancestors.map((node) => node.display_name).join(" / ")} / <span className="font-medium text-text">{view.account.display_name as string}</span>
            </p>
          )}
          {view.hierarchy.descendants.length > 0 && (
            <p className="text-sm text-text-secondary">{view.hierarchy.metrics.descendantCount} child account{view.hierarchy.metrics.descendantCount === 1 ? "" : "s"}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-text">Contacts ({view.contacts.length})</p>
        {view.contacts.length === 0 ? (
          <p className="text-sm text-text-muted">No contacts are linked to this account yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {view.contacts.map((contact) => (
              <li key={contact.id as string} className="text-sm text-text">
                <Link className="font-medium text-brand hover:underline" href={`/crm/contacts/${contact.id}`}>
                  {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                </Link>
                {contact.title ? <span className="text-text-secondary"> — {contact.title as string}</span> : null}
                {contact.sensitiveDataRestricted ? <span className="text-text-muted"> (contact details restricted)</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-text">Unified timeline</p>
        <p className="text-xs text-text-muted">Combines CRM activities and communications, opportunities, sales quotations and orders, accounting invoices and receipts, and support events.</p>
        <Timeline entries={entries} emptyMessage="No activity recorded across CRM, sales or accounting for this account yet." />
      </div>
    </div>
  );
}
