"use client";

// CRM Follow-ups: the salesperson's daily action queue. Due Today is the
// default: who to contact today, how, about which record and why.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { Download, Filter, Plus } from "lucide-react";
import {
  AlertDialog, Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  bulkFollowUpAction, errorMessage, followUpExportUrl, getFollowUpOptions, getFollowUpSummary, listFollowUps,
  type FollowUp, type FollowUpBulkResult, type FollowUpListFilters, type FollowUpOptions, type FollowUpViewKey,
} from "../api/follow-ups-api";
import { CompleteFollowUpDialog, ScheduleFollowUpDialog } from "../components/FollowUpDialogs";
import { ErrorBanner, FollowUpStatusBadge, FollowUpWhen, RELATED_LABELS, STATUS_LABELS, TYPE_LABELS } from "../follow-up-format";

const PAGE_SIZE = 25;
const ANY = "any";
const LIVE = { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: 60_000, refetchIntervalInBackground: false } as const;

type FilterKey = "status" | "type" | "assigneeId" | "relatedType" | "createdBy" | "completedBy" | "outcome";
const FILTER_KEYS: FilterKey[] = ["status", "type", "assigneeId", "relatedType", "createdBy", "completedBy", "outcome"];
const FILTER_NAMES: Record<FilterKey, string> = { status: "Status", type: "Type", assigneeId: "Assigned to", relatedType: "About", createdBy: "Created by", completedBy: "Completed by", outcome: "Outcome" };
type MoreKey = "accountId" | "dueFrom" | "dueTo";
const NO_MORE: Record<MoreKey, string> = { accountId: "", dueFrom: "", dueTo: "" };
type BulkKind = "reassign" | "reschedule" | "cancel";

export function FollowUpListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const initialView = (params.get("view") as FollowUpViewKey) || (params.get("due") === "overdue" ? "overdue" : params.get("due") === "today" ? "due_today" : "due_today");
  const [view, setViewState] = useState<FollowUpViewKey>(initialView);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Record<FilterKey, string>);
  const [more, setMoreState] = useState<Record<MoreKey, string>>({ accountId: params.get("accountId") ?? "", dueFrom: params.get("dueFrom") ?? "", dueTo: params.get("dueTo") ?? "" });
  const [moreDraft, setMoreDraft] = useState(more);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [sorting, setSortingState] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [bulkResult, setBulkResult] = useState<FollowUpBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restart = () => { setPageIndex(0); setSelection({}); };
  const setView = (next: FollowUpViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Record<FilterKey, string>) => { setFiltersState(next); restart(); };
  const setMore = (next: Record<MoreKey, string>) => { setMoreState(next); setMoreDraft(next); restart(); };
  useEffect(() => {
    const timer = setTimeout(() => { setSubmittedSearch(search.trim()); setPageIndex(0); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const summaryQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "summary"), queryFn: getFollowUpSummary, ...LIVE });
  const listFilters: FollowUpListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc ? "desc" : "asc",
  }), [view, submittedSearch, filters, more, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "follow-ups", listFilters, pageIndex),
    queryFn: () => listFollowUps({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const refresh = (result?: FollowUpBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
  };

  const columns = useMemo<ColumnDef<FollowUp, unknown>[]>(() => [
    { id: "scheduledAt", accessorKey: "scheduledAt", header: "When", cell: ({ row }) => <FollowUpWhen followUp={row.original} /> },
    {
      id: "who", header: "Contact", enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-40 flex-col">
          <span className="font-medium">{row.original.contactName ?? row.original.relatedName ?? "—"}</span>
          <span className="text-xs text-text-muted">{row.original.accountName ?? ""}</span>
        </span>
      ),
    },
    { id: "type", accessorKey: "type", header: "How", enableSorting: false, cell: ({ row }) => TYPE_LABELS[row.original.type] },
    {
      id: "subject", accessorKey: "subject", header: "Why",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className={row.original.status === "completed" ? "text-text-secondary line-through" : ""}>{row.original.subject}</span>
          <span className="text-xs text-text-muted">{row.original.number}</span>
        </span>
      ),
    },
    {
      id: "related", header: "Record", enableSorting: false,
      cell: ({ row }) => row.original.relatedHref ? (
        <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation" className="flex flex-col">
          <Link className="hover:underline" href={row.original.relatedHref}>{row.original.relatedName}</Link>
          <span className="text-xs text-text-muted">{RELATED_LABELS[row.original.relatedType ?? ""]}</span>
        </span>
      ) : "",
    },
    { id: "status", accessorKey: "status", header: "Status", enableSorting: false, cell: ({ row }) => <span className="flex flex-col gap-1"><FollowUpStatusBadge status={row.original.status} />{row.original.outcomeLabel && <span className="text-xs text-text-muted">{row.original.outcomeLabel}</span>}</span> },
    { id: "assignee", accessorKey: "assignedName", header: "Assigned to", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.assignedName ?? "Unassigned"}</span> },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => row.original.status === "scheduled" && can?.complete ? (
        <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation">
          <Button variant="secondary" size="compact" onPress={() => setCompleting(row.original)}>Complete</Button>
        </span>
      ) : null,
    },
  ], [can?.complete]);

  const withAny = (list: Array<{ value: string; label: string }>, label: string) => [{ value: ANY, label }, ...list];
  const people = (options?.users ?? []).map((user) => ({ value: user.id, label: user.name }));
  const labelOf = (key: FilterKey, value: string) => {
    if (key === "status") return value === "overdue" ? "Overdue" : STATUS_LABELS[value as FollowUp["status"]] ?? value;
    if (key === "type") return TYPE_LABELS[value as FollowUp["type"]] ?? value;
    if (key === "relatedType") return RELATED_LABELS[value] ?? value;
    if (key === "outcome") return options?.outcomes.find((entry) => entry.code === value)?.label ?? value;
    if (value === "me") return "Me";
    return people.find((entry) => entry.value === value)?.label ?? "Chosen person";
  };
  const activeFilters: ActiveFilter[] = [
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Account: ${accountName ?? "chosen account"}` }] : []),
    ...(more.dueFrom || more.dueTo ? [{ id: "more:due", label: `Date: ${more.dueFrom ? formatDate(more.dueFrom) : "any"} – ${more.dueTo ? formatDate(more.dueTo) : "any"}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "more:due") setMore({ ...more, dueFrom: "", dueTo: "" });
    else if (id === "more:accountId") setMore({ ...more, accountId: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const draft = (key: MoreKey) => (value: string) => setMoreDraft((current) => ({ ...current, [key]: value }));
  const summary = summaryQuery.data;
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "due_today";

  if (optionsQuery.isError && !workspace.permissions.includes("crm.follow_ups.view") && !workspace.permissions.includes("crm.activities.manage"))
    return <PermissionState title="You don't have access to follow-ups" description="Ask an administrator for the View follow-ups permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.</p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => <p key={entry.followUpId} className="text-text-secondary">{entry.message}</p>)}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={error ?? (optionsQuery.isError ? "The follow-up filters could not be loaded. Refresh the page." : null)} />

      <EnterpriseListPage
        header={{
          title: "Follow-ups",
          description: "Who to contact, how, for which deal and why: overdue first, then today, then what is coming up.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />Schedule follow-up</Button> : undefined,
          secondaryActions: can?.export ? <a className={buttonVariants({ variant: "outline" })} href={followUpExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" />Export</a> : undefined,
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as FollowUpViewKey) } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search follow-ups" placeholder="Search subject, contact, account or number" className="w-full sm:w-80" value={search} onChange={setSearch}
                onSubmit={(value) => { setSubmittedSearch(value.trim()); setPageIndex(0); }} />
              {options && (
                <>
                  <Select aria-label="Type" size="compact" selectedKey={filters.type} onSelectionChange={(key) => setFilters({ ...filters, type: String(key) })}
                    options={withAny(options.types.map((entry) => ({ value: entry.code, label: entry.label })), "Any type")} />
                  <Select aria-label="Status" size="compact" selectedKey={filters.status} onSelectionChange={(key) => setFilters({ ...filters, status: String(key) })}
                    options={withAny([...options.statuses.map((entry) => ({ value: entry.code, label: entry.label })), { value: "overdue", label: "Overdue" }], "Any status")} />
                  <Select aria-label="Assigned to" size="compact" selectedKey={filters.assigneeId} onSelectionChange={(key) => setFilters({ ...filters, assigneeId: String(key) })}
                    options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                  <Select aria-label="About" size="compact" selectedKey={filters.relatedType} onSelectionChange={(key) => setFilters({ ...filters, relatedType: String(key) })}
                    options={withAny(options.relatedTypes.map((entry) => ({ value: entry.code, label: entry.label })), "Any record")} />
                  <PopoverTrigger>
                    <Button variant="outline" size="compact"><Filter className="size-4" aria-hidden="true" />Account, people and dates</Button>
                    <Popover placement="bottom start">
                      <div className="grid w-[min(24rem,calc(100vw-4rem))] grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <AccountPicker label="Account" description="Follow-ups on the account, its opportunities and its contacts." value={moreDraft.accountId || null}
                            onChange={(id, name) => { draft("accountId")(id ?? ""); setAccountName(name); }} />
                        </div>
                        <Select label="Created by" selectedKey={filters.createdBy} onSelectionChange={(key) => setFilters({ ...filters, createdBy: String(key) })} options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                        <Select label="Completed by" selectedKey={filters.completedBy} onSelectionChange={(key) => setFilters({ ...filters, completedBy: String(key) })} options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                        <Select label="Outcome" className="col-span-2" selectedKey={filters.outcome} onSelectionChange={(key) => setFilters({ ...filters, outcome: String(key) })}
                          options={withAny(options.outcomes.map((entry) => ({ value: entry.code, label: entry.label })), "Any outcome")} />
                        <DateInput label="From" value={moreDraft.dueFrom} onChange={draft("dueFrom")} />
                        <DateInput label="To" value={moreDraft.dueTo} onChange={draft("dueTo")} />
                        <div className="col-span-2 flex justify-end gap-2">
                          <Button variant="ghost" size="compact" onPress={() => setMore(NO_MORE)}>Clear</Button>
                          <Button variant="primary" size="compact" onPress={() => setMore(moreDraft)}>Apply</Button>
                        </div>
                      </div>
                    </Popover>
                  </PopoverTrigger>
                </>
              )}
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: () => { setMore(NO_MORE); setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Record<FilterKey, string>); } } : undefined}
        bulkActionBar={selectedIds.length ? {
          selectedCount: selectedIds.length,
          onClearSelection: () => setSelection({}),
          actions: (
            <>
              {can?.reassign && <Button variant="secondary" size="compact" onPress={() => setBulk("reassign")}>Reassign</Button>}
              {can?.reschedule && <Button variant="secondary" size="compact" onPress={() => setBulk("reschedule")}>Reschedule</Button>}
              {can?.cancel && <Button variant="secondary" size="compact" onPress={() => setBulk("cancel")}>Cancel</Button>}
            </>
          ),
        } : undefined}
      >
        <div className="flex flex-col gap-4">
          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard label="Due today" value={summary.dueToday} onPress={() => setView("due_today")} />
              <SummaryCard label="Overdue" value={summary.overdue} onPress={() => setView("overdue")} />
              <SummaryCard label="Upcoming" value={summary.upcoming} onPress={() => setView("upcoming")} />
              {summary.teamOverdue !== null && <SummaryCard label="Team overdue" value={summary.teamOverdue} onPress={() => { setView("team"); setFilters({ ...filters, status: "overdue" }); }} />}
            </div>
          )}
          <EnterpriseDataGrid<FollowUp>
            aria-label="Follow-ups"
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading follow-ups" rows={8} onRetry={() => void listQuery.refetch()} />}
            errorContent={<ErrorState title="Could not load follow-ups" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
            emptyContent={<EmptyState title="Nobody to contact today" description="Schedule a follow-up from a lead, account, contact or opportunity, or here."
              action={can?.create ? { label: "Schedule follow-up", onPress: () => setCreating(true) } : undefined} />}
            noResultsContent={<NoResultsState title="No follow-ups here" description="Try a different view, search or filter." />}
            manualSorting
            sorting={sorting}
            onSortingChange={(next) => { setSortingState(next); restart(); }}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            totalRowCount={total}
            onPageChange={setPageIndex}
            enableRowSelection
            rowSelection={selection}
            onRowSelectionChange={setSelection}
            onRowClick={(row) => router.push(`/crm/follow-ups/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-sm"><FollowUpWhen followUp={row} /> · {TYPE_LABELS[row.type]}</span>
                <span className="font-medium">{row.contactName ?? row.relatedName}</span>
                <span className="text-xs text-text-secondary">{row.subject}{row.accountName ? ` · ${row.accountName}` : ""}</span>
              </div>
            )}
          />
        </div>
      </EnterpriseListPage>

      {options && creating && <ScheduleFollowUpDialog isOpen onOpenChange={setCreating} options={options} onSaved={(saved) => { refresh(); router.push(`/crm/follow-ups/${saved.id}`); }} />}
      {options && completing && <CompleteFollowUpDialog isOpen onOpenChange={(isOpen) => !isOpen && setCompleting(null)} followUp={completing} options={options} onDone={() => refresh()} />}
      {options && bulk && <BulkDialog kind={bulk} ids={selectedIds} options={options} onClose={() => setBulk(null)} onDone={refresh} onError={setError} />}
    </div>
  );
}

function SummaryCard({ label, value, onPress }: { label: string; value: number; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} className="rounded-[var(--radius-card)] text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
      <MetricCard label={label} value={value} />
    </button>
  );
}

// No bulk complete: each follow-up is a conversation with its own outcome.
function BulkDialog({ kind, ids, options, onClose, onDone, onError }: {
  kind: BulkKind; ids: string[]; options: FollowUpOptions; onClose: () => void; onDone: (result: FollowUpBulkResult) => void; onError: (message: string) => void;
}) {
  const [assignedTo, setAssignedTo] = useState("");
  const [shiftDays, setShiftDays] = useState("1");
  const [scheduledDate, setScheduledDate] = useState("");
  const [reason, setReason] = useState("");
  const count = `${ids.length} ${ids.length === 1 ? "follow-up" : "follow-ups"}`;
  const mutation = useMutation({
    mutationFn: () => bulkFollowUpAction({
      action: kind, followUpIds: ids, reason: reason || undefined,
      ...(kind === "reassign" ? { assignedTo } : kind === "reschedule" ? (scheduledDate ? { scheduledDate } : { shiftDays: Number(shiftDays) }) : {}),
    }),
    onSuccess: (result) => { onDone(result); onClose(); },
    onError: (failure) => { onError(errorMessage(failure)); onClose(); },
  });
  if (kind === "cancel")
    return <AlertDialog isOpen onOpenChange={(open) => !open && onClose()} tone="danger" title={`Cancel ${count}?`} description="Cancelled follow-ups are kept with their history; their reminders are cancelled."
      confirmLabel="Cancel follow-ups" isConfirming={mutation.isPending} onConfirm={() => mutation.mutate()} />;
  const valid = kind === "reassign" ? Boolean(assignedTo) : Boolean(scheduledDate) || (Number.isFinite(Number(shiftDays)) && Number(shiftDays) !== 0);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={kind === "reassign" ? `Reassign ${count}` : `Reschedule ${count}`}>
      <div className="flex flex-col gap-4">
        {kind === "reassign" ? (
          <Select label="Assign to" isRequired selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
            options={options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Move by days" inputMode="numeric" description="Negative moves earlier." value={shiftDays} onChange={setShiftDays} isDisabled={Boolean(scheduledDate)} />
            <DateInput label="Or set one date" value={scheduledDate} onChange={setScheduledDate} />
          </div>
        )}
        <TextField label="Reason" description="Optional. Kept in each follow-up's history." value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!valid}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}
