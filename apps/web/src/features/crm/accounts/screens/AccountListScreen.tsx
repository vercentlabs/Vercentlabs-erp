"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
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
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { AccountApiError, listAccounts } from "../api/accounts-api";
import type { Account, AccountListFilters } from "../types";

const PAGE_SIZE = 25;

export function AccountListScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.accountsManage);

  const [filters, setFilters] = useState<AccountListFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [searchInput, setSearchInput] = useState("");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", filters),
    queryFn: () => listAccounts(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof AccountListFilters>(key: K, value: AccountListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  const industryOptions: SelectOption[] = useMemo(() => {
    const industries = query.data?.filters.industries ?? [];
    return [{ value: "", label: "Any industry" }, ...industries.map((industry) => ({ value: industry, label: industry }))];
  }, [query.data]);

  const countryOptions: SelectOption[] = useMemo(() => {
    const countries = query.data?.filters.countries ?? [];
    return [{ value: "", label: "Any country" }, ...countries.map((country) => ({ value: country, label: country }))];
  }, [query.data]);

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.industry) active.push({ id: "industry", label: `Industry: ${filters.industry}` });
    if (filters.country) active.push({ id: "country", label: `Country: ${filters.country}` });
    if (filters.status && filters.status !== "active") active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.search) active.push({ id: "search", label: `Search: ${filters.search}` });
    return active;
  }, [filters]);

  function removeFilter(id: string) {
    if (id === "search") setSearchInput("");
    setFilters((current) => ({ ...current, [id]: undefined, offset: 0 }));
  }

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(filters.search || filters.industry || filters.country || (filters.status && filters.status !== "active"));

  const columns: ColumnDef<Account, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Account",
        accessorKey: "displayName",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-text">{row.original.displayName}</span>
            {row.original.legalName && row.original.legalName !== row.original.displayName && <span className="text-xs text-text-muted">{row.original.legalName}</span>}
          </div>
        ),
      },
      { id: "industry", header: "Industry", accessorFn: (row) => row.industry || "—" },
      { id: "email", header: "Email", accessorFn: (row) => row.email || "—" },
      { id: "phone", header: "Phone", accessorFn: (row) => row.phone || "—" },
      { id: "city", header: "City", accessorFn: (row) => row.city || "—" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof AccountApiError && query.error.status === 403
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
        title: "Accounts",
        description: "Companies and organizations you sell to.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/accounts/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New account
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField
              aria-label="Search accounts"
              placeholder="Search by name, email, phone…"
              value={searchInput}
              onChange={setSearchInput}
              onKeyDown={(event) => event.key === "Enter" && updateFilter("search", searchInput || undefined)}
              className="min-w-[240px]"
            />
            <Select aria-label="Industry" size="compact" options={industryOptions} selectedKey={filters.industry ?? ""} onSelectionChange={(key) => updateFilter("industry", key ? String(key) : undefined)} />
            <Select aria-label="Country" size="compact" options={countryOptions} selectedKey={filters.country ?? ""} onSelectionChange={(key) => updateFilter("country", key ? String(key) : undefined)} />
            <Select
              aria-label="Status"
              size="compact"
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "all", label: "All" },
              ]}
              selectedKey={filters.status ?? "active"}
              onSelectionChange={(key) => updateFilter("status", String(key) as AccountListFilters["status"])}
            />
          </>
        ),
        end: <Button variant="secondary" onPress={() => updateFilter("search", searchInput || undefined)}>Search</Button>,
      }}
      filterBar={{ filters: activeFilters, onRemove: removeFilter, onClearAll: activeFilters.length > 0 ? () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0 }); } : undefined }}
    >
      <EnterpriseDataGrid<Account>
        aria-label="Accounts"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading accounts…</p>}
        emptyContent={
          <NoResultsState title="No accounts yet" description="Accounts are created directly or via Lead conversion." action={canManage ? { label: "New account", onPress: () => router.push("/crm/accounts/new") } : undefined} />
        }
        noResultsContent={<NoResultsState title="No accounts match these filters" action={{ label: "Clear filters", onPress: () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0 }); } }} />}
        errorContent={<ErrorState title="Could not load accounts" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Accounts" />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        onRowClick={(row) => router.push(`/crm/accounts/${row.id}`)}
        renderMobileCard={(row) => (
          <button type="button" onClick={() => router.push(`/crm/accounts/${row.id}`)} className="flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{row.displayName}</span>
              <StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</StatusBadge>
            </div>
            <span className="text-xs text-text-muted">{row.industry || "—"}{row.city ? ` · ${row.city}` : ""}</span>
          </button>
        )}
      />
    </EnterpriseListPage>
  );
}
