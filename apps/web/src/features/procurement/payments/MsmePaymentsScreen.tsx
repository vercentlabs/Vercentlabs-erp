"use client";

// Payables › MSME Payments (Procurement plan Phase 1): bills to micro and small suppliers against their statutory deadline (MSMED Act s.15 —
// the agreed days, never more than 45, else 15, from acceptance). Unpaid past the deadline, the expense is also disallowed under s.43B(h).
// Buckets by the days left; each row opens its bill to pay it.
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useListState } from "@/features/procurement/shared/navigation";
import { calendarDate, money } from "@/features/procurement/shared/format";

import { errorMessage, listMsmePayments, type MsmeRow } from "./api";

const BUCKETS = [{ key: "all", label: "All open" }, { key: "overdue", label: "Overdue" }, { key: "due_7", label: "Due in 7 days" }, { key: "due_15", label: "Due in 15 days" },
  { key: "due_45", label: "Due in 45 days" }, { key: "disputed", label: "Disputed" }];

function DaysLeft({ row }: { row: MsmeRow }) {
  if (row.disputed) return <StatusBadge tone="neutral">Disputed</StatusBadge>;
  if (row.daysLeft < 0) return <StatusBadge tone="danger">{`${-row.daysLeft} day${row.daysLeft === -1 ? "" : "s"} late`}</StatusBadge>;
  if (row.daysLeft === 0) return <StatusBadge tone="warning">Due today</StatusBadge>;
  return <StatusBadge tone={row.daysLeft <= 7 ? "warning" : "info"}>{`${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} left`}</StatusBadge>;
}

export function MsmePaymentsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const list = useListState("msme-payments", { view: "all", filters: {} });
  const bucket = list.view.replace(/-/g, "_");
  const filters = useMemo(() => ({ bucket: bucket === "all" ? undefined : bucket, search: list.search.trim() || undefined }), [bucket, list.search]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "msme-payments", filters), queryFn: () => listMsmePayments(filters), placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<MsmeRow, unknown>[]>(() => [
    { id: "bill", header: "Bill", cell: ({ row }) => <span><span className="font-medium tabular-nums">{row.original.billNumber}</span>
      {row.original.supplierInvoice && <span className="block text-xs text-text-muted">{row.original.supplierInvoice}</span>}</span> },
    { id: "supplier", header: "Supplier", cell: ({ row }) => <span>{row.original.supplierName}
      <span className="block text-xs capitalize text-text-muted">{[row.original.classification, row.original.udyam].filter(Boolean).join(" · ")}</span></span> },
    { id: "accepted", header: "Accepted", cell: ({ row }) => <span>{calendarDate(row.original.acceptanceDate)}<span className="block text-xs text-text-muted">{row.original.sourceReference}</span></span> },
    { id: "deadline", header: "Pay by", cell: ({ row }) => <span>{calendarDate(row.original.statutoryDueDate)}<span className="block text-xs text-text-muted">{row.original.statutoryDays} days</span></span> },
    { id: "left", header: "Status", cell: ({ row }) => <DaysLeft row={row.original} /> },
    { id: "outstanding", header: "Still owed", cell: ({ row }) => <span className="font-medium tabular-nums">{money(row.original.currencyCode, row.original.outstanding)}</span> },
  ], []);
  const counts = new Map((query.data?.buckets ?? []).map((entry) => [entry.key, entry]));
  return (
    <EnterpriseListPage header={{ title: "MSME Payments",
      description: <>Bills to micro and small suppliers against their legal deadline: the agreed days (45 at most), else 15, from acceptance. Paid late, statutory interest is due and the expense is disallowed under section 43B(h). Pay from the bill or from <Link className="text-brand hover:underline" href="/procurement/reports/payment-obligations">Due &amp; Overdue</Link>.</> }}
      savedViews={{ views: BUCKETS.map((entry) => ({ id: entry.key, label: counts.get(entry.key) ? `${entry.label} (${counts.get(entry.key)?.count})` : entry.label })), activeViewId: bucket,
        onSelect: (next) => list.setView(next.replace(/_/g, "-")) }}
      actionBar={{ start: <SearchField aria-label="Search MSME payments" placeholder="Bill, invoice or supplier" className="w-full sm:w-80" value={list.search} onChange={list.setSearch} /> }}>
      <EnterpriseDataGrid<MsmeRow> aria-label="MSME payments" columns={columns} data={rows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (list.search || bucket !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading MSME payments" rows={6} />}
        errorContent={<ErrorState title="Could not load MSME payments" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="Nothing owed to MSME suppliers" description="Bills to suppliers marked micro or small (with their Udyam number) appear here once posted." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view or search." />}
        onRowClick={(row) => router.push(row.href)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.billNumber} · {row.supplierName}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-text-muted">Pay by {calendarDate(row.statutoryDueDate)} · {money(row.currencyCode, row.outstanding)} <DaysLeft row={row} /></span></div>} />
    </EnterpriseListPage>
  );
}
