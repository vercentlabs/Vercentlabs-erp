"use client";

// The item list: one catalogue for every module. Inventory opens it as Items (units, tracking and stock read from Inventory); Sales opens
// it as Products & Services (selling and tax). Stock columns are read-only figures from Inventory, shown to those who may see stock.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, Plus, Upload } from "lucide-react";
import {
  Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, getItemOptions, itemExportUrl, listItems, type Item, type ItemFilters } from "../api/items-api";
import { CopySkuButton, ErrorBanner, ItemTypeBadge, LENS, LifecycleBadge, MATCH_LABELS, quantity, trackingText, yesNo, type ItemLens } from "../item-format";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "type" | "categoryId" | "status" | "sellable" | "purchasable" | "trackingType" | "brand" | "taxCategoryId" | "hsnSac";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { type: ANY, categoryId: ANY, status: ANY, sellable: ANY, purchasable: ANY, trackingType: ANY, brand: ANY, taxCategoryId: ANY, hsnSac: ANY };
const NAMES: Record<FilterKey, string> = {
  type: "Type", categoryId: "Category", status: "Status", sellable: "Sellable", purchasable: "Purchasable", trackingType: "Tracking", brand: "Brand", taxCategoryId: "Tax profile", hsnSac: "HSN / SAC",
};
const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export function ItemListScreen({ lens = "inventory" }: { lens?: ItemLens }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const meta = LENS[lens];
  const [view, setViewState] = useState(params.get("view") || meta.initialView);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submitted, setSubmittedState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(() => ({ ...NO_FILTERS, ...(params.get("categoryId") ? { categoryId: params.get("categoryId") as string } : {}) }));
  // A category includes its sub-categories unless the link says includeSubcategories=no.
  const [withSubcategories, setWithSubcategoriesState] = useState(params.get("includeSubcategories") !== "no");
  const [sorting, setSortingState] = useState<SortingState>([{ id: "name", desc: false }]);
  const [pageIndex, setPageIndex] = useState(0);
  const setView = (next: string) => { setViewState(next); setPageIndex(0); };
  // The category and its sub-category switch live in the address, so a filtered list can be shared or bookmarked.
  const syncAddress = (categoryId: string, subcategories: boolean) => {
    const next = new URLSearchParams(params.toString());
    if (categoryId !== ANY) next.set("categoryId", categoryId); else next.delete("categoryId");
    if (categoryId !== ANY && categoryId !== "none" && !subcategories) next.set("includeSubcategories", "no"); else next.delete("includeSubcategories");
    router.replace(`${meta.base}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  };
  const setFilters = (next: Filters) => { setFiltersState(next); setPageIndex(0); if (next.categoryId !== filters.categoryId) syncAddress(next.categoryId, withSubcategories); };
  const setWithSubcategories = (next: boolean) => { setWithSubcategoriesState(next); setPageIndex(0); syncAddress(filters.categoryId, next); };
  const setSorting = (next: SortingState) => { setSortingState(next); setPageIndex(0); };
  const setSubmitted = (next: string) => { if (next !== submitted) { setSubmittedState(next); setPageIndex(0); } };
  useEffect(() => {
    const timer = setTimeout(() => setSubmitted(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const listFilters: ItemFilters = useMemo(() => ({
    view, search: submitted || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    includeSubcategories: filters.categoryId !== ANY && filters.categoryId !== "none" && !withSubcategories ? "no" : undefined,
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, withSubcategories, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "list", listFilters, pageIndex),
    queryFn: () => listItems({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.products ?? [];
  const total = listQuery.data?.total ?? 0;
  const showsStock = Boolean(listQuery.data?.showsStock);

  const columns = useMemo<ColumnDef<Item, unknown>[]>(() => {
    const sku: ColumnDef<Item, unknown> = {
      id: "code", accessorKey: "code", header: "SKU",
      cell: ({ row }) => <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap tabular-nums">{row.original.code}<CopySkuButton sku={row.original.code} /></span>,
    };
    const name: ColumnDef<Item, unknown> = {
      id: "name", accessorKey: "name", header: lens === "inventory" ? "Item" : "Name",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className="font-medium">{row.original.name}</span>
          {(row.original.parent || row.original.brand) && <span className="line-clamp-1 text-xs text-text-muted">{[row.original.parent ? `Variant of ${row.original.parent.code}` : null, row.original.brand].filter(Boolean).join(" · ")}</span>}
          {row.original.matchedBy && MATCH_LABELS[row.original.matchedBy] && (
            <span className="text-xs text-brand">{MATCH_LABELS[row.original.matchedBy]}{row.original.matchedPreviousSku ? ` ${row.original.matchedPreviousSku}` : ""}</span>
          )}
        </span>
      ),
    };
    const category: ColumnDef<Item, unknown> = { id: "category", accessorKey: "categoryName", header: "Category", cell: ({ row }) => row.original.categoryName ?? "" };
    const type: ColumnDef<Item, unknown> = { id: "type", accessorKey: "type", header: "Type", cell: ({ row }) => <ItemTypeBadge item={row.original} /> };
    const uom: ColumnDef<Item, unknown> = { id: "uom", header: "Base UOM", enableSorting: false, cell: ({ row }) => row.original.baseUom?.code ?? "" };
    const status: ColumnDef<Item, unknown> = { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <LifecycleBadge status={row.original.lifecycleStatus} /> };
    const flag = (id: "isPurchasable" | "isSellable", header: string): ColumnDef<Item, unknown> => ({ id, header, enableSorting: false, cell: ({ row }) => yesNo(row.original[id]) });
    if (lens === "inventory") {
      return [sku, name, category, type, uom,
        { id: "tracking", header: "Tracking", enableSorting: false, cell: ({ row }) => (row.original.type === "stock" ? trackingText(row.original.trackingType) : "") },
        ...(showsStock ? [
          { id: "onHand", header: "On hand", enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.type === "stock" ? quantity(row.original.onHand ?? 0) : ""}</span> },
          { id: "available", header: "Available", enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.type === "stock" ? quantity(row.original.available ?? 0) : ""}</span> },
        ] as ColumnDef<Item, unknown>[] : []),
        flag("isPurchasable", "Purchasable"), flag("isSellable", "Sellable"), status];
    }
    return [sku, name, type, category, uom,
      { id: "hsnSac", header: "HSN / SAC", enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.hsnSacCode ?? ""}</span> },
      flag("isSellable", "Sellable"), flag("isPurchasable", "Purchasable"), status];
  }, [lens, showsStock]);

  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to items" description="Ask an administrator for the View products permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = options ? {
    type: options.types.map((entry) => ({ value: entry.code, label: entry.label })),
    categoryId: [{ value: "none", label: "No category" }, ...options.categories.map((entry) => ({ value: entry.id, label: `${"\u00a0\u00a0".repeat(entry.depth)}${entry.label}` }))],
    status: options.lifecycle.map((entry) => ({ value: entry.code, label: entry.label })),
    sellable: YES_NO, purchasable: YES_NO,
    trackingType: options.trackingModes.map((entry) => ({ value: entry.code, label: entry.label })),
    brand: options.brands.map((brand) => ({ value: brand, label: brand })),
    taxCategoryId: [{ value: "none", label: "No tax profile" }, ...options.taxCategories.map((entry) => ({ value: entry.id, label: entry.name }))],
    hsnSac: [{ value: "missing", label: "Missing HSN / SAC" }],
  } : {};
  const select = (key: FilterKey, anyLabel: string) => (
    <Select key={key} aria-label={NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const categoryLabel = (id: string) => {
    const found = options?.categories.find((entry) => entry.id === id);
    return id === "none" ? "No category" : found ? `${found.name}${withSubcategories ? " and sub-categories" : " only"}` : id;
  };
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${NAMES[key]}: ${key === "categoryId" ? categoryLabel(filters.categoryId) : choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all";

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={optionsQuery.isError ? "The filters could not be loaded. Refresh the page." : null} />
      <EnterpriseListPage
        header={{
          title: meta.title,
          description: lens === "inventory"
            ? "The item master shared by Sales, Procurement and Inventory. Stock is read from Inventory and changes only through stock transactions."
            : "The same catalogue Procurement and Inventory use. Prices come from price lists; stock comes from Inventory.",
          primaryAction: can?.create ? <LinkButton href={`${meta.base}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />{meta.newLabel}</LinkButton> : undefined,
          secondaryActions: (
            <>
              {can?.import && can.create && <LinkButton href={`${meta.base}/import`} variant="outline"><Upload className="size-4" aria-hidden="true" />Import</LinkButton>}
              {can?.export && <a className={buttonVariants({ variant: "outline" })} href={itemExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" />Export</a>}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search items" placeholder="Search name, SKU, barcode, brand, manufacturer, part number, HSN / SAC or category" className="w-full sm:w-96"
                value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
              {options && (
                <>
                  {select("type", "Any type")}
                  {select("categoryId", "Any category")}
                  {filters.categoryId !== ANY && filters.categoryId !== "none" &&
                    <Checkbox isSelected={withSubcategories} onChange={setWithSubcategories}>Include subcategories</Checkbox>}
                  {select("status", "Any status")}
                  {select("purchasable", "Bought or not")}
                  {select("sellable", "Sold or not")}
                  {lens === "inventory" && select("trackingType", "Any tracking")}
                  {options.brands.length > 0 && select("brand", "Any brand")}
                  {select("taxCategoryId", "Any tax profile")}
                  {select("hsnSac", "Any HSN / SAC")}
                </>
              )}
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: ANY }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
      >
        <EnterpriseDataGrid<Item>
          aria-label={meta.title}
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading items" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load items" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={<EmptyState title="No items yet" description="Add what you buy, sell or stock, or import a list."
            action={can?.create ? { label: meta.newLabel, onPress: () => router.push(`${meta.base}/new`) } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          onRowClick={(row) => router.push(`${meta.base}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{row.name}</span>
              <span className="text-xs text-text-muted">{[row.code, row.categoryName, row.baseUom?.code].filter(Boolean).join(" · ")}</span>
              <span className="flex flex-wrap gap-1"><ItemTypeBadge item={row} /><LifecycleBadge status={row.lifecycleStatus} /></span>
              {showsStock && row.type === "stock" && <span className="text-xs text-text-secondary">On hand {quantity(row.onHand ?? 0)} · Available {quantity(row.available ?? 0)}</span>}
            </div>
          )}
        />
      </EnterpriseListPage>
    </div>
  );
}
