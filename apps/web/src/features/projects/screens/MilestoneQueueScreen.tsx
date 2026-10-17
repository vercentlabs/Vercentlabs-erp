"use client";

// Milestones across every project the person may see: all of them (but the cancelled), their own, what is due soon or overdue, what waits for internal approval
// or the customer's acceptance, what is blocked and what was completed — with search, sorting, paging and export.
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  APPROVAL_TONE, MILESTONES_BASE, MILESTONE_TONE, PRIORITY_LABEL, dateLabel, dueLabel, errorMessage, errorStatus, listMilestoneQueue, milestoneExportHref, type MilestoneRow,
} from "../api/projects-api";
import { PriorityBadge } from "../priority/Priority";
import { PRIORITIES } from "../priority/priority-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "mine", label: "My milestones" }, { id: "upcoming", label: "Due soon" }, { id: "overdue", label: "Overdue" },
  { id: "pending_approval", label: "Pending approval" }, { id: "pending_customer", label: "Pending customer" }, { id: "blocked", label: "Blocked" }, { id: "completed", label: "Completed" }];
const SORT_ID: Record<string, string> = { code: "code", project: "project", status: "status", priority: "priority", due: "due" };
const EMPTY: Record<string, string> = { all: "No milestones yet.", mine: "You own no open milestones.", upcoming: "Nothing is due soon.", overdue: "Nothing is overdue.",
  pending_approval: "Nothing waits for internal approval.", pending_customer: "Nothing waits for a customer's decision.", blocked: "Nothing is blocked.", completed: "No milestone has been completed yet." };

export function MilestoneQueueScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(() => (VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "all"));
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<string | null>(null);
  const term = useDebouncedValue(search);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const urlView = params.get("view");
  const [seenUrlView, setSeenUrlView] = useState(urlView);
  if (urlView !== seenUrlView) {
    setSeenUrlView(urlView);
    if (urlView && VIEWS.some((row) => row.id === urlView)) { setView(urlView); setPage(0); }
  }
  const query = { view, search: term || undefined, priority: priority ?? undefined, sort: sorting[0] ? SORT_ID[sorting[0].id] : undefined, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined, page: page + 1, pageSize: 25 };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestone-queue", query), queryFn: () => listMilestoneQueue(query), placeholderData: (previous) => previous, retry: false });
  const rows = list.data?.rows ?? [];
  const columns = useMemo<ColumnDef<MilestoneRow, unknown>[]>(() => [
    { id: "code", accessorKey: "code", header: "Milestone", enableHiding: false, cell: ({ row }) => (
      <span className="flex min-w-0 flex-col"><span className="truncate font-medium text-text" title={row.original.name}>{row.original.name}</span>
        <span className="text-xs text-text-muted">{row.original.code}</span></span>) },
    { id: "project", accessorKey: "projectCode", header: "Project", cell: ({ row }) => <span className="flex min-w-0 flex-col"><span>{row.original.projectCode}</span>
      {row.original.projectName && <span className="truncate text-xs text-text-muted">{row.original.projectName}</span>}</span> },
    { id: "owner", accessorKey: "owner", header: "Owner", enableSorting: false, cell: ({ row }) => row.original.owner ?? "—" },
    { id: "due", accessorKey: "dueDate", header: "Due", cell: ({ row }) => <span className="flex flex-col"><span>{dateLabel(row.original.dueDate)}</span>
      {row.original.rescheduled && <span className="text-xs text-text-muted">{`was ${dateLabel(row.original.originalDueDate)}`}</span>}
      {dueLabel(row.original) && <span className={`text-xs ${row.original.overdue ? "text-danger" : "text-text-muted"}`}>{dueLabel(row.original)}</span>}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={MILESTONE_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "approval", accessorKey: "approvalStatus", header: "Approval", enableSorting: false, cell: ({ row }) => (row.original.approvalStatus === "NOT_REQUIRED" ? <span className="text-text-muted">None</span>
      : <StatusBadge tone={APPROVAL_TONE[row.original.approvalStatus]}>{row.original.approvalLabel}</StatusBadge>) },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
  ], []);
  if (list.error && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to milestones" description="Ask an administrator for access to project milestones." />;
  const select = (id: string) => { setView(id); setPage(0); router.replace(`${pathname}?view=${id}`); };
  return (
    <EnterpriseListPage
      header={{ title: "Milestones", description: "The checkpoints of every project you can see: who owns each, when it is due and what it waits for.",
        secondaryActions: list.data?.can.export ? <LinkButton variant="secondary" href={milestoneExportHref({ view, search: term || undefined })}>Export</LinkButton> : undefined }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: select }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search milestones" placeholder="Milestone, code or project" className="w-full sm:w-80" value={search} onChange={(value) => { setSearch(value); setPage(0); }} />
          <Select aria-label="Priority" label="Priority" size="compact" placeholder="Any priority" selectedKey={priority} onSelectionChange={(key) => { setPriority(key ? String(key) : null); setPage(0); }}
            options={[{ value: "URGENT,HIGH", label: "Urgent and High" }, ...PRIORITIES.map((level) => ({ value: level, label: PRIORITY_LABEL[level] }))]} />
        </>
      ) }}
    >
      <EnterpriseDataGrid<MilestoneRow>
        aria-label="Milestones" columns={columns} data={rows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (term ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading milestones" rows={8} />}
        errorContent={<ErrorState title="Could not load milestones" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title={EMPTY[view] ?? "No milestones."} description="Milestones are planned on each project's Milestones tab." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        sorting={sorting} onSortingChange={(next) => { setSorting(next); setPage(0); }} manualSorting
        pageIndex={page} pageSize={25} pageCount={list.data?.pages ?? 1} totalRowCount={list.data?.total ?? 0} onPageChange={setPage}
        onRowClick={(row) => router.push(`${MILESTONES_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-medium">{row.name}</span><StatusBadge tone={MILESTONE_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{[row.code, row.projectCode, row.owner, dateLabel(row.dueDate), dueLabel(row)].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
