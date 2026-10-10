"use client";

// Stores & Outlets: every place the company sells from, with its selling warehouse, GST registration, terminals and manager. Views: All,
// Active, Inactive, My outlets (managed by me or where I work). A new outlet starts Inactive and is activated once its setup is complete.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { filterBarOf, optionLabel, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { OUTLETS_BASE, errorCode, errorMessage, getOutletOptions, listOutlets, type Outlet, type OutletFilters } from "../api/outlets-api";

const ANY = "any";
const VIEWS = [{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "mine", label: "My outlets" }];
const place = (row: Outlet) => [row.address.city, row.address.state].filter(Boolean).join(", ");
const sortValue = (row: Outlet, id: string) => (id === "city" ? place(row) : (row as Record<string, unknown>)[id]);

export function OutletsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [state, setState] = useState(ANY);
  const [city, setCity] = useState(ANY);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const [managerUserId, setManagerUserId] = useState(ANY);
  const filters: OutletFilters = Object.fromEntries(Object.entries({ view, search: submitted, state, city, warehouseId, managerUserId }).filter(([, value]) => value && value !== ANY));
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "list", filters), queryFn: () => listOutlets(filters), placeholderData: (previous) => previous });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "options"), queryFn: getOutletOptions, staleTime: 60_000 });
  const rows = useMemo(() => list.data?.outlets ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "code", desc: false }], sortValue });
  const can = list.data?.capabilities ?? options.data?.capabilities;

  const columns = useMemo(() => [
    { id: "code", accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.code}</span> },
    { id: "name", accessorKey: "name", header: "Outlet", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span><span className="text-xs text-text-muted">{row.original.typeLabel}</span></span>
    ) },
    { id: "city", accessorFn: place, header: "City / State", cell: ({ row }) => place(row.original) },
    { id: "warehouse", accessorKey: "warehouse", header: "Selling warehouse", cell: ({ row }) => row.original.warehouse ?? "" },
    { id: "taxRegistration", accessorKey: "taxRegistration", header: "GST registration", cell: ({ row }) => (
      row.original.taxRegistration ? <span className="flex flex-col"><span>{row.original.taxRegistration}</span>{row.original.gstin && <span className="text-xs text-text-muted tabular-nums">{row.original.gstin}</span>}</span> : ""
    ) },
    { id: "terminals", accessorKey: "terminals", header: "Terminals", cell: ({ row }) => <span className="tabular-nums">{row.original.activeTerminals} of {row.original.terminals} active</span> },
    { id: "managerName", accessorKey: "managerName", header: "Manager", cell: ({ row }) => row.original.managerName ?? "" },
    { id: "isActive", accessorKey: "isActive", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ] satisfies ColumnDef<Outlet, unknown>[], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to stores and outlets" description="Ask an administrator for access." />;
  const opts = options.data;
  const choose = (label: string, values: Array<{ value: string; label: string }>) => [{ value: ANY, label: `Any ${label}` }, ...values];
  const filterBar = filterBarOf([
    { id: "state", active: state !== ANY, label: `State: ${state}`, clear: () => setState(ANY) },
    { id: "city", active: city !== ANY, label: `City: ${city}`, clear: () => setCity(ANY) },
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(opts?.warehouses, warehouseId)}`, clear: () => setWarehouseId(ANY) },
    { id: "manager", active: managerUserId !== ANY, label: `Manager: ${optionLabel(opts?.members, managerUserId)}`, clear: () => setManagerUserId(ANY) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "all";
  const create = () => router.push(`${OUTLETS_BASE}/new`);

  return (
    <EnterpriseListPage
      header={{
        title: "Stores & Outlets",
        description: "Where the company sells to customers. Stock comes from each outlet's selling warehouse; tax from its GST registration.",
        primaryAction: can?.create ? <Button variant="primary" onPress={create}><Plus className="size-4" aria-hidden="true" />New outlet</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search outlets" placeholder="Search name, code, city or GST registration" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="State" size="compact" selectedKey={state} onSelectionChange={(key) => setState(String(key))}
              options={choose("state", (opts?.states ?? []).map((value) => ({ value, label: value })))} />
            <Select aria-label="City" size="compact" selectedKey={city} onSelectionChange={(key) => setCity(String(key))}
              options={choose("city", (opts?.cities ?? []).map((value) => ({ value, label: value })))} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
              options={choose("warehouse", (opts?.warehouses ?? []).map((entry) => ({ value: entry.id, label: entry.label })))} />
            <Select aria-label="Manager" size="compact" selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key))}
              options={choose("manager", (opts?.members ?? []).map((entry) => ({ value: entry.id, label: entry.name })))} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<Outlet>
        aria-label="Stores and outlets"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading outlets" rows={6} />}
        errorContent={<ErrorState title="Could not load outlets" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No stores or outlets yet" description="Add the shops, showrooms and kiosks the company sells from."
          action={can?.create ? { label: "New outlet", onPress: create } : undefined} />}
        noResultsContent={<NoResultsState title="No outlets match" description="Try another view, search or filter." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${OUTLETS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.code} · {row.name}</span>
              <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge></span>
            <span className="text-xs text-text-muted">{[place(row), row.warehouse].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
