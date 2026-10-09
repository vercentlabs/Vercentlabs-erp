"use client";

// Warehouses: every place the company holds stock, with what Inventory says is in each (on hand, reserved, available, value for those who
// may see it). Views: All, Active, Inactive, My warehouses (managed by me or where I am listed).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Badge, Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { money, quantity } from "@/features/items/item-format";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, getWarehouseOptions, listWarehouses, type Warehouse, type WarehouseDetail, type WarehouseFilters } from "../api/warehouses-api";
import { WarehouseFormDialog, type WarehouseFormTarget } from "../components/WarehouseFormDialog";

export const WAREHOUSE_BASE = "/inventory/warehouses";
const ANY = "any";
const VIEWS = [{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "mine", label: "My warehouses" }];
const operations = (row: Warehouse) => [row.receivingEnabled && "Receive", row.shippingEnabled && "Ship", row.transferEnabled && "Transfer", row.returnsEnabled && "Returns"].filter(Boolean).join(" · ") || "None";
const sortValue = (row: Warehouse, id: string) => {
  if (id === "city") return [row.address.city, row.address.state].filter(Boolean).join(", ");
  if (id === "onHand" || id === "reserved" || id === "available" || id === "value") return row.stock?.[id] ?? 0;
  return (row as Record<string, unknown>)[id];
};

export function WarehousesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState("active");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [receiving, setReceiving] = useState(ANY);
  const [shipping, setShipping] = useState(ANY);
  const [form, setForm] = useState<WarehouseFormTarget | null>(null);
  const filters: WarehouseFilters = Object.fromEntries(Object.entries({ view, search: submitted, receiving, shipping }).filter(([, value]) => value && value !== ANY));
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "list", filters), queryFn: () => listWarehouses(filters), placeholderData: (previous) => previous });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "options"), queryFn: getWarehouseOptions, staleTime: 60_000 });
  const rows = useMemo(() => list.data?.warehouses ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "code", desc: false }], sortValue });
  const showStock = list.data?.showsStock ?? false;
  const showValue = list.data?.showsValue ?? false;
  const can = list.data?.capabilities ?? options.data?.capabilities;

  const columns = useMemo(() => ([
    { id: "code", accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.code}</span> },
    { id: "name", accessorKey: "name", header: "Warehouse", cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-text">{row.original.name}</span>
          {row.original.isDefault && <Badge tone="info">Default</Badge>}{row.original.system && <Badge tone="neutral">System</Badge>}</span>
        {row.original.type === "transit" && <span className="text-xs text-text-muted">Transit</span>}
      </span>
    ) },
    { id: "city", accessorFn: (row) => [row.address.city, row.address.state].filter(Boolean).join(", "), header: "City / State", cell: ({ row }) => [row.original.address.city, row.original.address.state].filter(Boolean).join(", ") },
    { id: "managerName", accessorKey: "managerName", header: "Manager", cell: ({ row }) => row.original.managerName ?? "" },
    { id: "operations", header: "Operations", enableSorting: false, cell: ({ row }) => <span className="text-xs text-text-secondary">{operations(row.original)}</span> },
    { id: "isActive", accessorKey: "isActive", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
    { id: "onHand", accessorFn: (row) => row.stock?.onHand ?? 0, header: "On hand", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.stock?.onHand ?? 0)}</span> },
    { id: "reserved", accessorFn: (row) => row.stock?.reserved ?? 0, header: "Reserved", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.stock?.reserved ?? 0)}</span> },
    { id: "available", accessorFn: (row) => row.stock?.available ?? 0, header: "Available", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.stock?.available ?? 0)}</span> },
    { id: "value", accessorFn: (row) => row.stock?.value ?? 0, header: "Value", cell: ({ row }) => <span className="tabular-nums">{money(row.original.stock?.value ?? 0)}</span> },
  ] satisfies ColumnDef<Warehouse, unknown>[]).filter((column) => (showStock || !["onHand", "reserved", "available"].includes(column.id)) && (showValue || column.id !== "value")), [showStock, showValue]);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to warehouses" description="Ask an administrator for access." />;
  const saved = (warehouse: WarehouseDetail) => {
    setForm(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "warehouses") });
    router.push(`${WAREHOUSE_BASE}/${warehouse.id}`);
  };
  const yesNo = (label: string) => [{ value: ANY, label: `Any ${label}` }, { value: "yes", label: `${label[0].toUpperCase()}${label.slice(1)}` }, { value: "no", label: `No ${label}` }];
  const filterBar = filterBarOf([
    { id: "receiving", active: receiving !== ANY, label: receiving === "yes" ? "Receiving" : "No receiving", clear: () => setReceiving(ANY) },
    { id: "shipping", active: shipping !== ANY, label: shipping === "yes" ? "Shipping" : "No shipping", clear: () => setShipping(ANY) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "active";
  const mine = options.data?.myDefault;

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Warehouses",
          description: "Where the company holds stock. Quantities and value come from Inventory; a warehouse never holds an editable quantity.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setForm({ mode: "new" })}><Plus className="size-4" aria-hidden="true" />New warehouse</Button> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search warehouses" placeholder="Search code, name, city or manager" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Receiving" size="compact" selectedKey={receiving} onSelectionChange={(key) => setReceiving(String(key))} options={yesNo("receiving")} />
              <Select aria-label="Shipping" size="compact" selectedKey={shipping} onSelectionChange={(key) => setShipping(String(key))} options={yesNo("shipping")} />
            </>
          ),
        }}
        filterBar={filterBar}
      >
        {mine && <Notice tone="neutral">New documents start in <span className="font-medium text-text">{mine.code}</span>{mine.source === "user" ? " (your preference)." : " (company default)."}</Notice>}
        <EnterpriseDataGrid<Warehouse>
          aria-label="Warehouses"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading warehouses" rows={6} />}
          errorContent={<ErrorState title="Could not load warehouses" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="No warehouses yet" description="Add the places you keep stock, such as a main store or a city warehouse."
            action={can?.create ? { label: "New warehouse", onPress: () => setForm({ mode: "new" }) } : undefined} />}
          noResultsContent={<NoResultsState title="No warehouses match" description="Try another view, search or filter." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`${WAREHOUSE_BASE}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.code} · {row.name}</span>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge></span>
              <span className="text-xs text-text-muted">{[row.address.city, row.address.state].filter(Boolean).join(", ")} · {operations(row)}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      <WarehouseFormDialog target={form} options={options.data} onClose={() => setForm(null)} onSaved={saved} />
    </>
  );
}
