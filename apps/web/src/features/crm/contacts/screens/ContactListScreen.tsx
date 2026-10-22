"use client";

// Contacts: the people you deal with. The common views are chips (My contacts, Decision makers, Without company) with the rest under More
// views; one Filters button holds every filter, each applying the moment it changes. Opened from a company (?accountId=), a "Company: name"
// chip shows. Hovering a row offers its email and phone as links. New contact is the primary action; Import and Export are in the "…" menu.
import { useEffect, useMemo, useState } from "react";
import { CustomFieldFilters, customFilterParams } from "@/features/crm/shared/ui/CustomFields";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import { listTags } from "@/features/crm/shared/marketing-api";
import { SavedViews } from "@/features/crm/shared/ui/SavedViews";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Mail, Phone, Plus } from "lucide-react";
import {
  Badge, Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { FollowUpCell } from "@/features/crm/leads/lead-format";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ON_SCREEN_EXPORT_LIMIT, startExport } from "@/features/crm/shared/data-jobs-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  contactExportUrl, getContactOptions, listContacts, type Contact, type ContactBulkResult, type ContactListFilters, type ContactStatus, type ContactViewKey,
} from "../api/contacts-api";
import { ContactStatusBadge, ErrorBanner, LIVE_CONTACT_QUERY, RoleBadge, bestPhone } from "../contact-format";
import { AssignContactsDialog, ContactStatusDialog } from "../components/ContactActionDialogs";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.contacts.columns.v2";
const PINNED_VIEWS = ["mine", "decision_makers", "without_company"];

const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "accountName", label: "Company" },
  { id: "jobTitle", label: "Job title" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "role", label: "Role" },
  { id: "ownerName", label: "Owner" },
  { id: "nextFollowUpAt", label: "Next follow-up" },
  { id: "status", label: "Status", hiddenByDefault: true },
  { id: "lastActivityAt", label: "Last activity", hiddenByDefault: true },
  { id: "department", label: "Department", hiddenByDefault: true },
  { id: "sourceName", label: "Source", hiddenByDefault: true },
  { id: "teamName", label: "Team", hiddenByDefault: true },
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

type FilterKey = "ownerId" | "role" | "department" | "sourceId" | "isDecisionMaker" | "isPrimary" | "tagId";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { ownerId: ANY, role: ANY, department: ANY, sourceId: ANY, isDecisionMaker: ANY, isPrimary: ANY, tagId: ANY };
const FILTER_NAMES: Record<FilterKey, string> = { ownerId: "Owner", role: "Role", department: "Department", sourceId: "Source", isDecisionMaker: "Decision maker", isPrimary: "Primary contact", tagId: "Tag" };

type DialogKind = "assign" | ContactStatus | null;

export function ContactListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // People who see every contact start on all contacts; everyone else on their own.
  const seesAll = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.contacts.view_all");
  const defaultView: ContactViewKey = seesAll ? "all" : "mine";
  const [view, setViewState] = useState<ContactViewKey>((params.get("view") as ContactViewKey) || (params.get("accountId") ? "all" : defaultView));
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(() => ({
    ...NO_FILTERS,
    ...Object.fromEntries((Object.keys(NO_FILTERS) as FilterKey[]).filter((key) => params.get(key)).map((key) => [key, params.get(key) as string])),
  }));
  // The organization's own fields as filters (CRM audit M4): { key: value }.
  const [customFilters, setCustomFiltersState] = useState<Record<string, string>>(() =>
    Object.fromEntries([...params].filter(([key]) => key.startsWith("cf.")).map(([key, value]) => [key.slice(3), value])));
  const [account, setAccount] = useState<{ id: string; name: string } | null>(() => {
    const id = params.get("accountId");
    return id ? { id, name: params.get("accountName") ?? "chosen company" } : null;
  });
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
  const tags = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tags"), queryFn: () => listTags(), staleTime: 60_000 });

  const listFilters: ContactListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    accountId: account?.id,
    ...customFilterParams(customFilters, ANY),
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, account, customFilters, sorting]);

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
          <span className="flex flex-wrap items-center gap-1 font-medium text-text">
            {row.original.displayName}
            {row.original.status !== "active" && <ContactStatusBadge status={row.original.status} />}
            {row.original.isPrimary && <Badge tone="brand">Primary</Badge>}
            {row.original.isDecisionMaker && <Badge tone="success">Decision maker</Badge>}
          </span>
          <span className="text-xs whitespace-nowrap text-text-muted">{row.original.contactNumber}</span>
        </span>
      ),
    },
    { id: "accountName", accessorKey: "accountName", header: "Company", cell: ({ row }) => row.original.accountName ?? <span className="text-text-muted">No company</span> },
    { id: "jobTitle", accessorKey: "jobTitle", header: "Job title", cell: ({ row }) => row.original.jobTitle ?? "" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <ContactStatusBadge status={row.original.status} /> },
    // Email and phone are links (mailto and tel); the icon shows on hover, as on the lead list.
    {
      id: "email", header: "Email", enableSorting: false,
      cell: ({ row }) => row.original.email ? (
        <a href={`mailto:${row.original.email}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-brand hover:underline">
          <Mail className="size-3.5 opacity-0 group-hover:opacity-100" aria-hidden="true" />{row.original.email}
        </a>
      ) : "",
    },
    {
      id: "phone", header: "Phone", enableSorting: false,
      cell: ({ row }) => {
        const phone = bestPhone(row.original);
        return phone ? (
          <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-brand hover:underline">
            <Phone className="size-3.5 opacity-0 group-hover:opacity-100" aria-hidden="true" />{phone}
          </a>
        ) : "";
      },
    },
    { id: "role", header: "Role", enableSorting: false, cell: ({ row }) => <RoleBadge label={row.original.roleLabel} /> },
    { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    { id: "nextFollowUpAt", accessorKey: "nextFollowUpAt", header: "Next follow-up", cell: ({ row }) => <FollowUpCell value={row.original.nextFollowUpAt} /> },
    { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => row.original.lastActivityAt ? formatDate(row.original.lastActivityAt) : <span className="text-text-muted">Never</span> },
    { id: "department", accessorKey: "department", header: "Department", cell: ({ row }) => row.original.department ?? "" },
    { id: "sourceName", header: "Source", enableSorting: false, cell: ({ row }) => row.original.sourceName ?? "" },
    { id: "teamName", header: "Team", enableSorting: false, cell: ({ row }) => row.original.teamName ?? "" },
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
    if (key === "tagId") return tags.data?.find((entry) => entry.id === value)?.name ?? value;
    if (key === "role") return options.roles.find((entry) => entry.code === value)?.label ?? value;
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? value;
    if (key === "isDecisionMaker" || key === "isPrimary") return value === "yes" ? "Yes" : "No";
    return value;
  };
  const activeFilters: ActiveFilter[] = [
    ...(Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(account ? [{ id: "account", label: `Company: ${account.name}` }] : []),
    ...Object.entries(customFilters).filter(([, value]) => value !== ANY).map(([key, value]) => {
      const field = (options?.customFields ?? []).find((entry) => entry.key === key);
      return { id: `cf.${key}`, label: `${field?.label ?? key}: ${field?.type === "checkbox" ? (value === "true" ? "Yes" : "No") : value}` };
    }),
  ];
  const removeFilter = (id: string) => {
    if (id === "account") { setAccount(null); restart(); }
    else if (id.startsWith("cf.")) { setCustomFiltersState({ ...customFilters, [id.slice(3)]: ANY }); restart(); }
    else setFilters({ ...filters, [id]: ANY });
  };
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== defaultView;
  const clearFilters = () => { setAccount(null); setCustomFiltersState({}); setFilters(NO_FILTERS); };

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
          description: "The people you deal with — at your companies, or on their own until you know their company.",
          primaryAction: can?.create ? <LinkButton href="/crm/contacts/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New contact</LinkButton> : undefined,
          secondaryActions: <MoreMenu label="More contact actions" items={[
            ...(can?.import ? [{ id: "import", label: "Import", onAction: () => router.push("/crm/data/import-export?type=contacts") }] : []),
            ...(can?.export ? [{ id: "export", label: total > ON_SCREEN_EXPORT_LIMIT ? "Export in the background" : "Export", onAction: () => { void startExport("contacts", contactExportUrl(listFilters), total, (href) => router.push(href)); } }] : []),
          ]} />,
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as ContactViewKey), pinned: PINNED_VIEWS } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search contacts" placeholder="Search name, email, phone, company or job title" className="w-full sm:min-w-64 sm:flex-1" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <FiltersPopover active={activeFilters.length} onClear={clearFilters}>
                  <div className="col-span-2">
                    <AccountPicker label="Company" placeholder="Any company" value={account?.id ?? null}
                      onChange={(id, name) => { setAccount(id ? { id, name: name ?? "Company" } : null); restart(); }} />
                  </div>
                  <Select label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  {(tags.data?.length ?? 0) > 0 && (
                    <Select label="Tag" size="compact" selectedKey={filters.tagId} onSelectionChange={(key) => setFilters({ ...filters, tagId: String(key) })}
                      options={filterOptions((tags.data ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any tag")} />
                  )}
                  <Select label="Role" size="compact" selectedKey={filters.role} onSelectionChange={(key) => setFilters({ ...filters, role: String(key) })}
                    options={filterOptions(options.roles.map((entry) => ({ value: entry.code, label: entry.label })), "Any role")} />
                  {options.departments.length > 0 && (
                    <Select label="Department" size="compact" selectedKey={filters.department} onSelectionChange={(key) => setFilters({ ...filters, department: String(key) })}
                      options={filterOptions(options.departments.map((entry) => ({ value: entry, label: entry })), "Any department")} />
                  )}
                  <Select label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={filterOptions(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select label="Primary contact" size="compact" selectedKey={filters.isPrimary} onSelectionChange={(key) => setFilters({ ...filters, isPrimary: String(key) })}
                    options={filterOptions([{ value: "yes", label: "Primary contacts" }, { value: "no", label: "Not primary" }], "Primary or not")} />
                  <CustomFieldFilters fields={options.customFields ?? []} values={customFilters} anyValue={ANY} onChange={(next) => { setCustomFiltersState(next); restart(); }} />
                </FiltersPopover>
              )}
            </>
          ),
          end: (
            <><SavedViews screen="contacts" basePath="/crm/contacts" filters={listFilters} /><span className="hidden md:flex">{/* cards below md: no columns to choose */}<PopoverTrigger>
              <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" /><span>Columns</span></Button>
              <Popover>
                <div className="flex flex-col gap-2 p-1">
                  <p className="text-xs font-medium text-text-secondary">Show columns</p>
                  {OPTIONAL_COLUMNS.map((column) => (
                    <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => changeVisibility({ ...visibility, [column.id]: checked })}>{column.label}</Checkbox>
                  ))}
                </div>
              </Popover>
            </PopoverTrigger></span></>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
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
