"use client";

// One price list: its currency, tax mode and status, the prices on it
// (searchable), and Add Product, Import Prices, Export, Copy, Set as default,
// Activate / Deactivate and the change history.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Upload } from "lucide-react";
import {
  AlertDialog, Badge, Button, EmptyState, ErrorState, LinkButton, PermissionState, RecordDetailsPage, SearchField, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, buttonVariants,
} from "@vercentlabs/design-system";

import { formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  changePriceListStatus, deletePriceList, errorCode, errorMessage, expirePrice, getPriceList, getPriceListHistory, getProductPrices, listPriceEntries, listPriceLists, priceExportUrl,
  removePrice, type PriceEntry, type PriceList,
} from "../api/price-lists-api";
import { PriceDialog, PriceListFormDialog } from "../components/PriceListDialogs";
import { validity } from "./PriceListsScreen";

const PAGE = 100;
const STATE_LABEL: Record<PriceEntry["state"], { label: string; tone: "success" | "info" | "neutral" | "warning" }> = {
  current: { label: "Current", tone: "success" }, future: { label: "Upcoming", tone: "info" }, expired: { label: "Expired", tone: "neutral" }, inactive: { label: "Removed", tone: "neutral" },
};

export function PriceListDetailScreen({ priceListId }: { priceListId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"edit" | "copy" | "add" | "delete" | null>(null);
  const [editing, setEditing] = useState<PriceEntry | null>(null);
  const [historyFor, setHistoryFor] = useState<PriceEntry | null>(null);
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [state, setState] = useState("active");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => { setSubmitted(search.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const listQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", "list", priceListId), queryFn: () => getPriceList(priceListId) });
  const currencies = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", {}), queryFn: () => listPriceLists({}) });
  const entries = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "price-lists", "entries", priceListId, submitted, state, offset),
    queryFn: () => listPriceEntries(priceListId, { search: submitted || undefined, state, limit: PAGE, offset }),
  });
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "price-lists") }); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") }); };
  const status = useMutation({ mutationFn: (action: "activate" | "deactivate" | "make_default") => changePriceListStatus(priceListId, action), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const entryAction = useMutation({
    mutationFn: ({ entry, action }: { entry: PriceEntry; action: "expire" | "remove" }) => (action === "expire" ? expirePrice(priceListId, entry.id) : removePrice(priceListId, entry.id).then((response) => response.entry)),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });
  const remove = useMutation({
    mutationFn: () => deletePriceList(priceListId),
    onSuccess: () => { refresh(); router.push("/sales/price-lists"); },
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });

  if (listQuery.isLoading) return <LoadingState label="Loading price list" rows={6} />;
  if (listQuery.isError || !listQuery.data)
    return errorCode(listQuery.error) === "PERMISSION_DENIED"
      ? <PermissionState title="You don't have access to price lists" description="Ask an administrator for access." />
      : <ErrorState title="Price list not found" action={{ label: "Back to price lists", onPress: () => router.push("/sales/price-lists") }} />;
  const list: PriceList = listQuery.data;
  const can = list.capabilities!;
  const money = (value: number) => formatMoney(list.currencyCode, value);
  const menu = [
    ...(can.edit ? [{ id: "edit", label: "Edit details", run: () => setDialog("edit") }] : []),
    ...(can.create && can.managePrices ? [{ id: "copy", label: "Copy to a new price list", run: () => setDialog("copy") }] : []),
    ...(can.setDefault && list.isActive && !list.isDefault ? [{ id: "default", label: `Make the default ${list.currencyCode} list`, run: () => status.mutate("make_default") }] : []),
    ...(can.activate ? [list.isActive ? { id: "deactivate", label: "Deactivate", run: () => status.mutate("deactivate") } : { id: "activate", label: "Activate", run: () => status.mutate("activate") }] : []),
    ...(can.activate ? [{ id: "delete", label: "Delete", run: () => setDialog("delete") }] : []),
  ];
  const rows = entries.data?.entries ?? [];
  const total = entries.data?.total ?? 0;

  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{list.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{list.code}</span></>,
        status: (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={list.isActive ? "success" : "neutral"}>{list.isActive ? "Active" : "Inactive"}</StatusBadge>
            {list.isDefault && <Badge tone="info">Default {list.currencyCode}</Badge>}
          </span>
        ),
        fields: [
          { label: "Currency", value: list.currencyCode },
          { label: "Tax mode", value: list.taxModeLabel },
          { label: "Validity", value: validity(list) },
          { label: "Prices", value: String(list.entryCount) },
        ],
        primaryAction: can.managePrices && list.isActive ? <Button variant="primary" onPress={() => setDialog("add")}><Plus className="size-4" aria-hidden="true" />Add product</Button> : undefined,
        secondaryActions: (
          <>
            {can.import && can.managePrices && <LinkButton href={`/sales/price-lists/${list.id}/import`} variant="outline"><Upload className="size-4" aria-hidden="true" />Import prices</LinkButton>}
            {can.export && <a className={buttonVariants({ variant: "outline" })} href={priceExportUrl(list.id)} download><Download className="size-4" aria-hidden="true" />Export</a>}
            <MoreActions actions={menu} />
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          {list.description && <p className="max-w-3xl text-sm text-text-secondary">{list.description}</p>}
          {error && <Notice>{error}</Notice>}
          {!list.isActive && <Notice tone="neutral">Inactive. Documents priced from it keep their prices; it cannot be chosen for new ones.</Notice>}
        </div>
      }
    >
      <Tabs defaultSelectedKey="prices">
        <TabList aria-label="Price list sections">
          <Tab id="prices">Prices ({list.entryCount})</Tab>
          <Tab id="history">History</Tab>
        </TabList>
        <TabPanel id="prices">
          <div className="flex flex-col gap-3 pt-3">
            <div className="flex flex-wrap gap-2">
              <SearchField aria-label="Search prices" placeholder="Search code, name, SKU, category or unit" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Which prices" size="compact" selectedKey={state} onSelectionChange={(key) => { setState(String(key)); setOffset(0); }}
                options={[{ value: "active", label: "All active prices" }, { value: "current", label: "Valid today" }, { value: "future", label: "Upcoming" }, { value: "expired", label: "Expired" }, { value: "inactive", label: "Removed" }]} />
            </div>
            {entries.isLoading ? <LoadingState label="Loading prices" rows={5} /> : rows.length === 0 ? (
              <EmptyState title={submitted || state !== "active" ? "No prices match" : "No prices yet"} description={submitted || state !== "active" ? "Try another search." : "Add products one by one, or import a spreadsheet of prices."} />
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-muted text-left text-text-secondary">
                    <tr>{["Product", "Category", "Unit", "Price", "Validity", "Status", ""].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2">
                          <Link className="font-medium text-brand underline-offset-2 hover:underline" href={`/sales/products/${entry.productId}`}>{entry.productName}</Link>
                          <span className="block text-xs text-text-muted">{[entry.productCode, entry.sku, entry.isService ? "Service" : null, entry.productActive ? null : "Inactive product"].filter(Boolean).join(" · ")}</span>
                        </td>
                        <td className="px-3 py-2">{entry.categoryName ?? ""}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{entry.uomCode}{entry.isBaseUnit ? "" : <span className="text-xs text-text-muted"> (not base)</span>}</td>
                        <td className="px-3 py-2 font-medium whitespace-nowrap tabular-nums">{money(entry.unitPrice)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{validity(entry)}</td>
                        <td className="px-3 py-2"><Badge tone={STATE_LABEL[entry.state].tone}>{STATE_LABEL[entry.state].label}</Badge></td>
                        <td className="px-3 py-2">
                          <span className="flex justify-end gap-1">
                            <Button variant="ghost" size="compact" onPress={() => setHistoryFor(entry)}>History</Button>
                            {can.managePrices && entry.isActive && (
                              <>
                                <Button variant="ghost" size="compact" onPress={() => setEditing(entry)}>Edit</Button>
                                {entry.state === "current" && <Button variant="ghost" size="compact" isDisabled={entryAction.isPending} onPress={() => entryAction.mutate({ entry, action: "expire" })}>End today</Button>}
                                <Button variant="ghost" size="compact" isDisabled={entryAction.isPending} onPress={() => entryAction.mutate({ entry, action: "remove" })}>Remove</Button>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {total > PAGE && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <span className="text-text-secondary">{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
                <Button size="compact" variant="secondary" isDisabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button size="compact" variant="secondary" isDisabled={offset + PAGE >= total} onPress={() => setOffset(offset + PAGE)}>Next</Button>
              </div>
            )}
          </div>
        </TabPanel>
        <TabPanel id="history"><HistoryPanel priceListId={list.id} /></TabPanel>
      </Tabs>
    </RecordDetailsPage>

      {(dialog === "edit" || dialog === "copy") && currencies.data && (
        <PriceListFormDialog mode={dialog} priceList={list} currencies={currencies.data.currencies} capabilities={can} onClose={() => setDialog(null)}
          onSaved={(saved) => { setDialog(null); refresh(); if (saved.id !== list.id) router.push(`/sales/price-lists/${saved.id}`); }} />
      )}
      {(dialog === "add" || editing) && (
        <PriceDialog priceList={list} entry={editing ?? undefined} onClose={() => { setDialog(null); setEditing(null); }} onSaved={() => { setDialog(null); setEditing(null); refresh(); }} />
      )}
      {historyFor && <ProductPricesDialog priceList={list} entry={historyFor} onClose={() => setHistoryFor(null)} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${list.name}?`}
        description="Removes the price list and its prices permanently. A list used by documents, customers, opportunities or POS stores cannot be deleted; deactivate it instead."
        confirmLabel="Delete" isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

// Every price a product has had on this list.
function ProductPricesDialog({ priceList, entry, onClose }: { priceList: PriceList; entry: PriceEntry; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", "product", priceList.id, entry.productId), queryFn: () => getProductPrices(priceList.id, entry.productId) });
  return (
    <AlertDialog isOpen onOpenChange={(open) => !open && onClose()} tone="primary" title={`${entry.productName}: prices on ${priceList.name}`} confirmLabel="Close" onConfirm={onClose}
      description={query.isLoading ? "Loading…" : (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-text">
          {(query.data ?? []).map((price) => (
            <li key={price.id} className="flex justify-between gap-4">
              <span>{price.uomCode} · {validity(price)}{price.isActive ? "" : " · removed"}</span>
              <span className="tabular-nums">{formatMoney(priceList.currencyCode, price.unitPrice)}</span>
            </li>
          ))}
        </ul>
      )} />
  );
}

function HistoryPanel({ priceListId }: { priceListId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", "history", priceListId), queryFn: () => getPriceListHistory(priceListId) });
  if (query.isLoading) return <div className="pt-3"><LoadingState label="Loading history" rows={4} /></div>;
  const entries = query.data ?? [];
  if (!entries.length) return <div className="pt-3"><EmptyState title="No history" description="Changes to this price list and its prices are recorded here." /></div>;
  return (
    <ol className="mt-3 flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
          <span className="font-medium">{entry.summary}</span>
          <span className="text-xs text-text-muted">{[entry.actorName ?? "System", formatDateTime(entry.createdAt)].join(" · ")}</span>
        </li>
      ))}
    </ol>
  );
}

