"use client";

// Procurement Home: the command centre. What is open, what is still to arrive, the receiving issues, the bills that do not match, what Finance
// shows overdue and the returns still to be resolved — each figure opens the list behind it — and the documents that need someone to act.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcPanel } from "@/features/procurement/shared/ProcUi";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate } from "@/features/procurement/shared/format";

import { getProcurementOverview } from "./api";

const QUICK_LINKS = [
  { href: "/procurement/purchase-orders/new", label: "New Purchase Order" },
  { href: "/procurement/goods-receipts/new", label: "Record Goods Receipt" },
  { href: "/procurement/supplier-bills/new", label: "Record Supplier Bill" },
  { href: "/procurement/purchase-returns/new", label: "Create Purchase Return" },
  { href: "/procurement/receiving-issues/new", label: "Report Receiving Issue" },
  { href: "/procurement/reports", label: "Procurement Reports" },
];

export function ProcurementHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "overview"), queryFn: getProcurementOverview });
  if (query.isError && query.error instanceof ProcApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to Procurement" description="Ask an administrator for a Procurement role." />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Procurement" description={query.data ? `What needs action today (${calendarDate(query.data.today)}), from the purchase orders, receipts, bills and returns themselves.` : "What needs action, from the documents themselves."} />
      {query.isLoading && <LoadingState label="Loading Procurement" />}
      {query.isError && <ErrorState title="Could not load Procurement" description={query.error instanceof Error ? query.error.message : undefined} action={{ label: "Retry", onPress: () => query.refetch() }} />}
      {query.data && (
        <>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
            {query.data.metrics.map((metric) => (
              <li key={metric.key}>
                <Link href={metric.href} className="flex h-full flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-surface-muted">
                  <span className="text-xs font-medium text-text-muted">{metric.label}</span>
                  <span className="text-2xl font-semibold tabular-nums text-text">{metric.value}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ProcPanel title="Requires attention" description="Receiving issues, mismatched bills, held receipts, supplier credits and replacements still pending.">
                {!query.data.attention.length ? <EmptyState title="Nothing needs attention" description="Every receipt, bill and return is up to date." /> : (
                  <ul className="flex flex-col divide-y divide-border">
                    {query.data.attention.map((item) => (
                      <li key={`${item.kind}-${item.href}`}>
                        <Link href={item.href} className="flex items-center gap-3 py-2.5 text-sm hover:bg-surface-muted">
                          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-text">{item.title}</span> <span className="text-text-muted">· {item.kind}</span>
                            <span className="block truncate text-xs text-text-muted">{item.detail}</span>
                          </span>
                          <ChevronRight className="size-4 text-text-muted" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
            </div>
            <ProcPanel title="Quick actions">
              <ul className="flex flex-col gap-2">
                {QUICK_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm text-text transition-colors hover:bg-surface-muted">
                      {link.label}<ChevronRight className="size-4 text-text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </ProcPanel>
          </div>
        </>
      )}
    </div>
  );
}
