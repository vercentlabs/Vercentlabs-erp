"use client";

// Products & Services: the one catalogue every module uses. Sales opens it
// on everything; Inventory's Items page opens it on stock items.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, Plus, Upload } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, getProductOptions, listProducts, productExportUrl, type Product, type ProductFilters } from "../api/products-api";
import { ErrorBanner, ProductStatusBadge, ProductTypeBadge, price, yesNo } from "../product-format";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "type" | "categoryId" | "status" | "sellable" | "purchasable" | "inventoryTracked" | "taxCategoryId" | "hsnSac";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { type: ANY, categoryId: ANY, status: ANY, sellable: ANY, purchasable: ANY, inventoryTracked: ANY, taxCategoryId: ANY, hsnSac: ANY };
const NAMES: Record<FilterKey, string> = {
  type: "Type", categoryId: "Category", status: "Status", sellable: "Sellable", purchasable: "Purchasable", inventoryTracked: "Inventory tracked", taxCategoryId: "Tax category", hsnSac: "HSN / SAC",
};
const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export function ProductListScreen({ initialView = "all" }: { initialView?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setViewState] = useState(params.get("view") || initialView);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submitted, setSubmittedState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(NO_FILTERS);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "name", desc: false }]);
  const [pageIndex, setPageIndex] = useState(0);
  const setView = (next: string) => { setViewState(next); setPageIndex(0); };
  const setFilters = (next: Filters) => { setFiltersState(next); setPageIndex(0); };
  const setSorting = (next: SortingState) => { setSortingState(next); setPageIndex(0); };
  const setSubmitted = (next: string) => { if (next !== submitted) { setSubmittedState(next); setPageIndex(0); } };
  useEffect(() => {
    const timer = setTimeout(() => setSubmitted(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getProductOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const listFilters: ProductFilters = useMemo(() => ({
    view, search: submitted || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "list", listFilters, pageIndex),
    queryFn: () => listProducts({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.products ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<Product, unknown>[]>(() => [
    { id: "code", accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.code}</span> },
    {
      id: "name", accessorKey: "name", header: "Name",
      cell: ({ row }) => <span className="flex min-w-48 flex-col"><span className="font-medium">{row.original.name}</span>{row.original.salesDescription && <span className="line-clamp-1 text-xs text-text-muted">{row.original.salesDescription}</span>}</span>,
    },
    { id: "type", accessorKey: "type", header: "Type", cell: ({ row }) => <ProductTypeBadge type={row.original.type} /> },
    { id: "category", accessorKey: "categoryName", header: "Category", cell: ({ row }) => row.original.categoryName ?? "" },
    { id: "sku", header: "SKU", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.sku ?? ""}</span> },
    { id: "uom", header: "Base UOM", enableSorting: false, cell: ({ row }) => row.original.baseUom?.code ?? "" },
    { id: "hsnSac", header: "HSN / SAC", enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.hsnSacCode ?? ""}</span> },
    { id: "defaultSalesPrice", accessorKey: "defaultSalesPrice", header: "Default price", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{price(row.original.defaultSalesPrice)}</span> },
    { id: "flags", header: "Sold · Bought · Stock", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{[yesNo(row.original.isSellable), yesNo(row.original.isPurchasable), yesNo(row.original.inventoryTracked)].join(" · ")}</span> },
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <ProductStatusBadge active={row.original.isActive} /> },
  ], []);

  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to products" description="Ask an administrator for the View products permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = options ? {
    type: options.types.map((entry) => ({ value: entry.code, label: entry.label })),
    categoryId: [{ value: "none", label: "No category" }, ...options.categories.map((entry) => ({ value: entry.id, label: entry.name }))],
    status: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }],
    sellable: YES_NO, purchasable: YES_NO, inventoryTracked: YES_NO,
    taxCategoryId: [{ value: "none", label: "No tax category" }, ...options.taxCategories.map((entry) => ({ value: entry.id, label: entry.name }))],
    hsnSac: [{ value: "missing", label: "Missing HSN / SAC" }],
  } : {};
  const select = (key: FilterKey, anyLabel: string) => (
    <Select key={key} aria-label={NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all";

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={optionsQuery.isError ? "The filters could not be loaded. Refresh the page." : null} />
      <EnterpriseListPage
        header={{
          title: "Products & Services",
          description: "One catalogue for Sales, CRM, Purchasing, Inventory, Manufacturing and POS. Prices come from price lists; stock comes from Inventory.",
          primaryAction: can?.create ? <LinkButton href="/sales/products/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New product or service</LinkButton> : undefined,
          secondaryActions: (
            <>
              {can?.import && can.create && <LinkButton href="/sales/products/import" variant="outline"><Upload className="size-4" aria-hidden="true" />Import</LinkButton>}
              {can?.export && <a className={buttonVariants({ variant: "outline" })} href={productExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" />Export</a>}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search products" placeholder="Search code, name, SKU, barcode, HSN / SAC or category" className="w-full sm:w-96" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmitted(value.trim())} />
              {options && (
                <>
                  {select("type", "Any type")}
                  {select("categoryId", "Any category")}
                  {select("status", "Any status")}
                  {select("sellable", "Sold or not")}
                  {select("purchasable", "Bought or not")}
                  {select("inventoryTracked", "Stock tracked or not")}
                  {select("taxCategoryId", "Any tax category")}
                  {select("hsnSac", "Any HSN / SAC")}
                </>
              )}
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: ANY }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
      >
        <EnterpriseDataGrid<Product>
          aria-label="Products and services"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading products" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load products" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={<EmptyState title="No products or services yet" description="Add what you sell, buy or stock, or import a list."
            action={can?.create ? { label: "New product or service", onPress: () => router.push("/sales/products/new") } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          onRowClick={(row) => router.push(`/sales/products/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{row.name}</span>
              <span className="text-xs text-text-muted">{[row.code, row.sku, row.categoryName].filter(Boolean).join(" · ")}</span>
              <span className="flex flex-wrap gap-1"><ProductTypeBadge type={row.type} /><ProductStatusBadge active={row.isActive} /></span>
              <span className="text-xs text-text-secondary">{price(row.defaultSalesPrice)}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
    </div>
  );
}
