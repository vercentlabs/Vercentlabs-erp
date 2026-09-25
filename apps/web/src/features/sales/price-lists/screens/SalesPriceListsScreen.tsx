"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  NumberField,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import {
  createSalesPriceList,
  deactivateSalesCustomerPrice,
  deactivateSalesPriceListItem,
  getSalesPricingOptions,
  listSalesCustomerPrices,
  listSalesPriceListItems,
  listSalesPriceLists,
  upsertSalesCustomerPrice,
  upsertSalesPriceListItem,
} from "@/features/sales/price-lists/api/price-lists-api";
import type { SalesCustomerPrice, SalesPriceList, SalesPriceListItem, SalesPricingOptions } from "@/features/sales/price-lists/types/price-lists";

const PAGE_SIZE = 25;
const rate = (value: string | number) => Number(value).toFixed(2);
const errorMessage = (error: unknown, fallback: string) => (error instanceof SalesApiError ? error.message : fallback);
const dateInputClass = "rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm text-text";

function gridState(query: { isLoading: boolean; isError: boolean; error: unknown }, rowCount: number) {
  if (query.isLoading) return "loading" as const;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403) return "permission-denied" as const;
  if (query.isError) return "error" as const;
  return rowCount === 0 ? ("empty" as const) : ("ready" as const);
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

// Sales owns pricing (F055-F058); POS only selects a price list per store
// and reads the same tenant.price_lists / price_list_items /
// sales_pricing_rules rows this screen writes -- there is no POS-specific
// pricing master. Every write goes through the existing Sales domain
// functions (upsertSalesPriceListItem, upsertSalesCustomerPrice,
// deactivate*), which own validation and effective-date rules.
// Dates arrive as plain YYYY-MM-DD; show them as "1 Apr 2026".
const dayLabel = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const effectiveRange = (from?: string | null, to?: string | null) => (from || to ? `${from ? dayLabel(from) : "Any time"} → ${to ? dayLabel(to) : "open-ended"}` : "Always");

export function SalesPriceListsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [itemPage, setItemPage] = useState(0);
  const [customerPage, setCustomerPage] = useState(0);
  const [listDialog, setListDialog] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [customerDialog, setCustomerDialog] = useState(false);
  const [removeItem, setRemoveItem] = useState<SalesPriceListItem | null>(null);
  const [removeCustomerPrice, setRemoveCustomerPrice] = useState<SalesCustomerPrice | null>(null);

  const listsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists"), queryFn: listSalesPriceLists });
  const lists = listsQuery.data?.rows ?? [];
  const selectedList = lists.find((list) => list.id === selectedListId) ?? null;

  const itemsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "price-list-items", selectedListId, itemPage),
    queryFn: () => listSalesPriceListItems(selectedListId!, { limit: PAGE_SIZE, offset: itemPage * PAGE_SIZE }),
    enabled: Boolean(selectedListId),
  });
  const customerPricesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer-prices", customerPage),
    queryFn: () => listSalesCustomerPrices({ limit: PAGE_SIZE, offset: customerPage * PAGE_SIZE }),
  });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "pricing-options"), queryFn: getSalesPricingOptions, enabled: canManage });

  const refreshPricing = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales") });

  const removeItemMutation = useMutation({
    mutationFn: (item: SalesPriceListItem) => deactivateSalesPriceListItem(item.id),
    onSuccess: () => {
      setRemoveItem(null);
      refreshPricing();
    },
  });
  const removeCustomerPriceMutation = useMutation({
    mutationFn: (price: SalesCustomerPrice) => deactivateSalesCustomerPrice(price.id),
    onSuccess: () => {
      setRemoveCustomerPrice(null);
      refreshPricing();
    },
  });

  const listColumns: ColumnDef<SalesPriceList, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", cell: ({ row }) => <span className="font-mono font-medium text-text">{row.original.code}</span> },
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "currency", header: "Currency", accessorFn: (row) => `${row.currency_code}${row.tax_inclusive ? " (tax incl.)" : ""}` },
      { id: "effective", header: "Effective", accessorFn: (row) => effectiveRange(row.valid_from, row.valid_to) },
      { id: "items", header: "Active prices", accessorFn: (row) => row.item_count },
      { id: "stores", header: "POS stores", accessorFn: (row) => row.assigned_store_count },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status}</StatusBadge> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button variant="secondary" size="compact" onPress={() => { setSelectedListId(row.original.id); setItemPage(0); }} aria-label={`View prices for ${row.original.name}`}>
            {selectedListId === row.original.id ? "Viewing" : "View prices"}
          </Button>
        ),
      },
    ],
    [selectedListId],
  );

  const itemColumns: ColumnDef<SalesPriceListItem, unknown>[] = useMemo(
    () => [
      { id: "item", header: "Item", accessorFn: (row) => `${row.item_code} · ${row.item_name}` },
      { id: "variant", header: "Variant", accessorFn: (row) => row.variant_sku ?? "All variants" },
      { id: "min", header: "Min qty", accessorFn: (row) => Number(row.minimum_quantity) },
      { id: "rate", header: "Rate", accessorFn: (row) => rate(row.rate) },
      { id: "effective", header: "Effective", accessorFn: (row) => effectiveRange(row.valid_from, row.valid_to) },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canManage ? (
            <Button variant="secondary" size="compact" onPress={() => setRemoveItem(row.original)} aria-label={`Remove price for ${row.original.item_name}`}>
              Remove
            </Button>
          ) : null,
      },
    ],
    [canManage],
  );

  const customerColumns: ColumnDef<SalesCustomerPrice, unknown>[] = useMemo(
    () => [
      { id: "customer", header: "Customer", accessorKey: "party_name" },
      { id: "item", header: "Item", accessorFn: (row) => `${row.item_code} · ${row.item_name}` },
      { id: "min", header: "Min qty", accessorFn: (row) => Number(row.minimum_quantity) },
      { id: "rate", header: "Fixed rate", accessorFn: (row) => rate(row.fixed_rate) },
      { id: "effective", header: "Effective", accessorFn: (row) => effectiveRange(row.valid_from, row.valid_to) },
      { id: "reason", header: "Reason", accessorFn: (row) => row.reason ?? "" },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canManage ? (
            <Button variant="secondary" size="compact" onPress={() => setRemoveCustomerPrice(row.original)} aria-label={`Remove customer price for ${row.original.party_name}`}>
              Remove
            </Button>
          ) : null,
      },
    ],
    [canManage],
  );

  const itemRows = itemsQuery.data?.rows ?? [];
  const itemTotal = itemsQuery.data?.total ?? 0;
  const customerRows = customerPricesQuery.data?.rows ?? [];
  const customerTotal = customerPricesQuery.data?.total ?? 0;

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Price lists",
          description:
            "Sales price lists, quantity tiers, item and variant prices, and customer-specific pricing. Point of Sale reads these same records — assign a list to a store from POS → Stores.",
          primaryAction: canManage ? (
            <Button variant="primary" onPress={() => setListDialog(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New price list
            </Button>
          ) : undefined,
        }}
      >
        <div className="flex flex-col gap-8">
          <EnterpriseDataGrid<SalesPriceList>
            aria-label="Price lists"
            columns={listColumns}
            data={lists}
            getRowId={(row) => row.id}
            state={gridState(listsQuery, lists.length)}
            loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading price lists…</p>}
            emptyContent={<NoResultsState title="No price lists yet" description={canManage ? "Create a price list, then add item prices to it." : "No price list has been created yet."} />}
            errorContent={<ErrorState title="Could not load price lists" action={{ label: "Retry", onPress: () => listsQuery.refetch() }} />}
            permissionDeniedContent={<PermissionState title="You don't have access to Price lists" />}
            pageIndex={0}
            pageSize={Math.max(lists.length, 1)}
            pageCount={1}
            totalRowCount={lists.length}
            onPageChange={() => undefined}
          />

          {selectedList && (
            <section aria-label={`Prices in ${selectedList.name}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-text">
                  Prices in {selectedList.name} <span className="font-mono text-sm font-normal text-text-secondary">({selectedList.code})</span>
                </h2>
                {canManage && (
                  <Button variant="primary" size="compact" onPress={() => setItemDialog(true)}>
                    <Plus className="size-4" aria-hidden="true" />
                    Add price
                  </Button>
                )}
              </div>
              <EnterpriseDataGrid<SalesPriceListItem>
                aria-label="Price list items"
                columns={itemColumns}
                data={itemRows}
                getRowId={(row) => row.id}
                state={gridState(itemsQuery, itemRows.length)}
                loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading prices…</p>}
                emptyContent={<NoResultsState title="No prices in this list" description="Add an item price, optionally per variant, with quantity tiers and effective dates." />}
                errorContent={<ErrorState title="Could not load prices" action={{ label: "Retry", onPress: () => itemsQuery.refetch() }} />}
                permissionDeniedContent={<PermissionState title="You don't have access to these prices" />}
                pageIndex={itemPage}
                pageSize={PAGE_SIZE}
                pageCount={Math.max(1, Math.ceil(itemTotal / PAGE_SIZE))}
                totalRowCount={itemTotal}
                onPageChange={setItemPage}
              />
            </section>
          )}

          <section aria-label="Customer-specific prices" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text">Customer-specific prices</h2>
                <p className="text-sm text-text-secondary">Negotiated fixed rates that take precedence over the price list for that customer.</p>
              </div>
              {canManage && (
                <Button variant="primary" size="compact" onPress={() => setCustomerDialog(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add customer price
                </Button>
              )}
            </div>
            <EnterpriseDataGrid<SalesCustomerPrice>
              aria-label="Customer prices"
              columns={customerColumns}
              data={customerRows}
              getRowId={(row) => row.id}
              state={gridState(customerPricesQuery, customerRows.length)}
              loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading customer prices…</p>}
              emptyContent={<NoResultsState title="No customer-specific prices" description="Customers are charged the price-list rate until a fixed rate is set for them." />}
              errorContent={<ErrorState title="Could not load customer prices" action={{ label: "Retry", onPress: () => customerPricesQuery.refetch() }} />}
              permissionDeniedContent={<PermissionState title="You don't have access to customer prices" />}
              pageIndex={customerPage}
              pageSize={PAGE_SIZE}
              pageCount={Math.max(1, Math.ceil(customerTotal / PAGE_SIZE))}
              totalRowCount={customerTotal}
              onPageChange={setCustomerPage}
            />
          </section>
        </div>
      </EnterpriseListPage>

      {listDialog && (
        <NewPriceListDialog
          onClose={() => setListDialog(false)}
          onCreated={(created) => {
            setListDialog(false);
            setSelectedListId(created.id);
            refreshPricing();
          }}
        />
      )}
      {itemDialog && selectedList && optionsQuery.data && (
        <AddPriceDialog
          priceList={selectedList}
          options={optionsQuery.data}
          onClose={() => setItemDialog(false)}
          onSaved={() => {
            setItemDialog(false);
            refreshPricing();
          }}
        />
      )}
      {customerDialog && optionsQuery.data && (
        <AddCustomerPriceDialog
          options={optionsQuery.data}
          onClose={() => setCustomerDialog(false)}
          onSaved={() => {
            setCustomerDialog(false);
            refreshPricing();
          }}
        />
      )}

      <AlertDialog
        isOpen={Boolean(removeItem)}
        onOpenChange={(open) => !open && setRemoveItem(null)}
        title={`Remove the price for ${removeItem?.item_name ?? "this item"}?`}
        description={`This price (${removeItem ? rate(removeItem.rate) : ""} from qty ${removeItem ? Number(removeItem.minimum_quantity) : ""}) stops applying to new sales immediately. Existing sales keep the price they were rung at.`}
        confirmLabel="Remove price"
        onConfirm={() => removeItem && removeItemMutation.mutate(removeItem)}
      />
      <AlertDialog
        isOpen={Boolean(removeCustomerPrice)}
        onOpenChange={(open) => !open && setRemoveCustomerPrice(null)}
        title={`Remove ${removeCustomerPrice?.party_name ?? "this customer"}'s price?`}
        description={`${removeCustomerPrice?.party_name ?? "This customer"} will be charged the standard price-list rate for ${removeCustomerPrice?.item_name ?? "this item"} again.`}
        confirmLabel="Remove customer price"
        onConfirm={() => removeCustomerPrice && removeCustomerPriceMutation.mutate(removeCustomerPrice)}
      />
    </>
  );
}

function NewPriceListDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (priceList: SalesPriceList) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("INR");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const mutation = useMutation({
    mutationFn: () => createSalesPriceList({ code, name, currencyCode, validFrom: validFrom || null, validTo: validTo || null }),
    onSuccess: (result) => onCreated(result.priceList),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New price list">
      <div className="flex flex-col gap-4">
        <FormError message={mutation.isError ? errorMessage(mutation.error, "The price list could not be created.") : null} />
        <TextField label="Code" value={code} onChange={setCode} />
        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Currency" value={currencyCode} onChange={setCurrencyCode} />
        <label className="flex flex-col gap-1 text-sm text-text">
          Valid from
          <input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className={dateInputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text">
          Valid to
          <input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} className={dateInputClass} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isDisabled={!code.trim() || !name.trim()} isLoading={mutation.isPending}>
            Create price list
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddPriceDialog({
  priceList,
  options,
  onClose,
  onSaved,
}: {
  priceList: SalesPriceList;
  options: SalesPricingOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [minimumQuantity, setMinimumQuantity] = useState(1);
  const [priceRate, setPriceRate] = useState(0);
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const itemOptions: SelectOption[] = options.items.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }));
  const variantOptions: SelectOption[] = [
    { value: "", label: "All variants" },
    ...options.variants.filter((variant) => variant.item_id === itemId).map((variant) => ({ value: variant.id, label: `${variant.sku} · ${variant.name}` })),
  ];
  const mutation = useMutation({
    mutationFn: () =>
      upsertSalesPriceListItem(priceList.id, {
        itemId,
        variantId: variantId || null,
        minimumQuantity,
        rate: priceRate,
        validFrom: validFrom || null,
        validTo: validTo || null,
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Add price to ${priceList.name}`}>
      <div className="flex flex-col gap-4">
        <FormError message={mutation.isError ? errorMessage(mutation.error, "The price could not be saved.") : null} />
        <Select label="Item" options={itemOptions} value={itemId} onChange={(value) => { setItemId(String(value ?? "")); setVariantId(""); }} placeholder="Select an item" />
        <Select label="Variant" options={variantOptions} value={variantId} onChange={(value) => setVariantId(String(value ?? ""))} isDisabled={!itemId} />
        <NumberField label="Minimum quantity" value={minimumQuantity} onChange={setMinimumQuantity} minValue={0.0001} step={1} />
        <NumberField label={`Rate (${priceList.currency_code})`} value={priceRate} onChange={setPriceRate} minValue={0} step={0.01} />
        <label className="flex flex-col gap-1 text-sm text-text">
          Valid from
          <input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className={dateInputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text">
          Valid to
          <input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} className={dateInputClass} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isDisabled={!itemId} isLoading={mutation.isPending}>
            Save price
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddCustomerPriceDialog({ options, onClose, onSaved }: { options: SalesPricingOptions; onClose: () => void; onSaved: () => void }) {
  const [partyId, setPartyId] = useState("");
  const [itemId, setItemId] = useState("");
  const [minimumQuantity, setMinimumQuantity] = useState(0);
  const [fixedRate, setFixedRate] = useState(0);
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const mutation = useMutation({
    mutationFn: () => upsertSalesCustomerPrice({ partyId, itemId, minimumQuantity, fixedRate, reason, validFrom: validFrom || null, validTo: validTo || null }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add customer price">
      <div className="flex flex-col gap-4">
        <FormError message={mutation.isError ? errorMessage(mutation.error, "The customer price could not be saved.") : null} />
        <Select label="Customer" options={options.customers.map((c) => ({ value: c.id, label: `${c.display_name} (${c.code})` }))} value={partyId} onChange={(value) => setPartyId(String(value ?? ""))} placeholder="Select a customer" />
        <Select label="Item" options={options.items.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} value={itemId} onChange={(value) => setItemId(String(value ?? ""))} placeholder="Select an item" />
        <NumberField label="Minimum quantity" value={minimumQuantity} onChange={setMinimumQuantity} minValue={0} step={1} />
        <NumberField label="Fixed rate" value={fixedRate} onChange={setFixedRate} minValue={0} step={0.01} />
        <TextField label="Reason" value={reason} onChange={setReason} />
        <label className="flex flex-col gap-1 text-sm text-text">
          Valid from
          <input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className={dateInputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text">
          Valid to
          <input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} className={dateInputClass} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isDisabled={!partyId || !itemId || !reason.trim()} isLoading={mutation.isPending}>
            Save customer price
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

