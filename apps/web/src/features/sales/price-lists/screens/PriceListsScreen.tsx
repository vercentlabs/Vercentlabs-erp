"use client";

// Sales → Price Lists: every list with its currency, tax mode, validity,
// number of products, default flag and status.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Badge, Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, listPriceLists, type PriceList } from "../api/price-lists-api";
import { PriceListFormDialog } from "../components/PriceListDialogs";

const ANY = "any";
const VIEWS = [{ id: ANY, label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }];
export const validity = (list: Pick<PriceList, "validFrom" | "validTo">) =>
  list.validFrom || list.validTo ? [list.validFrom ? `from ${formatDate(list.validFrom)}` : null, list.validTo ? `until ${formatDate(list.validTo)}` : null].filter(Boolean).join(" ") : "Always";

export function PriceListsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [status, setStatus] = useState(ANY);
  const [currency, setCurrency] = useState(ANY);
  const [creating, setCreating] = useState(false);
  const filters = { search: submitted || undefined, status: status === ANY ? undefined : status, currencyCode: currency === ANY ? undefined : currency };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", filters), queryFn: () => listPriceLists(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => query.data?.priceLists ?? [], [query.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "code", desc: false }] });
  const columns = useMemo<ColumnDef<PriceList, unknown>[]>(() => [
    { id: "code", accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-medium whitespace-nowrap text-text">{row.original.code}</span> },
    { id: "name", accessorKey: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "currencyCode", accessorKey: "currencyCode", header: "Currency", cell: ({ row }) => row.original.currencyCode },
    { id: "taxModeLabel", accessorKey: "taxModeLabel", header: "Tax mode", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.taxModeLabel}</span> },
    { id: "validity", header: "Validity", enableSorting: false, cell: ({ row }) => (
      <span className="whitespace-nowrap">{validity(row.original)}{row.original.isActive && !row.original.isCurrent ? <span className="text-xs text-warning"> · not valid today</span> : null}</span>
    ) },
    { id: "productCount", accessorKey: "productCount", header: "Products", cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span> },
    { id: "customerCount", accessorKey: "customerCount", header: "Customers", cell: ({ row }) => <span className="tabular-nums">{row.original.customerCount}</span> },
    { id: "isDefault", accessorKey: "isDefault", header: "Default", cell: ({ row }) => (row.original.isDefault ? <Badge tone="info">Default {row.original.currencyCode}</Badge> : "") },
    { id: "isActive", accessorKey: "isActive", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ], []);

  if (query.isError && errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to price lists" description="Ask an administrator for access." />;
  const data = query.data;
  const can = data?.capabilities;
  const filterBar = filterBarOf([{ id: "currency", active: currency !== ANY, label: `Currency: ${currency}`, clear: () => setCurrency(ANY) }], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || status !== ANY;
  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Price Lists",
          description: "The prices quotations and orders start from. A customer uses its own price list, else the default list for the document's currency.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New price list</Button> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: status, onSelect: (id) => { setStatus(id); paged.resetPage(); } }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search price lists" placeholder="Search code or name" className="w-full sm:w-80" value={search} onChange={setSearch} />
              {data && <Select aria-label="Currency" size="compact" selectedKey={currency} onSelectionChange={(key) => setCurrency(String(key))}
                options={[{ value: ANY, label: "Any currency" }, ...data.currencies.map((entry) => ({ value: entry.code, label: entry.code }))]} />}
            </>
          ),
        }}
        filterBar={filterBar}
      >
        <EnterpriseDataGrid<PriceList>
          aria-label="Price lists"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading price lists" rows={6} />}
          errorContent={<ErrorState title="Could not load price lists" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No price lists yet" description="Create a list such as Standard India, add prices, and quotations will price from it."
            action={can?.create ? { label: "New price list", onPress: () => setCreating(true) } : undefined} />}
          noResultsContent={<NoResultsState title="No price lists match" description="Try another view, search or currency." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`/sales/price-lists/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.code} · {row.name}</span>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.currencyCode} · {row.taxModeLabel} · {row.productCount} products</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {creating && data && (
        <PriceListFormDialog mode="new" currencies={data.currencies} capabilities={data.capabilities} onClose={() => setCreating(false)}
          onSaved={(list) => { setCreating(false); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "price-lists") }); router.push(`/sales/price-lists/${list.id}`); }} />
      )}
    </>
  );
}
