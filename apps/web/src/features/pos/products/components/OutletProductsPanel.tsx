"use client";

// An outlet's Products tab: what it sells (every sellable product, or the products of chosen shared categories), how stock is shown at the
// counter, the low-stock level, and its quick products (up to 12, in order). Products themselves stay in the Item Master; nothing here
// copies a product, a price or a quantity.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button, Checkbox, CheckboxGroup, IconButton, SearchField, Select, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";

import { PosApiError } from "@/features/pos/shared/http";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getOutletProductSettings, searchProducts, setQuickProducts, updateOutletProductSettings, type PosOutletProductSettings } from "../api/products-api";

const message = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong. Try again.");

export function OutletProductsPanel({ outletId }: { outletId: string }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "pos-outlets", "products", outletId);
  const query = useQuery({ queryKey: key, queryFn: () => getOutletProductSettings(outletId) });
  if (query.isLoading) return <LoadingState label="Loading product settings" rows={4} />;
  if (!query.data) return <Notice>{message(query.error)}</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard data={query.data} outletId={outletId} queryKey={key} />
      <QuickProductsCard data={query.data} outletId={outletId} queryKey={key} />
    </div>
  );
}

function SettingsCard({ data, outletId, queryKey }: { data: PosOutletProductSettings; outletId: string; queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.settings);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateOutletProductSettings(outletId, { ...draft, expectedVersion: data.settings.version }),
    onSuccess: (next) => { queryClient.setQueryData(queryKey, next); setEditing(false); setError(null); void queryClient.invalidateQueries({ queryKey: [...queryKey.slice(0, -2)] }); },
    onError: (failure) => setError(message(failure)),
  });
  const categoryName = (id: string) => data.allCategories.find((category) => category.id === id)?.name ?? "—";
  const pathOf = (id: string) => {
    const names: string[] = [];
    for (let at = data.allCategories.find((category) => category.id === id); at; at = data.allCategories.find((category) => category.id === at!.parentId)) names.unshift(at.name);
    return names.join(" › ");
  };
  if (!editing) {
    return (
      <Panel title="What this outlet sells" description="Search and the quick tiles show only these products; checkout refuses anything else."
        actions={data.capabilities.edit ? <Button variant="secondary" size="compact" onPress={() => { setDraft(data.settings); setEditing(true); }}>Change</Button> : undefined}>
        <FactList columns={2} items={[
          ["Products", data.settings.assortmentPolicy === "all_sellable" ? "Every sellable product" : data.settings.categoryIds.map(categoryName).join(", ") || "No categories"],
          ["Stock status at the counter", data.settings.showStockStatus ? "Shown (in stock, low, out of stock)" : "Hidden (out of stock still blocks adding)"],
          ["Exact quantities", data.settings.showExactStock ? "Shown to people who may see stock" : "Never shown"],
          ["Low stock at", `${data.settings.lowStockThreshold} units or fewer (Inventory's reorder level comes first when set)`],
          ["Frequent sellers", data.settings.suggestFrequent ? "Fill the quick tiles after the shortlist" : "Shortlist only"],
        ]} />
      </Panel>
    );
  }
  return (
    <Panel title="What this outlet sells" description="Categories are the shared Item Categories; a category includes its subcategories.">
      {error && <Notice>{error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Products" selectedKey={draft.assortmentPolicy} onSelectionChange={(value) => setDraft({ ...draft, assortmentPolicy: String(value) as typeof draft.assortmentPolicy })}
          options={[{ value: "all_sellable", label: "Every sellable product" }, { value: "selected_categories", label: "Products of chosen categories" }]} />
        <TextField label="Low stock at (units)" value={draft.lowStockThreshold} onChange={(value) => setDraft({ ...draft, lowStockThreshold: value })} inputMode="decimal" />
      </div>
      {draft.assortmentPolicy === "selected_categories" && (
        <CheckboxGroup aria-label="Categories this outlet sells" value={draft.categoryIds} onChange={(value) => setDraft({ ...draft, categoryIds: value })}>
          <div className="grid gap-1 sm:grid-cols-2">
            {data.allCategories.map((category) => <Checkbox key={category.id} value={category.id}>{pathOf(category.id)}</Checkbox>)}
          </div>
        </CheckboxGroup>
      )}
      <div className="flex flex-col gap-2">
        <Switch isSelected={draft.showStockStatus} onChange={(value) => setDraft({ ...draft, showStockStatus: value })}>Show stock status at the counter</Switch>
        <Switch isSelected={draft.showExactStock} onChange={(value) => setDraft({ ...draft, showExactStock: value })}>Show exact quantities to people who may see stock</Switch>
        <Switch isSelected={draft.suggestFrequent} onChange={(value) => setDraft({ ...draft, suggestFrequent: value })}>Fill quick tiles with this outlet&apos;s frequent sellers</Switch>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={() => setEditing(false)}>Cancel</Button>
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
      </div>
    </Panel>
  );
}

function QuickProductsCard({ data, outletId, queryKey }: { data: PosOutletProductSettings; outletId: string; queryKey: readonly unknown[] }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [list, setList] = useState<Array<{ itemId: string; uomId: string | null; label: string }> | null>(null);
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editing = list !== null;
  const found = useQuery({ queryKey: scopedQueryKey(workspace, "pos-products", "quick-picker", outletId, term), queryFn: () => searchProducts({ outletId, q: term }),
    enabled: editing && term.trim().length >= 2 });
  const save = useMutation({
    mutationFn: () => setQuickProducts(outletId, list!.map(({ itemId, uomId }) => ({ itemId, uomId }))),
    onSuccess: (next) => { queryClient.setQueryData(queryKey, next); setList(null); setError(null); },
    onError: (failure) => setError(failure instanceof PosApiError ? failure.message : message(failure)),
  });
  const move = (index: number, by: number) => setList((current) => {
    const next = [...current!];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    return next;
  });
  return (
    <Panel title="Quick products" description="Up to 12 tiles on the empty checkout screen, in this order. Products that can no longer be sold drop off by themselves."
      actions={data.capabilities.edit && !editing ? (
        <Button variant="secondary" size="compact" onPress={() => setList(data.quickProducts.map((row) => ({ itemId: row.itemId, uomId: row.uomId, label: `${row.name} (${row.sku})${row.uomCode ? ` · ${row.uomCode}` : ""}` })))}>Change</Button>
      ) : undefined}>
      {error && <Notice>{error}</Notice>}
      {!editing ? (
        <LinesTable columns={["#", "Product", "Unit", ""]} empty={data.quickProducts.length ? undefined : "No shortlist yet: the tiles show this outlet's frequent sellers."}>
          {data.quickProducts.map((row, index) => (
            <tr key={row.id}>
              <Cell>{index + 1}</Cell>
              <Cell><span className="font-medium">{row.name}</span> <span className="text-text-muted">{row.sku}</span></Cell>
              <Cell>{row.uomCode ?? "Sales unit"}</Cell>
              <Cell>{row.sellable ? null : <StatusBadge tone="warning">Not sellable — hidden</StatusBadge>}</Cell>
            </tr>
          ))}
        </LinesTable>
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col gap-1">
            {list!.map((row, index) => (
              <li key={`${row.itemId}:${row.uomId ?? ""}`} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm">
                <span className="w-6 tabular-nums text-text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <IconButton size="compact" aria-label="Move up" isDisabled={index === 0} onPress={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden="true" /></IconButton>
                <IconButton size="compact" aria-label="Move down" isDisabled={index === list!.length - 1} onPress={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden="true" /></IconButton>
                <IconButton size="compact" aria-label="Remove" onPress={() => setList(list!.filter((_, at) => at !== index))}><X className="size-4" aria-hidden="true" /></IconButton>
              </li>
            ))}
            {!list!.length && <li className="text-sm text-text-muted">No quick products.</li>}
          </ol>
          {list!.length < 12 && (
            <div className="flex flex-col gap-1">
              <SearchField label="Add a product" placeholder="Name, SKU or barcode" value={term} onChange={setTerm} />
              {(found.data?.products ?? []).filter((product) => product.isSellableNow || product.unavailableReason?.code === "POS_PRODUCT_OUT_OF_STOCK").slice(0, 8).map((product) => (
                <button key={`${product.itemId}:${product.saleUomId}`} type="button" className="flex min-h-10 items-center justify-between rounded-[var(--radius-control)] px-3 text-left text-sm hover:bg-surface-muted"
                  onClick={() => { if (!list!.some((row) => row.itemId === product.itemId)) setList([...list!, { itemId: product.itemId, uomId: null, label: `${product.name} (${product.sku})` }]); setTerm(""); }}>
                  <span>{product.name} <span className="text-text-muted">{product.sku}</span></span>
                  <span className="text-xs text-text-muted">Add</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setList(null)}>Cancel</Button>
            <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
