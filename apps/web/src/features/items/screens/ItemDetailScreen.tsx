"use client";

// The item page: Overview, Inventory, Units & Identifiers, Tracking, Purchasing, Sales, Tax & Accounting, Variants, Attachments and
// History. Every quantity, price and cost on it is read from the module that owns it; the stock actions open Inventory's own
// transactions (ledger, transfer, adjustment, opening stock) and never change the item.
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog, Badge, Button, Dialog, EmptyState, ErrorState, LinkButton, Menu, MenuItem, MenuTrigger, PermissionState, RecordDetailsPage, Select, Tab, TabList, TabPanel, Tabs,
  TextArea, TextField,
} from "@vercentlabs/design-system";

import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addIdentifier, checkActivation, createVariant, deleteItem, errorCode, errorMessage, getItem, getItemBatches, getItemDetails, getItemHistory, getItemOptions,
  getItemSerials, getVariants, itemFileUrl, listItemFiles, listItemMovements, listItemTransactions, makePrimaryIdentifier, removeIdentifier, removeItemFile,
  setItemStatus, setPrimaryImage, uploadItemFile, type Item, type ItemDetails, type ItemOptions,
} from "../api/items-api";
import { ChangeSkuDialog, SkuHistoryList } from "../components/ChangeSkuDialog";
import { ItemNegativeStockSetting } from "@/features/negative-stock/components/ItemNegativeStockSetting";
import { ItemReplenishmentPanel } from "@/features/replenishment/components/ItemReplenishmentPanel";
import { ItemValuationCard } from "@/features/valuation/components/ValuationCards";
import { RelatedDocuments } from "@/shared/related/RelatedDocuments";

import { ItemUnitsCard } from "../components/ItemUnitsCard";
import { ReclassifyDialog } from "../components/ReclassifyDialog";
import { CategoryPath, CopySkuButton, ErrorBanner, ItemTypeBadge, LENS, LifecycleBadge, attributesText, money, quantity, taxLine, unitLine, yesNo, type ItemLens } from "../item-format";

function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-text">{title}</h3>{actions}</div>
      {children}
    </section>
  );
}
function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">{label}</dt>
          <dd className="text-sm break-words">{value === null || value === undefined || value === "" ? <span className="text-text-muted">Not set</span> : value}</dd>
        </div>
      ))}
    </dl>
  );
}
const unit = (value: Item["baseUom"]) => (value ? `${value.name} (${value.code})` : null);
const TABS = ["overview", "inventory", "units", "tracking", "replenishment", "valuation", "purchasing", "sales", "tax", "variants", "related", "attachments", "history"] as const;

export function ItemDetailScreen({ itemId, lens = "inventory" }: { itemId: string; lens?: ItemLens }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = LENS[lens].base;
  const requested = useSearchParams().get("tab");
  const [tab, setTab] = useState<string>(requested && (TABS as readonly string[]).includes(requested) ? requested : lens === "sales" ? "sales" : "overview");
  const [dialog, setDialog] = useState<"deactivate" | "delete" | "activate" | "reclassify" | "sku" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const itemQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId), queryFn: () => getItem(itemId) });
  const detailsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId, "details"), queryFn: () => getItemDetails(itemId) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  const activation = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId, "activation"), queryFn: () => checkActivation(itemId), enabled: dialog === "activate" });
  const refresh = () => { setDialog(null); setError(null); setReason(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); };
  const status = useMutation({
    mutationFn: (action: "activate" | "deactivate") => setItemStatus(itemId, action, reason.trim() || undefined),
    onSuccess: refresh,
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });
  const remove = useMutation({
    mutationFn: () => deleteItem(itemId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); router.push(base); },
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });

  if (itemQuery.isLoading) return <LoadingState label="Loading item" rows={6} />;
  if (itemQuery.isError || !itemQuery.data)
    return errorCode(itemQuery.error) === "PERMISSION_DENIED"
      ? <PermissionState title="You don't have access to items" description="Ask an administrator for access." />
      : <ErrorState title="Item not found" action={{ label: `Back to ${LENS[lens].title}`, onPress: () => router.push(base) }} />;
  const item = itemQuery.data;
  const can = item.capabilities!;
  const details = detailsQuery.data;
  const options = optionsQuery.data;
  const stock = item.type === "stock";
  const has = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.roleSlugs.includes("system_administrator") || workspace.permissions.includes(permission);
  const menu = [
    ...(can.changeSku ? [{ id: "sku", label: "Change SKU", run: () => setDialog("sku") }] : []),
    ...(can.reclassify && !item.parent ? [{ id: "reclassify", label: "Reclassify", run: () => setDialog("reclassify") }] : []),
    ...(can.activate && !item.isActive ? [{ id: "activate", label: item.isDraft ? "Activate" : "Reactivate", run: () => setDialog("activate") }] : []),
    ...(can.activate && item.isActive ? [{ id: "deactivate", label: "Deactivate", run: () => setDialog("deactivate") }] : []),
    ...(can.delete ? [{ id: "delete", label: "Delete", run: () => setDialog("delete") }] : []),
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: <LinkButton href={base} variant="ghost" size="compact">{LENS[lens].title}</LinkButton>,
          title: (
            <span className="flex items-center gap-3">
              {item.imageAttachmentId && (
                // eslint-disable-next-line @next/next/no-img-element -- a private, authorised file, not a static asset
                <img src={itemFileUrl(item.id, item.imageAttachmentId)} alt="" className="size-12 rounded-[var(--radius-control)] border border-border object-cover" />
              )}
              <span className="flex flex-col"><span>{item.name}</span><span className="flex items-center gap-1 text-sm font-normal text-text-secondary">SKU <span className="tabular-nums">{item.code}</span><CopySkuButton sku={item.code} />{item.barcode ? ` · ${item.barcode}` : ""}</span></span>
            </span>
          ),
          status: <span className="flex gap-1"><ItemTypeBadge item={item} /><LifecycleBadge status={item.lifecycleStatus} /></span>,
          fields: [
            { label: "Category", value: <CategoryPath item={item} /> },
            { label: "Units", value: unitLine(item) || "Not set" },
            { label: "Tracking", value: stock ? item.trackingLabel : "Not tracked" },
            { label: "Tax", value: taxLine(item) || "Not set" },
          ],
          primaryAction: can.edit ? <LinkButton href={`${base}/${item.id}/edit`} variant="primary">Edit</LinkButton> : undefined,
          secondaryActions: menu.length ? (
            <MenuTrigger>
              <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
              <Menu onAction={(key) => menu.find((entry) => entry.id === key)?.run()}>{menu.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}</Menu>
            </MenuTrigger>
          ) : undefined,
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {notice && <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">{notice}</p>}
            {item.isDraft && <p role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">Draft. Finish setting it up and activate it to use it on transactions.</p>}
            {item.lifecycleStatus === "inactive" && <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">Inactive. It stays on existing documents, reports and stock, but cannot be chosen on new transactions. Existing stock can still be returned, transferred or adjusted.</p>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Item sections">
            <Tab id="overview">Overview</Tab>
            {stock && details?.access.stock && <Tab id="inventory">Inventory</Tab>}
            <Tab id="units">Units &amp; Identifiers</Tab>
            {stock && <Tab id="tracking">Tracking</Tab>}
            {stock && has("stock.reorder.view") && <Tab id="replenishment">Replenishment</Tab>}
            {stock && has("stock.valuation.view") && <Tab id="valuation">Valuation</Tab>}
            <Tab id="purchasing">Purchasing</Tab>
            <Tab id="sales">Sales</Tab>
            <Tab id="tax">Tax &amp; Accounting</Tab>
            {(item.isVariantTemplate || item.parent) && <Tab id="variants">Variants</Tab>}
            <Tab id="related">Related</Tab>
            <Tab id="attachments">Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><OverviewPanel item={item} base={base} /></TabPanel>
          <TabPanel id="inventory"><InventoryPanel item={item} details={details} /></TabPanel>
          <TabPanel id="units"><UnitsPanel item={item} details={details} options={options} /></TabPanel>
          <TabPanel id="tracking"><TrackingPanel item={item} canSeeStock={Boolean(details?.access.stock)} /></TabPanel>
          <TabPanel id="replenishment"><ItemReplenishmentPanel itemId={item.id} /></TabPanel>
          <TabPanel id="valuation"><div className="pt-3"><ItemValuationCard itemId={item.id} /></div></TabPanel>
          <TabPanel id="purchasing"><PurchasingPanel item={item} details={details} /></TabPanel>
          <TabPanel id="sales"><SalesPanel item={item} details={details} /></TabPanel>
          <TabPanel id="tax"><TaxPanel item={item} details={details} /></TabPanel>
          <TabPanel id="variants"><VariantsPanel item={item} base={base} /></TabPanel>
          <TabPanel id="related"><div className="pt-3"><RelatedDocuments type="item" id={item.id} /></div></TabPanel>
          <TabPanel id="attachments"><FilesPanel item={item} canEdit={can.edit} /></TabPanel>
          <TabPanel id="history"><HistoryPanel itemId={item.id} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>
      <Dialog isOpen={dialog === "activate"} onOpenChange={(open) => !open && setDialog(null)} title={item.isDraft ? `Activate ${item.name}?` : `Reactivate ${item.name}?`}
        description="Once active, it can be chosen on purchase orders, sales documents and stock transactions, as its flags allow.">
        <div className="flex flex-col gap-4">
          {activation.isLoading ? <LoadingState label="Checking" rows={1} /> : activation.data && !activation.data.ready ? (
            <div role="alert" className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
              <p className="font-medium">Finish these first</p>
              <ul className="list-disc pl-5">{activation.data.issues.map((issue) => <li key={issue.field}>{issue.message}</li>)}</ul>
            </div>
          ) : null}
          {!item.isDraft && <TextArea label="Reason (optional)" rows={2} value={reason} onChange={setReason} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" isLoading={status.isPending} isDisabled={!activation.data?.ready} onPress={() => status.mutate("activate")}>{item.isDraft ? "Activate" : "Reactivate"}</Button>
          </div>
        </div>
      </Dialog>
      <Dialog isOpen={dialog === "deactivate"} onOpenChange={(open) => !open && setDialog(null)} title={`Deactivate ${item.name}?`}
        description="It stays on every existing document, report and stock balance, but can no longer be chosen on new purchase orders, sales documents or POS sales. Its stock can still be returned, transferred, adjusted or disposed of.">
        <div className="flex flex-col gap-4">
          <TextArea label="Reason (optional)" rows={2} value={reason} onChange={setReason} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setDialog(null)}>Cancel</Button><Button variant="danger" isLoading={status.isPending} onPress={() => status.mutate("deactivate")}>Deactivate</Button></div>
        </div>
      </Dialog>
      <ChangeSkuDialog item={item} isOpen={dialog === "sku"} onClose={(message) => { setDialog(null); if (message) setNotice(message); }} />
      <ReclassifyDialog item={item} options={options} isOpen={dialog === "reclassify"} onClose={(message) => { setDialog(null); if (message) setNotice(message); }} />
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${item.name}?`}
        description="This removes it permanently. Only an item that has never been used on any document, price list, stock movement, variant or BOM can be deleted; otherwise deactivate it."
        confirmLabel="Delete" isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function OverviewPanel({ item, base }: { item: Item; base: string }) {
  return (
    <div className="grid gap-4 pt-3 lg:grid-cols-2">
      <Card title="Identity">
        <Facts items={[["Item name", item.name], ["SKU", <span key="sku" className="inline-flex items-center gap-1 tabular-nums">{item.code}<CopySkuButton sku={item.code} />
          <span className="text-xs text-text-muted">{item.skuGenerationMode === "automatic" ? "(generated)" : ""}</span></span>], ["Item type", item.isVariantTemplate ? "Variant template" : item.typeLabel], ["Category", <CategoryPath key="category" item={item} />],
          ["Brand", item.brand], ["Manufacturer", item.manufacturerName], ["Manufacturer part number", item.manufacturerPartNumber], ["Primary barcode", item.barcode],
          ...(item.parent ? [["Variant of", <Link key="parent" className="text-brand hover:underline" href={`${base}/${item.parent.id}`}>{item.parent.name} ({item.parent.code})</Link>] as [string, ReactNode],
            ["Attributes", attributesText(item.variantAttributes)] as [string, ReactNode]] : [])]} />
        {item.description && <p className="border-t border-border pt-3 text-sm whitespace-pre-wrap text-text-secondary">{item.description}</p>}
        {item.previousSkus.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <h4 className="text-xs font-medium text-text-muted">Previous SKUs (still found by search, never reused)</h4>
            <SkuHistoryList item={item} />
          </div>
        )}
      </Card>
      <Card title="Use">
        <Facts items={[["Status", item.lifecycleLabel], ["Purchasable", yesNo(item.isPurchasable)], ["Sellable", yesNo(item.isSellable)], ["Inventory tracked", yesNo(item.inventoryTracked)],
          ["Base unit", unit(item.baseUom)], ["Tracking", item.type === "stock" ? item.trackingLabel : "None"],
          ["Created", [item.createdByName, formatDateTime(item.createdAt)].filter(Boolean).join(" · ")], ["Last updated", [item.updatedByName, formatDateTime(item.updatedAt)].filter(Boolean).join(" · ")]]} />
      </Card>
      {item.type !== "service" && (item.netWeight !== null || item.length !== null) && (
        <Card title="Physical details">
          <Facts items={[["Net weight", item.netWeight !== null ? quantity(item.netWeight, item.weightUom) : null], ["Gross weight", item.grossWeight !== null ? quantity(item.grossWeight, item.weightUom) : null],
            ["Dimensions (L × W × H)", item.length !== null ? `${item.length} × ${item.width ?? "?"} × ${item.height ?? "?"} ${item.dimensionUom ?? ""}` : null],
            ["Volume", item.volume !== null ? `${quantity(item.volume)} ${item.dimensionUom ?? ""}³` : null]]} />
        </Card>
      )}
    </div>
  );
}

function InventoryPanel({ item, details }: { item: Item; details?: ItemDetails }) {
  const workspace = useWorkspaceContext();
  const movements = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", item.id, "movements"), queryFn: () => listItemMovements(item.id) });
  const inventory = details?.inventory;
  if (!details) return <div className="pt-3"><LoadingState label="Loading stock" rows={3} /></div>;
  if (!inventory) return <div className="pt-3"><EmptyState title="Stock not shown" description="You do not have permission to see this item's stock." /></div>;
  const totals = inventory.totals;
  const uom = inventory.uom;
  return (
    <div className="flex flex-col gap-4 pt-3">
      <ItemStockActions itemId={item.id} />
      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {([["On hand", totals.onHand], ["Reserved", totals.reserved], ["Available", totals.available], ["Incoming", totals.incoming], ["Outgoing", totals.outgoing]] as Array<[string, number]>).map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold tabular-nums">{quantity(value, uom)}</p></div>
          ))}
        </div>
      )}
      <p className="text-xs text-text-muted">Available is on hand less valid reservations (stock in quality locations or blocked batches is not available). Incoming is what confirmed purchase orders still expect; outgoing is what confirmed sales orders still have to deliver. Neither is counted in on hand.{totals?.value !== undefined ? ` Inventory value: ${money(totals.value)}.` : ""}</p>
      <Card title="By warehouse">
        {inventory.warehouses.length === 0 ? <p className="text-sm text-text-muted">No stock yet. Opening stock is entered as an Inventory transaction.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Warehouse", "On hand", "Reserved", "Available", "Incoming", "Outgoing", ...(details.access.cost ? ["Average cost", "Value"] : [])].map((heading) => <th key={heading} className="py-1 pr-3 font-medium">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {inventory.warehouses.map((entry) => (
                  <tr key={entry.warehouseId}>
                    <td className="py-1.5 pr-3">{entry.name}</td>
                    {[entry.onHand, entry.reserved, entry.available, entry.incoming, entry.outgoing].map((value, index) => <td key={index} className="pr-3 tabular-nums">{quantity(value)}</td>)}
                    {details.access.cost && <><td className="pr-3 tabular-nums">{entry.averageCost === null || entry.averageCost === undefined ? "" : money(entry.averageCost)}</td><td className="pr-3 tabular-nums">{money(entry.value ?? 0)}</td></>}
                  </tr>
                ))}
                {totals && inventory.warehouses.length > 1 && (
                  <tr className="font-semibold"><td className="py-1.5 pr-3">Total</td>{[totals.onHand, totals.reserved, totals.available, totals.incoming, totals.outgoing].map((value, index) => <td key={index} className="pr-3 tabular-nums">{quantity(value)}</td>)}{details.access.cost && <><td /><td className="pr-3 tabular-nums">{money(totals.value ?? 0)}</td></>}</tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Recent movements">
        {movements.isLoading ? <LoadingState label="Loading" rows={2} /> : !(movements.data ?? []).length ? <p className="text-sm text-text-muted">No stock movements yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {(movements.data ?? []).slice(0, 15).map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{row.number} · {row.type.replace(/_/g, " ")} · {row.warehouse ?? ""}{row.batch ? ` · batch ${row.batch}` : ""}{row.serial ? ` · serial ${row.serial}` : ""}</span>
                <span className="tabular-nums">{row.quantity > 0 ? "+" : ""}{quantity(row.quantity, row.uom)} · {formatDate(row.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UnitsPanel({ item, details, options }: { item: Item; details?: ItemDetails; options?: ItemOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = item.capabilities!;
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState({ value: "", type: "barcode", uomId: "base" });
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products", "product", item.id) }); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products", "list") }); };
  const fail = (failure: unknown) => setError(errorMessage(failure));
  const addCode = useMutation({ mutationFn: () => addIdentifier(item.id, { value: newCode.value, type: newCode.type, uomId: newCode.uomId === "base" ? null : newCode.uomId }),
    onSuccess: () => { setNewCode({ value: "", type: "barcode", uomId: "base" }); refresh(); }, onError: fail });
  const primary = useMutation({ mutationFn: (id: string) => makePrimaryIdentifier(item.id, id), onSuccess: refresh, onError: fail });
  const dropCode = useMutation({ mutationFn: (id: string) => removeIdentifier(item.id, id), onSuccess: refresh, onError: fail });
  if (!details) return <div className="pt-3"><LoadingState label="Loading" rows={3} /></div>;
  const base = item.baseUom?.code ?? "";
  return (
    <div className="flex flex-col gap-4 pt-3">
      <ErrorBanner message={error} />
      <ItemUnitsCard item={item} options={options} />
      {!item.isService && (
        <Card title="Barcodes and identifiers">
          {details.identifiers.length === 0 ? <p className="text-sm text-text-muted">No barcode yet. A scanner finds the item by any of its barcodes or its SKU.</p> : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {details.identifiers.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="flex flex-wrap items-center gap-2"><span className="font-medium tabular-nums">{entry.value}</span><span className="text-text-muted">{entry.typeLabel}{entry.uom ? ` · per ${entry.uom}` : ""}</span>{entry.isPrimary && <Badge tone="success">Primary</Badge>}</span>
                  {can.manageIdentifiers && (
                    <span className="flex gap-1">
                      {!entry.isPrimary && entry.type !== "internal" && <Button size="compact" variant="ghost" onPress={() => primary.mutate(entry.id)}>Make primary</Button>}
                      <Button size="compact" variant="ghost" onPress={() => dropCode.mutate(entry.id)}>Remove</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {can.manageIdentifiers && (
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <TextField label="Barcode or code" size="compact" value={newCode.value} onChange={(value) => setNewCode({ ...newCode, value: value.replace(/\s/g, "") })} />
              <Select label="Type" size="compact" selectedKey={newCode.type} onSelectionChange={(key) => setNewCode({ ...newCode, type: String(key) })}
                options={(options?.identifierTypes ?? []).map((entry) => ({ value: entry.code, label: entry.label }))} />
              <Select label="For unit" size="compact" selectedKey={newCode.uomId} onSelectionChange={(key) => setNewCode({ ...newCode, uomId: String(key) })}
                options={[{ value: "base", label: `${base} (base)` }, ...details.conversions.map((entry) => ({ value: entry.uomId, label: entry.uom }))]} />
              <Button size="compact" variant="secondary" isLoading={addCode.isPending} isDisabled={!newCode.value} onPress={() => addCode.mutate()}>Add</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function TrackingPanel({ item, canSeeStock }: { item: Item; canSeeStock: boolean }) {
  const workspace = useWorkspaceContext();
  const batches = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", item.id, "batches"), queryFn: () => getItemBatches(item.id), enabled: canSeeStock && item.trackingType === "batch" });
  const serials = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", item.id, "serials"), queryFn: () => getItemSerials(item.id), enabled: canSeeStock && item.trackingType === "serial" });
  return (
    <div className="flex flex-col gap-4 pt-3">
      <Card title="Tracking rules">
        <Facts items={[["Tracking mode", item.trackingLabel], ...(item.trackingType === "batch" ? [["Expiry tracking", yesNo(item.requiresExpiryDate)] as [string, ReactNode],
          ["Typical shelf life", item.shelfLifeDays ? `${item.shelfLifeDays} days` : null] as [string, ReactNode]] : [])]} />
        {item.inventoryTracked && <ItemNegativeStockSetting itemId={item.id} policy={item.negativeStockPolicy} trackingType={item.trackingType} />}
        <p className="text-xs text-text-muted">The item says what must be recorded; the batches and serial numbers themselves are Inventory records, created by goods receipts and other stock transactions. The tracking mode cannot change once stock has moved.</p>
      </Card>
      {item.trackingType === "batch" && canSeeStock && (
        <Card title="Batches">
          {batches.isLoading ? <LoadingState label="Loading" rows={2} /> : !(batches.data ?? []).length ? <p className="text-sm text-text-muted">No batches yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Batch", "Manufactured", "Expires", "On hand", "Status"].map((heading) => <th key={heading} className="py-1 pr-3 font-medium">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {(batches.data ?? []).map((batch) => (
                  <tr key={batch.id}><td className="py-1.5 pr-3 font-medium">{batch.batchNumber}</td><td className="pr-3">{batch.manufacturedOn ? formatDate(batch.manufacturedOn) : ""}</td>
                    <td className="pr-3">{batch.expiresOn ? formatDate(batch.expiresOn) : ""}{batch.expired && <Badge tone="danger">Expired</Badge>}</td><td className="pr-3 tabular-nums">{quantity(batch.onHand, item.baseUom?.code)}</td><td className="pr-3">{batch.status}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {item.trackingType === "serial" && canSeeStock && (
        <Card title="Serial numbers">
          {serials.isLoading ? <LoadingState label="Loading" rows={2} /> : !(serials.data ?? []).length ? <p className="text-sm text-text-muted">No serial numbers yet.</p> : (
            <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {(serials.data ?? []).map((serial) => <li key={serial.id} className="flex justify-between gap-2 rounded-[var(--radius-control)] border border-border px-2 py-1"><span className="font-medium tabular-nums">{serial.serialNumber}</span><span className="text-text-muted">{serial.status} · {serial.warehouse ?? ""}</span></li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function PurchasingPanel({ item, details }: { item: Item; details?: ItemDetails }) {
  const last = details?.purchasing.lastPurchase;
  const lists = details?.access.procurement ? [{ id: "purchases", label: "Purchase orders" }, ...(item.type !== "service" ? [{ id: "receipts", label: "Goods receipts" }, { id: "purchase_returns", label: "Purchase returns" }] : [])] : [];
  return (
    <div className="flex flex-col gap-4 pt-3">
      <Card title="Buying">
        <Facts items={[["Purchasable", yesNo(item.isPurchasable)], ["Default purchase unit", item.purchaseUomFactor && item.purchaseUomFactor !== 1 ? `${item.purchaseUom?.code} of ${item.purchaseUomFactor} ${item.baseUom?.code}` : unit(item.purchaseUom)],
          ...(details?.access.cost ? [["Last purchase price", last ? <span key="last">{formatMoney(last.currencyCode, last.unitPrice)} on <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${last.purchaseOrderId}`}>{last.purchaseOrderNumber}</Link> ({formatDate(last.date)})</span> : "No purchase yet"] as [string, ReactNode]] : []),
          ["Purchase description", item.purchaseDescription]]} />
        <p className="text-xs text-text-muted">The agreed price is set on each purchase order; the last price is read from them.</p>
      </Card>
      {lists.length > 0 && <TransactionsPanel itemId={item.id} tabs={lists} />}
    </div>
  );
}

function SalesPanel({ item, details }: { item: Item; details?: ItemDetails }) {
  const lists = details?.access.sales ? [{ id: "orders", label: "Sales orders" }, { id: "quotations", label: "Quotations" }, ...(item.type !== "service" ? [{ id: "deliveries", label: "Deliveries" }, { id: "sales_returns", label: "Sales returns" }] : []),
    ...(details.access.accounting ? [{ id: "invoices", label: "Invoices" }] : [])] : [];
  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Selling">
          <Facts items={[["Sellable", yesNo(item.isSellable)], ["Default sales unit", item.salesUomFactor && item.salesUomFactor !== 1 ? `${item.salesUom?.code} of ${item.salesUomFactor} ${item.baseUom?.code}` : unit(item.salesUom)], ["Tax", taxLine(item)]]} />
          {item.salesDescription && <p className="border-t border-border pt-3 text-sm whitespace-pre-wrap">{item.salesDescription}</p>}
        </Card>
        <Card title="Price lists">
          {!details ? <LoadingState label="Loading" rows={2} /> : details.sales.priceLists.length === 0 ? <p className="text-sm text-text-muted">Not on any price list yet: documents ask for a price. Prices are kept in price lists, not on the item.</p> : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {details.sales.priceLists.map((entry) => (
                <li key={`${entry.id}-${entry.minimumQuantity}-${entry.uom}`} className="flex justify-between gap-2 py-1.5">
                  <Link className="text-brand underline-offset-2 hover:underline" href="/sales/price-lists">{entry.name}</Link>
                  <span className="tabular-nums">{formatMoney(entry.currencyCode, entry.rate)}{entry.uom ? ` / ${entry.uom}` : ""}{entry.minimumQuantity > 1 ? ` from ${entry.minimumQuantity}` : ""}{entry.taxInclusive ? " incl. tax" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {lists.length > 0 && <TransactionsPanel itemId={item.id} tabs={lists} />}
    </div>
  );
}

function TaxPanel({ item, details }: { item: Item; details?: ItemDetails }) {
  return (
    <div className="grid gap-4 pt-3 lg:grid-cols-2">
      <Card title="Tax classification">
        <Facts items={[[item.hsnSacLabel, item.hsnSacCode], ["Tax profile", item.taxCategoryName], ["GST rate today", item.gstRate !== null ? `${item.gstRate}%` : null], ["Cess", item.cessRate ? `${item.cessRate}%` : null]]} />
        <p className="text-xs text-text-muted">Defaults only: each document works out CGST and SGST, or IGST, from this, the party and the place of supply, and keeps its own copy. A change applies to new documents.</p>
      </Card>
      <Card title="Inventory accounting">
        <Facts items={[["Category", <CategoryPath key="category" item={item} />], ["Valuation method", item.type === "stock" ? item.valuationLabel : "Not valued"],
          ...(item.type !== "service" ? [["Inventory profile", item.inventoryProfileName] as [string, ReactNode]] : []), ["Accounting profile", item.accountingProfileName]]} />
        {details?.accounting.accounts.length ? (
          <ul className="flex flex-col divide-y divide-border border-t border-border text-sm">
            {details.accounting.accounts.map((account) => <li key={account.key} className="flex justify-between gap-2 py-1.5"><span className="text-text-secondary">{account.label}</span><span>{account.code ? `${account.code} · ${account.name}` : <span className="text-text-muted">Not mapped</span>}</span></li>)}
          </ul>
        ) : null}
        <p className="text-xs text-text-muted">Accounts come from an account mapping for this item, then the item&apos;s Finance profiles, then the mappings for its category or the company default. Changing the category never changes the profiles. Current cost and value are read from Inventory valuation.</p>
      </Card>
    </div>
  );
}

function VariantsPanel({ item, base }: { item: Item; base: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const templateId = item.isVariantTemplate ? item.id : item.parent?.id ?? item.id;
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", templateId, "variants"), queryFn: () => getVariants(templateId) });
  const [open, setOpen] = useState(false);
  const [attributes, setAttributes] = useState([{ name: "", value: "" }]);
  const [code, setCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createVariant(templateId, { attributes: Object.fromEntries(attributes.filter((entry) => entry.name.trim() && entry.value.trim()).map((entry) => [entry.name.trim(), entry.value.trim()])),
      code: code.trim() || undefined, barcode: barcode.trim() || undefined }),
    onSuccess: (variant) => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); setOpen(false); router.push(`${base}/${variant.id}`); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const variants = query.data?.variants ?? [];
  return (
    <div className="flex flex-col gap-4 pt-3">
      <Card title={item.isVariantTemplate ? "Variants" : `Variants of ${item.parent?.name ?? ""}`}
        actions={item.isVariantTemplate && item.capabilities?.create ? <Button size="compact" variant="secondary" onPress={() => { setError(null); setOpen(true); }}>Create variant</Button> : undefined}>
        <p className="text-xs text-text-muted">Each variant is an item of its own: its own SKU, barcode, stock and transactions. The template is never stocked, bought or sold.</p>
        {item.isVariantTemplate && query.data?.totals && variants.length > 0 && (
          <p className="text-sm">Total across variants: <span className="font-medium tabular-nums">{quantity(query.data.totals.onHand)}</span> on hand, <span className="tabular-nums">{quantity(query.data.totals.available)}</span> available <span className="text-xs text-text-muted">(the sum of the variants&apos; own stock; the template holds none)</span></p>
        )}
        {query.isLoading ? <LoadingState label="Loading" rows={2} /> : variants.length === 0 ? <p className="text-sm text-text-muted">No variants yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["SKU", "Variant", "Attributes", ...(query.data?.showsStock ? ["On hand"] : []), "Status"].map((heading) => <th key={heading} className="py-1 pr-3 font-medium">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {variants.map((variant) => (
                <tr key={variant.id} className={variant.id === item.id ? "bg-surface-muted" : undefined}>
                  <td className="py-1.5 pr-3"><Link className="font-medium text-brand hover:underline" href={`${base}/${variant.id}`}>{variant.code}</Link></td>
                  <td className="pr-3">{variant.name}</td><td className="pr-3">{attributesText(variant.variantAttributes)}</td>
                  {query.data?.showsStock && <td className="pr-3 tabular-nums">{variant.type === "stock" ? quantity(variant.onHand ?? 0, variant.baseUom?.code) : ""}</td>}
                  <td className="pr-3"><LifecycleBadge status={variant.lifecycleStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog isOpen={open} onOpenChange={(next) => !next && setOpen(false)} title="Create variant" description="Category, units, tax and valuation come from the template.">
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {attributes.map((entry, index) => (
            <div key={index} className="grid grid-cols-2 gap-2">
              <TextField label={index === 0 ? "Attribute" : undefined} aria-label="Attribute" placeholder="Size" value={entry.name} onChange={(name) => setAttributes(attributes.map((row, at) => (at === index ? { ...row, name } : row)))} />
              <TextField label={index === 0 ? "Value" : undefined} aria-label="Value" placeholder="Large" value={entry.value} onChange={(value) => setAttributes(attributes.map((row, at) => (at === index ? { ...row, value } : row)))} />
            </div>
          ))}
          {attributes.length < 10 && <Button size="compact" variant="ghost" onPress={() => setAttributes([...attributes, { name: "", value: "" }])}>Add attribute</Button>}
          <TextField label="SKU" description="Leave empty to number it automatically." value={code} onChange={(value) => setCode(value.toUpperCase())} />
          {item.capabilities?.manageIdentifiers && <TextField label="Barcode" value={barcode} onChange={(value) => setBarcode(value.replace(/\s/g, ""))} />}
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button><Button variant="primary" isLoading={create.isPending} onPress={() => create.mutate()}>Create variant</Button></div>
        </div>
      </Dialog>
    </div>
  );
}

function TransactionsPanel({ itemId, tabs }: { itemId: string; tabs: Array<{ id: string; label: string }> }) {
  const workspace = useWorkspaceContext();
  const [list, setList] = useState(tabs[0]?.id ?? "orders");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId, "transactions", list), queryFn: () => listItemTransactions(itemId, list), enabled: tabs.length > 0 });
  const rows = query.data ?? [];
  return (
    <Card title="Recent documents">
      <div className="flex flex-wrap gap-2">{tabs.map((entry) => <Button key={entry.id} size="compact" variant={entry.id === list ? "primary" : "secondary"} onPress={() => setList(entry.id)}>{entry.label}</Button>)}</div>
      {query.isLoading ? <LoadingState label="Loading" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : rows.length === 0 ? <p className="text-sm text-text-muted">Nothing yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Document", "Party", "Status", "Quantity", "Amount", "Date"].map((heading) => <th key={heading} className="py-1 pr-3 font-medium">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={`${row.id}-${row.code}`}>
                  <td className="py-1.5 pr-3 font-medium">{row.href ? <Link className="text-brand underline-offset-2 hover:underline" href={row.href}>{row.code}</Link> : row.code}</td>
                  <td className="pr-3">{row.party ?? ""}</td>
                  <td className="pr-3">{row.status ? <Badge tone="neutral">{row.status.replace(/_/g, " ")}</Badge> : ""}</td>
                  <td className="pr-3 tabular-nums">{row.quantity ?? ""} {row.uom ?? ""}</td>
                  <td className="pr-3 tabular-nums">{row.amount !== null ? formatMoney(row.currencyCode, row.amount) : ""}</td>
                  <td className="pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function FilesPanel({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", item.id, "files"), queryFn: () => listItemFiles(item.id) });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products", "product", item.id) }); };
  const upload = useMutation({ mutationFn: (file: File) => uploadItemFile(item.id, file), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const primary = useMutation({ mutationFn: (fileId: string) => setPrimaryImage(item.id, fileId), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeItemFile(item.id, fileId), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const files = query.data ?? [];
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">Images, technical datasheets, specifications, manuals and certificates. The first image becomes the item image.</p>
        {canEdit && (
          <>
            <input ref={input} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}>Upload file</Button>
          </>
        )}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading files" rows={2} /> : files.length === 0 ? <EmptyState title="No attachments" description="Upload an image or a datasheet." /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="flex items-center gap-2">
                <a className="font-medium text-brand underline-offset-2 hover:underline" href={itemFileUrl(item.id, file.id)} target="_blank" rel="noreferrer">{file.fileName}</a>
                {file.isPrimaryImage && <Badge tone="info">Item image</Badge>}
                <span className="text-xs text-text-muted">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {formatDate(file.uploadedAt)}</span>
              </span>
              {canEdit && (
                <span className="flex gap-1">
                  {file.isImage && !file.isPrimaryImage && <Button variant="ghost" size="compact" onPress={() => primary.mutate(file.id)}>Use as image</Button>}
                  <Button variant="ghost" size="compact" onPress={() => remove.mutate(file.id)}>Remove</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Change = { label?: string; from?: unknown; to?: unknown; sensitive?: boolean };
const show = (value: unknown) => (value === null || value === undefined || value === "" ? "empty" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value));

function HistoryPanel({ itemId }: { itemId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId, "history"), queryFn: () => getItemHistory(itemId) });
  if (query.isLoading) return <div className="pt-3"><LoadingState label="Loading history" rows={3} /></div>;
  const entries = query.data ?? [];
  if (entries.length === 0) return <div className="pt-3"><EmptyState title="No history" description="Changes to this item are recorded here." /></div>;
  return (
    <ol className="mt-3 flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
      {entries.map((entry) => {
        const changes = Object.entries(entry.changes ?? {}).filter(([, value]) => value && typeof value === "object" && ("from" in (value as object) || "sensitive" in (value as object))) as Array<[string, Change]>;
        return (
          <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">{entry.summary}</span>
            {changes.length > 0 && <ul className="text-text-secondary">{changes.map(([field, change]) => <li key={field}>{change.label ?? field}: {change.sensitive ? "changed" : `${show(change.from)} → ${show(change.to)}`}</li>)}</ul>}
            <span className="text-xs text-text-muted">{[entry.actorName ?? "System", formatDateTime(entry.createdAt)].join(" · ")}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Where to go from the item's stock: its views elsewhere in Inventory and the operations that start from it (each page checks its own
// permission; a link the person may not open is not offered).
function ItemStockActions({ itemId }: { itemId: string }) {
  const { permissions, roleSlugs } = useWorkspaceContext();
  const has = (permission: string) => roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator") || permissions.includes(permission);
  const views: Array<[string, string, string]> = [
    ["View stock", `/inventory/stock/items/${itemId}`, "stock.view"], ["View reservations", `/inventory/reservations?itemId=${itemId}`, "stock.reservations.view"],
    ["View movements", `/inventory/transactions?tab=movements&itemId=${itemId}`, "stock.ledger.view"], ["View ledger", `/inventory/transactions?tab=ledger&itemId=${itemId}`, "stock.ledger.view"],
    ["View valuation", `/inventory/valuation?itemId=${itemId}`, "stock.valuation.view"], ["View replenishment", `/inventory/replenishment?tab=rules&itemId=${itemId}`, "stock.reorder.view"],
  ];
  const actions: Array<[string, string, string]> = [
    ["Start stock count", `/inventory/stock-counts/new?itemId=${itemId}`, "stock.counts.create"], ["Create transfer", `/inventory/transfers/new?itemId=${itemId}`, "stock.transfers.create"],
    ["Create adjustment", `/inventory/adjustments/new?itemId=${itemId}`, "stock.adjustments.create"],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {views.filter(([, , permission]) => has(permission)).map(([label, href]) => <LinkButton key={href} size="compact" variant="outline" href={href}>{label}</LinkButton>)}
      {actions.filter(([, , permission]) => has(permission)).map(([label, href]) => <LinkButton key={href} size="compact" variant="secondary" href={href}>{label}</LinkButton>)}
    </div>
  );
}
