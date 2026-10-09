"use client";

// The read-only tabs: the customer's documents in each module, and the
// history of changes to the customer itself.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyState, PermissionState } from "@vercentlabs/design-system";

import { statusLabel, statusTone } from "@/features/sales/shared/format";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, listCustomerHistory, listCustomerRelated } from "../api/customers-api";
import { ErrorBanner } from "../customer-format";

export type RelatedList = "quotations" | "orders" | "deliveries" | "invoices" | "payments" | "returns" | "projects" | "support";

const LISTS: Record<RelatedList, { noun: string; empty: string; title: string; detail?: string; due?: string; amount?: boolean; outstanding?: string }> = {
  quotations: { noun: "Quotation", empty: "No quotations for this customer yet.", title: "", due: "Valid until", amount: true },
  orders: { noun: "Sales order", empty: "No sales orders for this customer yet.", title: "", detail: "Delivery · Invoicing", amount: true },
  deliveries: { noun: "Delivery", empty: "No deliveries for this customer yet.", title: "Sales order", detail: "Tracking" },
  invoices: { noun: "Invoice", empty: "No invoices for this customer yet.", title: "", due: "Due", amount: true, outstanding: "Outstanding" },
  payments: { noun: "Receipt", empty: "No payments from this customer yet.", title: "", detail: "Method", amount: true, outstanding: "Unallocated" },
  returns: { noun: "Document", empty: "No returns or credit notes for this customer.", title: "Reason", detail: "Type", amount: true },
  projects: { noun: "Project", empty: "No projects for this customer.", title: "Name", detail: "Manager", due: undefined },
  support: { noun: "Ticket", empty: "No support tickets from this customer.", title: "Subject", detail: "Priority" },
};

export function CustomerRelatedPanel({ customerId, list }: { customerId: string; list: RelatedList }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customerId, "related", list), queryFn: () => listCustomerRelated(customerId, list) });
  const shape = LISTS[list];
  if (query.isLoading) return <div className="pt-3"><LoadingState label="Loading" rows={4} /></div>;
  if (query.isError)
    return errorCode(query.error) === "PERMISSION_DENIED"
      ? <div className="pt-3"><PermissionState title="You don't have access to this information" description="Ask an administrator for access." /></div>
      : <div className="pt-3"><ErrorBanner message={errorMessage(query.error, "This list could not be loaded.")} /></div>;
  const rows = query.data ?? [];
  if (rows.length === 0) return <div className="pt-3"><EmptyState title={shape.empty} description="Documents appear here as they are created." /></div>;
  const headings = [shape.noun, shape.title, "Status", shape.detail, "Date", shape.due, shape.amount ? "Amount" : undefined, shape.outstanding].filter((heading): heading is string => heading !== undefined);
  return (
    <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-muted text-left text-text-secondary">
          <tr>{headings.map((heading, index) => <th key={`${heading}-${index}`} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap">
                {row.href ? <Link className="text-brand underline-offset-2 hover:underline" href={row.href}>{row.code ?? "Open"}</Link> : row.code}
              </th>
              <td className="px-3 py-2">{row.title ?? ""}</td>
              <td className="px-3 py-2">{row.status ? <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge> : ""}</td>
              {shape.detail !== undefined && <td className="px-3 py-2">{row.detail ? statusLabel(row.detail) : ""}</td>}
              <td className="px-3 py-2 whitespace-nowrap">{row.date ? formatDate(row.date) : ""}</td>
              {shape.due !== undefined && <td className="px-3 py-2 whitespace-nowrap">{row.dueDate ? formatDate(row.dueDate) : ""}</td>}
              {shape.amount && <td className="px-3 py-2 whitespace-nowrap tabular-nums">{row.amount !== null ? formatMoney(row.currencyCode, row.amount) : ""}</td>}
              {shape.outstanding !== undefined && <td className="px-3 py-2 whitespace-nowrap tabular-nums">{row.outstanding !== null ? formatMoney(row.currencyCode, row.outstanding) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const show = (value: unknown) => (value === null || value === undefined || value === "" ? "empty" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value));
type Change = { label?: string; from?: unknown; to?: unknown };
const isChange = (value: unknown): value is Change => Boolean(value) && typeof value === "object" && ("from" in (value as object) || "to" in (value as object));

// Who changed what and when, with the old and the new value.
export function CustomerHistoryPanel({ customerId }: { customerId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customerId, "history"), queryFn: () => listCustomerHistory(customerId) });
  if (query.isLoading) return <div className="pt-3"><LoadingState label="Loading history" rows={4} /></div>;
  if (query.isError) return <div className="pt-3"><ErrorBanner message={errorMessage(query.error, "The history could not be loaded.")} /></div>;
  const entries = query.data ?? [];
  if (entries.length === 0) return <div className="pt-3"><EmptyState title="No history yet" description="Changes to this customer are recorded here." /></div>;
  return (
    <ol className="mt-3 flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
      {entries.map((entry) => {
        const changes = Object.entries(entry.changes ?? {}).filter(([, value]) => isChange(value)) as Array<[string, Change]>;
        return (
          <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">{entry.summary}</span>
            {changes.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-text-secondary">
                {changes.map(([field, change]) => <li key={field}>{change.label ?? statusLabel(field)}: {show(change.from)} → {show(change.to)}</li>)}
              </ul>
            )}
            <span className="text-xs text-text-muted">{[entry.actorName ?? "System", formatDateTime(entry.createdAt)].join(" · ")}</span>
          </li>
        );
      })}
    </ol>
  );
}
