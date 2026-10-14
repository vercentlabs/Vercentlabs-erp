"use client";

// Material Issues: every issue note with its order, source, materials and state. Views by state; search by note, order or material. A row
// opens the note. New notes start from a manufacturing order (its Materials tab), so the materials come from what the order may issue.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr } from "@/features/manufacturing/orders/api/mo-api";
import { ISSUE_TONE, MI_BASE, listIssues, type IssueListRow } from "../api/mi-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "DRAFT", label: "Draft" }, { id: "PENDING_APPROVAL", label: "Pending approval" }, { id: "READY_TO_POST", label: "Ready to post" },
  { id: "POSTED", label: "Posted" }, { id: "RECOVERY_REQUIRED", label: "Recovery required" }, { id: "CANCELLED", label: "Cancelled" }];

export function MaterialIssueListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: view === "all" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-issues", filters), queryFn: () => listIssues(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<IssueListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Issue note", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "order", header: "Manufacturing order", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.orderNumber}</span><span className="text-xs text-text-muted">{row.original.finishedItem}</span></span> },
    { id: "materials", header: "Materials", cell: ({ row }) => <span className="text-sm">{row.original.summary ?? "—"}</span> },
    { id: "from", accessorKey: "warehouse", header: "From" },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={ISSUE_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
    { id: "when", header: "Issued", cell: ({ row }) => (row.original.postedAt ? <span className="flex flex-col"><span>{formatDateTime(row.original.postedAt)}</span><span className="text-xs text-text-muted">{row.original.issuedBy}</span></span>
      : <span className="text-text-muted">Created {formatDateTime(row.original.createdAt)}</span>) },
    { id: "cost", header: "Value", cell: ({ row }) => (row.original.totalCost === null ? "" : row.original.costStatus === "MISSING" ? <StatusBadge tone="danger">Cost missing</StatusBadge> : inr(row.original.totalCost)) },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to material issues" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Material Issues", description: "Material moved from the warehouse to production, note by note: what, from where, for which order, by whom, with which batches and serial numbers. Start a note from a manufacturing order's Materials tab." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search material issues" placeholder="Note, order or material" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<IssueListRow>
        aria-label="Material issues" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading material issues" rows={8} />}
        errorContent={<ErrorState title="Could not load material issues" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No material issues yet" description="Open a released manufacturing order and use Issue materials on its Materials tab." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${MI_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={ISSUE_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.orderNumber} · {row.summary}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
