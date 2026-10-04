"use client";

// The product page: Overview, Sales, Purchasing, Inventory, Tax, Related
// Transactions, Files and History. Module tabs appear only when they apply:
// no Inventory tab for a service, no Purchasing tab for something never
// bought.
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog, Badge, Button, Dialog, EmptyState, ErrorState, LinkButton, Menu, MenuItem, MenuTrigger, PermissionState, RecordDetailsPage, Tab, TabList, TabPanel, Tabs, TextArea,
} from "@vercentlabs/design-system";

import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  deleteProduct, errorCode, errorMessage, getProduct, getProductDetails, getProductHistory, listProductFiles, listProductTransactions, productFileUrl, removeProductFile,
  setPrimaryImage, setProductStatus, uploadProductFile, type Product,
} from "../api/products-api";
import { ErrorBanner, ProductStatusBadge, ProductTypeBadge, price, taxLine, unitLine, yesNo } from "../product-format";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
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
const uom = (unit: Product["baseUom"]) => (unit ? `${unit.name} (${unit.code})` : null);
const TRACKING: Record<string, string> = { none: "None", batch: "Lot / batch", serial: "Serial number" };
const VALUATION: Record<string, string> = { moving_average: "Moving average", fifo: "FIFO", standard: "Standard cost" };

export function ProductDetailScreen({ productId }: { productId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(useSearchParams().get("tab") ?? "overview");
  const [dialog, setDialog] = useState<"deactivate" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const productQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", productId), queryFn: () => getProduct(productId) });
  const detailsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", productId, "details"), queryFn: () => getProductDetails(productId) });
  const refresh = () => { setDialog(null); setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); };
  const status = useMutation({
    mutationFn: (action: "activate" | "deactivate") => setProductStatus(productId, action, reason.trim() || undefined),
    onSuccess: refresh,
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });
  const remove = useMutation({
    mutationFn: () => deleteProduct(productId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); router.push("/sales/products"); },
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });

  if (productQuery.isLoading) return <LoadingState label="Loading product" rows={6} />;
  if (productQuery.isError || !productQuery.data)
    return errorCode(productQuery.error) === "PERMISSION_DENIED"
      ? <PermissionState title="You don't have access to products" description="Ask an administrator for access." />
      : <ErrorState title="Product not found" action={{ label: "Back to products", onPress: () => router.push("/sales/products") }} />;
  const product = productQuery.data;
  const can = product.capabilities!;
  const details = detailsQuery.data;
  const menu = [
    ...(can.edit ? [{ id: "edit", label: "Edit", run: () => router.push(`/sales/products/${product.id}/edit`) }] : []),
    ...(can.activate ? [product.isActive ? { id: "deactivate", label: "Deactivate", run: () => setDialog("deactivate") } : { id: "activate", label: "Activate", run: () => status.mutate("activate") }] : []),
    ...(can.delete ? [{ id: "delete", label: "Delete", run: () => setDialog("delete") }] : []),
  ];
  const transactionTabs = [
    { id: "quotations", label: "Quotations", show: details?.access.sales },
    { id: "orders", label: "Sales Orders", show: details?.access.sales },
    { id: "invoices", label: "Invoices", show: workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.view") },
    { id: "purchases", label: "Purchase Orders", show: details?.access.procurement && product.isPurchasable },
    { id: "stock", label: "Stock Movements", show: details?.access.inventory && product.inventoryTracked },
  ].filter((entry) => entry.show);

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: <LinkButton href="/sales/products" variant="ghost" size="compact">Products &amp; Services</LinkButton>,
          title: (
            <span className="flex items-center gap-3">
              {product.imageAttachmentId && (
                // eslint-disable-next-line @next/next/no-img-element -- a private, authorised file, not a static asset
                <img src={productFileUrl(product.id, product.imageAttachmentId)} alt="" className="size-12 rounded-[var(--radius-control)] border border-border object-cover" />
              )}
              <span className="flex flex-col"><span>{product.name}</span><span className="text-sm font-normal text-text-secondary">{product.code}{product.sku ? ` · SKU ${product.sku}` : ""}</span></span>
            </span>
          ),
          status: <span className="flex gap-1"><ProductTypeBadge type={product.type} /><ProductStatusBadge active={product.isActive} /></span>,
          fields: [
            { label: "Category", value: product.categoryName ?? "None" },
            { label: "Unit", value: unitLine(product) || "Not set" },
            { label: "Default price", value: price(product.defaultSalesPrice) },
            { label: "Tax", value: taxLine(product) || "Not set" },
          ],
          primaryAction: can.edit ? <LinkButton href={`/sales/products/${product.id}/edit`} variant="primary">Edit</LinkButton> : undefined,
          secondaryActions: menu.length > 1 ? (
            <MenuTrigger>
              <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
              <Menu onAction={(key) => menu.find((entry) => entry.id === key)?.run()}>{menu.filter((entry) => entry.id !== "edit").map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}</Menu>
            </MenuTrigger>
          ) : undefined,
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {!product.isActive && <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">Inactive. It stays on existing documents and reports but cannot be chosen on new ones.</p>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Product sections">
            <Tab id="overview">Overview</Tab>
            {product.isSellable && <Tab id="sales">Sales</Tab>}
            {product.isPurchasable && <Tab id="purchasing">Purchasing</Tab>}
            {product.inventoryTracked && details?.access.inventory && <Tab id="inventory">Inventory</Tab>}
            <Tab id="tax">Tax</Tab>
            {transactionTabs.length > 0 && <Tab id="transactions">Related Transactions</Tab>}
            <Tab id="files">Files</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="grid gap-4 pt-3 lg:grid-cols-2">
              <Card title="Identity">
                <Facts items={[["Code", product.code], ["Name", product.name], ["Type", product.typeLabel], ["Category", product.categoryName], ["SKU", product.sku], ["Barcode", product.barcode],
                  ["Base unit", uom(product.baseUom)], ["Status", product.isActive ? "Active" : "Inactive"]]} />
                {product.description && <p className="border-t border-border pt-3 text-sm whitespace-pre-wrap text-text-secondary">{product.description}</p>}
              </Card>
              <Card title="Used by">
                <Facts items={[["Can be sold", yesNo(product.isSellable)], ["Can be purchased", yesNo(product.isPurchasable)], ["Inventory tracked", yesNo(product.inventoryTracked)],
                  ["Created", [product.createdByName, formatDateTime(product.createdAt)].filter(Boolean).join(" · ")], ["Last updated", [product.updatedByName, formatDateTime(product.updatedAt)].filter(Boolean).join(" · ")]]} />
              </Card>
            </div>
          </TabPanel>
          <TabPanel id="sales">
            <div className="grid gap-4 pt-3 lg:grid-cols-2">
              <Card title="Selling">
                <Facts items={[["Sales unit", product.salesUomFactor && product.salesUomFactor !== 1 ? `${product.salesUom?.code} of ${product.salesUomFactor} ${product.baseUom?.code}` : uom(product.salesUom)],
                  ["Default sales price", price(product.defaultSalesPrice)], ["Tax", taxLine(product)]]} />
                {product.salesDescription && <p className="border-t border-border pt-3 text-sm whitespace-pre-wrap">{product.salesDescription}</p>}
              </Card>
              <Card title="Price lists">
                {!details ? <LoadingState label="Loading" rows={2} /> : details.sales.priceLists.length === 0 ? <p className="text-sm text-text-muted">Not on any price list. Quotations use the default price.</p> : (
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
          </TabPanel>
          <TabPanel id="purchasing">
            <div className="pt-3">
              <Card title="Buying">
                <Facts items={[["Purchase unit", product.purchaseUomFactor && product.purchaseUomFactor !== 1 ? `${product.purchaseUom?.code} of ${product.purchaseUomFactor} ${product.baseUom?.code}` : uom(product.purchaseUom)],
                  ...(product.defaultPurchaseCost !== undefined ? [["Default purchase cost", price(product.defaultPurchaseCost)] as [string, ReactNode]] : []), ["Purchase description", product.purchaseDescription]]} />
              </Card>
            </div>
          </TabPanel>
          <TabPanel id="inventory">
            <div className="flex flex-col gap-4 pt-3">
              {details?.inventory && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[["On hand", details.inventory.onHand], ["Reserved", details.inventory.reserved], ["Available", details.inventory.available]].map(([label, value]) => (
                      <div key={label as string} className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold tabular-nums">{value} {details.inventory?.uom}</p></div>
                    ))}
                    {details.inventory.value !== undefined && <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><p className="text-xs text-text-muted">Value</p><p className="text-lg font-semibold tabular-nums">{price(details.inventory.value)}</p></div>}
                  </div>
                  <Card title="Warehouses">
                    {details.inventory.warehouses.length === 0 ? <p className="text-sm text-text-muted">No stock yet. Opening stock is entered in Inventory.</p> : (
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs text-text-secondary"><tr>{["Warehouse", "On hand", "Reserved", "Available", ...(details.access.cost ? ["Average cost"] : [])].map((heading) => <th key={heading} className="py-1 font-medium">{heading}</th>)}</tr></thead>
                        <tbody className="divide-y divide-border">
                          {details.inventory.warehouses.map((entry) => (
                            <tr key={entry.id}><td className="py-1.5">{entry.name}</td><td className="tabular-nums">{entry.onHand}</td><td className="tabular-nums">{entry.reserved}</td><td className="tabular-nums">{entry.available}</td>
                              {details.access.cost && <td className="tabular-nums">{entry.averageCost === null || entry.averageCost === undefined ? "" : price(entry.averageCost)}</td>}</tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Card>
                </>
              )}
              <Card title="Inventory settings">
                <Facts items={[["Lot / serial tracking", TRACKING[product.trackingType]], ["Valuation method", VALUATION[product.valuationMethod]], ["Allow negative stock", yesNo(product.allowNegativeStock)],
                  ...(product.standardCost !== undefined ? [["Standard cost", price(product.standardCost)] as [string, ReactNode]] : [])]} />
              </Card>
            </div>
          </TabPanel>
          <TabPanel id="tax">
            <div className="pt-3">
              <Card title="Tax classification">
                <Facts items={[[product.hsnSacLabel, product.hsnSacCode], ["Tax category", product.taxCategoryName], ["GST rate", product.gstRate !== null ? `${product.gstRate}%` : null],
                  ["Cess", product.cessRate ? `${product.cessRate}%` : null]]} />
                <p className="text-xs text-text-muted">CGST and SGST, or IGST, are worked out on each document from this, the customer&apos;s GST status and the place of supply. A rate change applies to new documents only.</p>
              </Card>
            </div>
          </TabPanel>
          <TabPanel id="transactions"><TransactionsPanel productId={product.id} tabs={transactionTabs} /></TabPanel>
          <TabPanel id="files"><FilesPanel product={product} canEdit={can.edit} /></TabPanel>
          <TabPanel id="history"><HistoryPanel productId={product.id} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>
      <Dialog isOpen={dialog === "deactivate"} onOpenChange={(open) => !open && setDialog(null)} title={`Deactivate ${product.name}?`}
        description="It stays on every existing document and report but can no longer be chosen on new quotations, orders, purchase orders or POS sales.">
        <div className="flex flex-col gap-4">
          <TextArea label="Reason (optional)" rows={2} value={reason} onChange={setReason} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setDialog(null)}>Cancel</Button><Button variant="danger" isLoading={status.isPending} onPress={() => status.mutate("deactivate")}>Deactivate</Button></div>
        </div>
      </Dialog>
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${product.name}?`}
        description="This removes it permanently. Only a product that has never been used on any document, price list, stock movement or BOM can be deleted; otherwise deactivate it."
        confirmLabel="Delete" isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function TransactionsPanel({ productId, tabs }: { productId: string; tabs: Array<{ id: string; label: string }> }) {
  const workspace = useWorkspaceContext();
  const [list, setList] = useState(tabs[0]?.id ?? "quotations");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", productId, "transactions", list), queryFn: () => listProductTransactions(productId, list), enabled: tabs.length > 0 });
  const rows = query.data ?? [];
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap gap-2">{tabs.map((entry) => <Button key={entry.id} size="compact" variant={entry.id === list ? "primary" : "secondary"} onPress={() => setList(entry.id)}>{entry.label}</Button>)}</div>
      {query.isLoading ? <LoadingState label="Loading" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : rows.length === 0 ? <EmptyState title="Nothing yet" description="Documents with this product appear here." /> : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-text-secondary"><tr>{["Document", "Party", "Status", "Quantity", "Amount", "Date"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 font-medium">{row.href ? <Link className="text-brand underline-offset-2 hover:underline" href={row.href}>{row.code}</Link> : row.code}</td>
                  <td className="px-3 py-2">{row.party ?? ""}</td>
                  <td className="px-3 py-2">{row.status ? <Badge tone="neutral">{row.status.replace(/_/g, " ")}</Badge> : ""}</td>
                  <td className="px-3 py-2 tabular-nums">{row.quantity ?? ""} {row.uom ?? ""}</td>
                  <td className="px-3 py-2 tabular-nums">{row.amount !== null ? formatMoney(row.currencyCode, row.amount) : ""}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilesPanel({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = scopedQueryKey(workspace, "products", "product", product.id, "files");
  const query = useQuery({ queryKey: key, queryFn: () => listProductFiles(product.id) });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products", "product", product.id) }); };
  const upload = useMutation({ mutationFn: (file: File) => uploadProductFile(product.id, file), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const primary = useMutation({ mutationFn: (fileId: string) => setPrimaryImage(product.id, fileId), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeProductFile(product.id, fileId), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const files = query.data ?? [];
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">Specification sheets, documentation, service scope, and one primary image used in product selection and POS.</p>
        {canEdit && (
          <>
            <input ref={input} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}>Upload file</Button>
          </>
        )}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading files" rows={2} /> : files.length === 0 ? <EmptyState title="No files" description="Upload a specification sheet or an image." /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="flex items-center gap-2">
                <a className="font-medium text-brand underline-offset-2 hover:underline" href={productFileUrl(product.id, file.id)} target="_blank" rel="noreferrer">{file.fileName}</a>
                {file.isPrimaryImage && <Badge tone="info">Primary image</Badge>}
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

function HistoryPanel({ productId }: { productId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", productId, "history"), queryFn: () => getProductHistory(productId) });
  if (query.isLoading) return <div className="pt-3"><LoadingState label="Loading history" rows={3} /></div>;
  const entries = query.data ?? [];
  if (entries.length === 0) return <div className="pt-3"><EmptyState title="No history" description="Changes to this product are recorded here." /></div>;
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
