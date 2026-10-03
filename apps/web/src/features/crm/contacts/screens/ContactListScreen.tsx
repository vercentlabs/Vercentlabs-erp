"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Download, Plus, Upload } from "lucide-react";
import {
  Badge, Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { FollowUpCell } from "@/features/crm/leads/lead-format";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  contactExportUrl, getContactOptions, listContacts, type Contact, type ContactBulkResult, type ContactListFilters, type ContactStatus, type ContactViewKey,
} from "../api/contacts-api";
import { ContactStatusBadge, ErrorBanner, LIVE_CONTACT_QUERY, RoleBadge, bestPhone } from "../contact-format";
import { AssignContactsDialog, ContactStatusDialog } from "../components/ContactActionDialogs";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.contacts.columns";

const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "accountName", label: "Company" },
  { id: "jobTitle", label: "Job title" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "role", label: "Role" },
  { id: "ownerName", label: "Owner" },
  { id: "nextFollowUpAt", label: "Next follow-up" },
  { id: "lastActivityAt", label: "Last activity", hiddenByDefault: true },
  { id: "department", label: "Department", hiddenByDefault: true },
  { id: "sourceName", label: "Source", hiddenByDefault: true },
  { id: "teamName", label: "Team", hiddenByDefault: true },
  { id: "tags", label: "Tags", hiddenByDefault: true },
  { id: "createdAt", label: "Created", hiddenByDefault: true },
];
const DEFAULT_VISIBILITY: VisibilityState = Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column.id, !column.hiddenByDefault]));

function storedVisibility(): VisibilityState {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;
  try {
    const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    return stored ? { ...DEFAULT_VISIBILITY, ...JSON.parse(stored) } : DEFAULT_VISIBILITY;
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

type FilterKey = "ownerId" | "role" | "department" | "sourceId" | "isDecisionMaker" | "isPrimary";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { ownerId: ANY, role: ANY, department: ANY, sourceId: ANY, isDecisionMaker: ANY, isPrimary: ANY };
const FILTER_NAMES: Record<FilterKey, string> = { ownerId: "Owner", role: "Role", department: "Department", sourceId: "Source", isDecisionMaker: "Decision maker", isPrimary: "Primary contact" };

type DialogKind = "assign" | ContactStatus | null;

export function ContactListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [view, setViewState] = useState<ContactViewKey>((params.get("view") as ContactViewKey) || "all");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(() => ({
    ...NO_FILTERS,
    ...Object.fromEntries((Object.keys(NO_FILTERS) as FilterKey[]).filter((key) => params.get(key)).map((key) => [key, params.get(key) as string])),
  }));
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(storedVisibility);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [bulkResult, setBulkResult] = useState<ContactBulkResult | null>(null);

  const restart = () => { setPageIndex(0); setSelection({}); };
  const setView = (next: ContactViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Filters) => { setFiltersState(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  const setSubmittedSearch = (next: string) => {
    if (next === submittedSearch) return;
    setSubmittedSearchState(next);
    restart();
  };
  const changeVisibility = (next: VisibilityState) => {
    setVisibility(next);
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Column choices are a convenience; nothing to do if storage is unavailable.
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact-options"), queryFn: getContactOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const listFilters: ContactListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    accountId: account?.id,
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, account, sorting]);

  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contacts", "list", listFilters, pageIndex),
    queryFn: () => listContacts({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE_CONTACT_QUERY,
  });
  const contacts = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const can = options?.capabilities;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  const columns = useMemo<ColumnDef<Contact, unknown>[]>(() => [
    {
      id: "displayName",
      accessorKey: "displayName",
      header: "Contact",
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-44 flex-col">
          <span className="flex items-center gap-1 font-medium text-text">
            {row.original.displayName}
            {row.original.isPrimary && <Badge tone="brand">Primary</Badge>}
            {row.original.isDecisionMaker && <Badge tone="success">DM</Badge>}
          </span>
          <span className="text-xs whitespace-nowrap text-text-muted">{row.original.contactNumber}</span>
        </span>
      ),
    },
    { id: "accountName", accessorKey: "accountName", header: "Company", cell: ({ row }) => row.original.accountName ?? <span className="text-text-muted">No company</span> },
    { id: "jobTitle", accessorKey: "jobTitle", header: "Job title", cell: ({ row }) => row.original.jobTitle ?? "" },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <ContactStatusBadge status={row.original.status} /> },
    { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.email ?? ""}</span> },
    { id: "phone", header: "Phone", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{bestPhone(row.original) ?? ""}</span> },
    { id: "role", header: "Role", enableSorting: false, cell: ({ row }) => <RoleBadge label={row.original.roleLabel} /> },
    { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    { id: "nextFollowUpAt", accessorKey: "nextFollowUpAt", header: "Next follow-up", cell: ({ row }) => <FollowUpCell value={row.original.nextFollowUpAt} /> },
    { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => row.original.lastActivityAt ? formatDate(row.original.lastActivityAt) : <span className="text-text-muted">Never</span> },
    { id: "department", accessorKey: "department", header: "Department", cell: ({ row }) => row.original.department ?? "" },
    { id: "sourceName", header: "Source", enableSorting: false, cell: ({ row }) => row.original.sourceName ?? "" },
    { id: "teamName", header: "Team", enableSorting: false, cell: ({ row }) => row.original.teamName ?? "" },
    { id: "tags", header: "Tags", enableSorting: false, cell: ({ row }) => row.original.tags.map((tag) => tag.name).join(", ") },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
  ], []);

  const refresh = (result?: ContactBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
  };

  const filterOptions = (list: Array<{ value: string; label: string }>, anyLabel: string) => [{ value: ANY, label: anyLabel }, ...list];
  const ownerOptions = options
    ? filterOptions([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))], "Any owner")
    : [];
  const labelOf = (key: FilterKey, value: string) => {
    if (!options) return value;
    if (key === "ownerId") return ownerOptions.find((entry) => entry.value === value)?.label ?? value;
    if (key === "role") return options.roles.find((entry) => entry.code === value)?.label ?? value;
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? value;
    if (key === "isDecisionMaker" || key === "isPrimary") return value === "yes" ? "Yes" : "No";
    return value;
  };
  const activeFilters: ActiveFilter[] = [
    ...(Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(account ? [{ id: "account", label: `Company: ${account.name}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "account") { setAccount(null); restart(); } else setFilters({ ...filters, [id]: ANY });
  };
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "all";

  if (optionsQuery.isError && !workspace.permissions.includes("crm.contacts.view"))
    return <PermissionState title="You don't have access to contacts" description="Ask an administrator for the View contacts permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.</p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => <p key={entry.contactId} className="text-text-secondary">{entry.message}</p>)}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={optionsQuery.isError ? "The contact filters could not be loaded. Refresh the page." : null} />

      <EnterpriseListPage
        header={{
          title: "Contacts",
          description: "The people you deal with — at your accounts, or on their own until you know their company.",
          primaryAction: can?.create ? <LinkButton href="/crm/contacts/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New contact</LinkButton> : undefined,
          secondaryActions: (
            <>
              {can?.import && <LinkButton href="/crm/contacts/import" variant="outline"><Upload className="size-4" aria-hidden="true" />Import</LinkButton>}
              {can?.export && (
                <a className={buttonVariants({ variant: "outline" })} href={contactExportUrl(listFilters)} download>
                  <Download className="size-4" aria-hidden="true" />Export
                </a>
              )}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as ContactViewKey) } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search contacts" placeholder="Search name, email, phone, company or job title" className="w-full sm:w-80" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <>
                  <div className="w-full sm:w-56">
                    <AccountPicker label="" placeholder="Any company" value={account?.id ?? null}
                      onChange={(id, name) => { setAccount(id ? { id, name: name ?? "Company" } : null); restart(); }} />
                  </div>
                  <Select aria-label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  <Select aria-label="Role" size="compact" selectedKey={filters.role} onSelectionChange={(key) => setFilters({ ...filters, role: String(key) })}
                    options={filterOptions(options.roles.map((entry) => ({ value: entry.code, label: entry.label })), "Any role")} />
                  {options.departments.length > 0 && (
                    <Select aria-label="Department" size="compact" selectedKey={filters.department} onSelectionChange={(key) => setFilters({ ...filters, department: String(key) })}
                      options={filterOptions(options.departments.map((entry) => ({ value: entry, label: entry })), "Any department")} />
                  )}
                  <Select aria-label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={filterOptions(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select aria-label="Primary contact" size="compact" selectedKey={filters.isPrimary} onSelectionChange={(key) => setFilters({ ...filters, isPrimary: String(key) })}
                    options={filterOptions([{ value: "yes", label: "Primary contacts" }, { value: "no", label: "Not primary" }], "Primary or not")} />
                </>
              )}
            </>
          ),
          end: (
            <PopoverTrigger>
              <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" />Columns</Button>
              <Popover>
                <div className="flex flex-col gap-2 p-1">
                  <p className="text-xs font-medium text-text-secondary">Show columns</p>
                  {OPTIONAL_COLUMNS.map((column) => (
                    <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => changeVisibility({ ...visibility, [column.id]: checked })}>{column.label}</Checkbox>
                  ))}
                </div>
              </Popover>
            </PopoverTrigger>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: () => { setAccount(null); setFilters(NO_FILTERS); } } : undefined}
        bulkActionBar={selectedIds.length ? {
          selectedCount: selectedIds.length,
          onClearSelection: () => setSelection({}),
          actions: (
            <>
              {(can?.assign || can?.reassign) && <Button variant="secondary" size="compact" onPress={() => setDialog("assign")}>Assign</Button>}
              {can?.archive && view !== "archived" && <Button variant="secondary" size="compact" onPress={() => setDialog("inactive")}>Deactivate</Button>}
              {can?.archive && view !== "archived" && <Button variant="secondary" size="compact" onPress={() => setDialog("archived")}>Archive</Button>}
              {can?.archive && (view === "archived" || view === "inactive") && <Button variant="secondary" size="compact" onPress={() => setDialog("active")}>Reactivate</Button>}
              {can?.export && (
                <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={contactExportUrl({ view: view === "archived" ? "archived" : "all", ids: selectedIds.join(",") })} download>
                  Export selected
                </a>
              )}
            </>
          ),
        } : undefined}
      >
        <EnterpriseDataGrid<Contact>
          aria-label="Contacts"
          columns={columns}
          data={contacts}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : contacts.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading contacts" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load contacts" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={
            <EmptyState title="No contacts yet" description="Add the people you deal with, import a list, or convert a qualified lead."
              action={can?.create ? { label: "New contact", onPress: () => router.push("/crm/contacts/new") } : undefined} />
          }
          noResultsContent={<NoResultsState title="No contacts match" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          enableRowSelection
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          columnVisibility={visibility}
          onColumnVisibilityChange={changeVisibility}
          onRowClick={(row) => router.push(`/crm/contacts/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{row.displayName}</span>
              <span className="text-xs text-text-muted">{[row.jobTitle, row.accountName].filter(Boolean).join(" · ") || "No company"}</span>
              <span className="flex flex-wrap gap-1"><ContactStatusBadge status={row.status} /><RoleBadge label={row.roleLabel} /></span>
              <span className="text-xs text-text-secondary">{[row.email, bestPhone(row)].filter(Boolean).join(" · ")}</span>
            </div>
          )}
        />
      </EnterpriseListPage>

      {options && (
        <>
          <AssignContactsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} contactIds={selectedIds} options={options} onDone={refresh} />
          {(dialog === "active" || dialog === "inactive" || dialog === "archived") && (
            <ContactStatusDialog isOpen onOpenChange={(open) => !open && setDialog(null)} contactIds={selectedIds} status={dialog} onDone={refresh} />
          )}
        </>
      )}
    </div>
  );
}
