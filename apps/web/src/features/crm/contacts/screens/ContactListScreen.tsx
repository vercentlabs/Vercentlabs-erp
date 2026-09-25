"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  type ActiveFilter,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { ContactApiError, listContacts } from "../api/contacts-api";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import type { Contact, ContactListFilters } from "../types";

const PAGE_SIZE = 25;

export function ContactListScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.accountsManage);

  const [filters, setFilters] = useState<ContactListFilters>({ limit: PAGE_SIZE, offset: 0, accountId: searchParams.get("accountId") || undefined });
  const [searchInput, setSearchInput] = useState("");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contacts", filters),
    queryFn: () => listContacts(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof ContactListFilters>(key: K, value: ContactListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.accountId) active.push({ id: "accountId", label: "Filtered to one account" });
    if (filters.status && filters.status !== "active") active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.search) active.push({ id: "search", label: `Search: ${filters.search}` });
    return active;
  }, [filters]);

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(filters.search || filters.accountId || (filters.status && filters.status !== "active"));

  // Which company each person works for, by name (the account lookup the viewer can see).
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const accountNames = useMemo(() => new Map((optionsQuery.data?.options?.parties ?? []).map((row) => [String(row.id), String(row.name ?? "")])), [optionsQuery.data]);

  const columns: ColumnDef<Contact, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Contact",
        accessorFn: (row) => `${row.firstName} ${row.lastName || ""}`.trim(),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-text">{`${row.original.firstName} ${row.original.lastName || ""}`.trim()}</span>
            {row.original.isPrimary && <Badge tone="brand">Primary</Badge>}
          </div>
        ),
      },
      { id: "account", header: "Account", accessorFn: (row) => row.accountId ?? "", cell: ({ row }) => (row.original.accountId ? accountNames.get(row.original.accountId) || "—" : "No account") },
      { id: "designation", header: "Designation", accessorFn: (row) => row.designation || "—" },
      { id: "email", header: "Email", accessorFn: (row) => row.email || "—" },
      { id: "mobile", header: "Mobile", accessorFn: (row) => row.mobile || row.phone || "—" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
    ],
    [accountNames],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof ContactApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0 && hasFilters
          ? "no-results"
          : rows.length === 0
            ? "empty"
            : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Contacts",
        description: "People at the accounts you sell to.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/contacts/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New contact
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField
              aria-label="Search contacts"
              placeholder="Search by name…"
              value={searchInput}
              onChange={setSearchInput}
              onKeyDown={(event) => event.key === "Enter" && updateFilter("search", searchInput || undefined)}
              className="min-w-[240px]"
            />
            <Select
              aria-label="Status"
              size="compact"
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "all", label: "All" },
              ]}
              selectedKey={filters.status ?? "active"}
              onSelectionChange={(key) => updateFilter("status", String(key) as ContactListFilters["status"])}
            />
          </>
        ),
        end: <Button variant="secondary" onPress={() => updateFilter("search", searchInput || undefined)}>Search</Button>,
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilters((current) => ({ ...current, [id]: undefined, offset: 0 })),
        onClearAll: activeFilters.length > 0 ? () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0 }); } : undefined,
      }}
    >
      <EnterpriseDataGrid<Contact>
        aria-label="Contacts"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={gridState}
        loadingContent={<LoadingState label="Loading contacts" onRetry={() => query.refetch()} />}
        emptyContent={<NoResultsState title="No contacts yet" action={canManage ? { label: "New contact", onPress: () => router.push("/crm/contacts/new") } : undefined} />}
        noResultsContent={<NoResultsState title="No contacts match these filters" action={{ label: "Clear filters", onPress: () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0 }); } }} />}
        errorContent={<ErrorState title="Could not load contacts" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Contacts" />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        onRowClick={(row) => router.push(`/crm/contacts/${row.id}`)}
        renderMobileCard={(row) => (
          <button type="button" onClick={() => router.push(`/crm/contacts/${row.id}`)} className="flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{`${row.firstName} ${row.lastName || ""}`.trim()}</span>
              <StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</StatusBadge>
            </div>
            <span className="text-xs text-text-muted">{row.designation || "—"}</span>
          </button>
        )}
      />
    </EnterpriseListPage>
  );
}
