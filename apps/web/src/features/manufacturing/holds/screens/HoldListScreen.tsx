"use client";

// Production Holds: every manufacturing order stopped now (and, in other views, earlier holds) with why, how serious, who must clear it, how
// long it has been held and whether customer demand waits on it. Key figures on top; a row opens the hold. Holds start from an order.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { HOLDS_BASE, SEVERITY_TONE, STATUS_TONE, duration, listHolds, type HoldRow } from "../api/hold-api";

const VIEWS = [{ id: "ACTIVE", label: "On hold" }, { id: "overdue", label: "Overdue" }, { id: "CRITICAL", label: "Critical" }, { id: "RESUMED", label: "Resumed" }, { id: "all", label: "All" }];

export function HoldListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "ACTIVE");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: view === "RESUMED" ? "RESUMED" : view === "all" ? "all" : "ACTIVE", severity: view === "CRITICAL" ? "CRITICAL" : undefined, overdue: view === "overdue" ? "true" : undefined,
    search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-holds", filters), queryFn: () => listHolds(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.holds ?? [], [list.data]);
  const summary = list.data?.summary;
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<HoldRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Hold", enableHiding: false, cell: ({ row }) => <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>
      <span className="text-xs text-text-muted">{row.original.orderNumber}</span></span> },
    { id: "item", header: "Product", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.item}</span><span className="text-xs text-text-muted">{qty(row.original.remaining)} remaining</span></span> },
    { id: "reasons", header: "Why", cell: ({ row }) => <span className="flex flex-col"><span className="text-sm">{row.original.reasons.join(", ")}</span>
      {row.original.status === "ACTIVE" && <span className="text-xs text-text-muted">{row.original.openReasons ? `Waiting on ${row.original.waitingOn.join(", ").toLowerCase()}` : "Ready to resume"}</span>}</span> },
    { id: "severity", header: "Severity", cell: ({ row }) => <StatusBadge tone={SEVERITY_TONE[row.original.severity]}>{row.original.severity.toLowerCase()}</StatusBadge> },
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge>
      {row.original.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}{row.original.resumeRequested && row.original.status === "ACTIVE" && <StatusBadge tone="info">Resume requested</StatusBadge>}</span> },
    { id: "duration", header: "Held", cell: ({ row }) => <span className="flex flex-col"><span>{duration(row.original.durationHours)}</span><span className="text-xs text-text-muted">since {formatDateTime(row.original.startedAt)}</span></span> },
    { id: "customers", header: "Customer lines", cell: ({ row }) => (row.original.customerLines ? <StatusBadge tone="warning">{`${row.original.customerLines} waiting`}</StatusBadge> : "") },
    { id: "owner", header: "Owner", cell: ({ row }) => row.original.owner ?? "—" },
  ], []);
  if (list.error && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to production holds" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Production Holds", description: "Manufacturing orders stopped for a shortage, a quality failure, equipment, safety or another reason: what blocks them, who must clear it and for how long. A hold stops new execution; it never undoes what was done." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search holds" placeholder="Hold, order or product" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {[["On hold", String(summary.active)], ["Critical", String(summary.critical)], ["Overdue", String(summary.overdue)], ["Longest active", duration(summary.longestActiveHours)],
            ["Average hold", duration(summary.averageHours)], ["Output affected", qty(summary.affectedQuantity)], ["Customer orders at risk", String(summary.customerOrdersAtRisk)]].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-surface p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold">{value}</p></div>
          ))}
        </div>
      )}
      <EnterpriseDataGrid<HoldRow>
        aria-label="Production holds" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "ACTIVE" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading holds" rows={8} />}
        errorContent={<ErrorState title="Could not load holds" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="Nothing on hold" description="Every manufacturing order is free to run. Put an order on hold from its own page." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${HOLDS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number} · {row.orderNumber}</span><StatusBadge tone={SEVERITY_TONE[row.severity]}>{row.severity.toLowerCase()}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.reasons.join(", ")} · {duration(row.durationHours)}{row.overdue ? " · overdue" : ""}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
