"use client";

// New / Edit Purchase Order. The form collects; the server proposes the
// supplier's defaults (currency, terms, buyer, contact, locations, GST
// registration), prices every line with the shared tax engine and keeps the
// totals. A product's purchase cost is offered as a starting price only: the
// agreed price is what is entered, and a missing price is never zero.
import { useEffect, useMemo, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, ErrorState, IconButton, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcurementSearchPicker, useKnownRows } from "@/features/procurement/shared/ProcurementSearchPicker";
import { useApp } from "@/shell/workspace-context/useApp";
import { money } from "@/features/procurement/shared/format";
import { getSupplier } from "@/features/procurement/suppliers/api/suppliers-api";
import { useFormChangesWarning } from "@/features/procurement/shared/navigation";

import {
  createPurchaseOrder, errorMessage, getPurchaseOrder, getPurchaseOrderOptions, issuesOf, previewPurchaseOrder, updatePurchaseOrder, type PurchaseOrderDetail, type PurchaseOrderOptions,
} from "../api/purchase-orders-api";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { Notice } from "@/shared/ui/Panel";

const NONE = "none";
const DEFAULT = "default";
type Line = {
  key: number; lineId?: string; productId: string; descriptive: boolean; description: string; productType: string; quantity: string; uomId: string; unitPrice: string;
  zeroPriceReason: string; discountType: string; discountValue: string; warehouseId: string; expectedDeliveryDate: string; taxCategoryId: string; noTax: boolean; expenseAccountId: string;
  sourceQuotationLineId?: string | null;
};
let lineKey = 0;
const blankLine = (warehouseId = ""): Line => ({
  key: ++lineKey, productId: "", descriptive: false, description: "", productType: "service", quantity: "1", uomId: "", unitPrice: "", zeroPriceReason: "", discountType: NONE, discountValue: "",
  warehouseId, expectedDeliveryDate: "", taxCategoryId: "", noTax: false, expenseAccountId: "",
});
const trimNumber = (value: string | null | undefined) => (value == null ? "" : String(Number(value)));

type Header = {
  supplierId: string; currencyCode: string; paymentTermId: string; buyerUserId: string; buyingRegistrationId: string; defaultWarehouseId: string; orderDate: string;
  expectedDeliveryDate: string; supplierReference: string; supplierQuotationReference: string; priceMode: string; documentDiscountType: string; documentDiscountValue: string;
  supplierContactId: string; supplierAddressId: string; supplierBillingAddressId: string; supplierShipFromId: string; supplierNotes: string; internalNotes: string;
  shipToLine1: string; shipToCity: string; shipToStateCode: string; shipToPostalCode: string; advancePercentage: string; paymentTermsNote: string; paymentTermChangeReason: string;
};

function headerFrom(detail: PurchaseOrderDetail | null, supplierId: string | undefined, options: PurchaseOrderOptions): Header {
  const order = detail?.order;
  return {
    supplierId: order?.supplierId ?? supplierId ?? "", currencyCode: order?.currencyCode ?? DEFAULT, paymentTermId: order?.paymentTermId ?? DEFAULT, buyerUserId: order?.buyerUserId ?? DEFAULT,
    buyingRegistrationId: order?.buyingRegistrationId ?? DEFAULT, defaultWarehouseId: order?.defaultWarehouseId ?? options.settings.defaultWarehouseId ?? NONE,
    orderDate: order?.orderDate ?? "", expectedDeliveryDate: order?.expectedDeliveryDate ?? "", supplierReference: order?.supplierReference ?? "",
    supplierQuotationReference: order?.supplierQuotationReference ?? "", priceMode: order?.priceMode ?? "exclusive", documentDiscountType: order?.documentDiscountType ?? NONE,
    documentDiscountValue: order?.documentDiscountType ? trimNumber(order.documentDiscountValue) : "", supplierContactId: order?.supplierContactId ?? DEFAULT,
    supplierAddressId: order?.supplierAddressId ?? DEFAULT, supplierBillingAddressId: order?.supplierBillingAddressId ?? DEFAULT, supplierShipFromId: order?.supplierShipFromId ?? DEFAULT,
    supplierNotes: order?.supplierNotes ?? "", internalNotes: order?.internalNotes ?? "", shipToLine1: order?.shipTo?.line1 ?? "", shipToCity: order?.shipTo?.city ?? "",
    shipToStateCode: order?.shipTo?.stateCode ?? "", shipToPostalCode: order?.shipTo?.postalCode ?? "", advancePercentage: detail?.paymentTerms?.advance?.percentage ?? "",
    paymentTermsNote: detail?.paymentTerms?.notes ?? "", paymentTermChangeReason: detail?.paymentTerms?.changeReason ?? "",
  };
}

function linesFrom(detail: PurchaseOrderDetail | null, defaultWarehouse: string): Line[] {
  if (!detail?.lines.length) return [blankLine(defaultWarehouse)];
  return detail.lines.map((line) => ({
    key: ++lineKey, lineId: line.id, productId: line.productId ?? "", descriptive: !line.productId, description: line.product.descriptive ? line.description : "", productType: line.productType,
    quantity: trimNumber(line.orderedQuantity), uomId: line.uomId, unitPrice: trimNumber(line.unitPrice), zeroPriceReason: line.zeroPriceReason ?? "", discountType: line.discountType ?? NONE,
    discountValue: line.discountType ? trimNumber(line.discountValue) : "", warehouseId: line.warehouseId ?? "", expectedDeliveryDate: line.expectedDeliveryDate ?? "",
    taxCategoryId: line.productId ? "" : line.taxCategoryId ?? "", noTax: !line.productId && !line.taxCategoryId, expenseAccountId: line.expenseAccountId ?? "",
    sourceQuotationLineId: line.sourceQuotationLineId,
  }));
}

// A copy of an earlier order (Procurement plan Phase 1, "+ New › Copy previous"): its supplier, terms and lines, with new dates and references.
function copyOf(detail: PurchaseOrderDetail): PurchaseOrderDetail {
  return {
    ...detail,
    order: { ...detail.order, orderDate: "", expectedDeliveryDate: "", supplierReference: "", supplierQuotationReference: "" },
    lines: detail.lines.map((line) => ({ ...line, id: "", expectedDeliveryDate: "", sourceQuotationLineId: null })),
  } as PurchaseOrderDetail;
}

export function PurchaseOrderFormScreen({ orderId, supplierId, copyFromId }: { orderId?: string; supplierId?: string; copyFromId?: string }) {
  const workspace = useWorkspaceContext();
  const sourceId = orderId ?? copyFromId;
  const detailQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-order", sourceId), queryFn: () => getPurchaseOrder(sourceId!), enabled: Boolean(sourceId) });
  // The order's own supplier and products come with the options' first page, so an edit knows them whatever page they are on.
  const include = {
    supplierIds: [detailQuery.data?.order.supplierId ?? supplierId ?? ""],
    productIds: (detailQuery.data?.lines ?? []).map((line) => line.productId ?? ""),
    supplierId: detailQuery.data?.order.supplierId ?? supplierId,
  };
  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "po-options", include.supplierIds.join(","), include.productIds.join(",")),
    queryFn: () => getPurchaseOrderOptions(include), staleTime: 60_000, enabled: !sourceId || Boolean(detailQuery.data),
  });
  if ((sourceId && detailQuery.isLoading) || optionsQuery.isLoading) return <LoadingState label="Loading purchase order" />;
  if (!optionsQuery.data) return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => optionsQuery.refetch() }} />;
  if (copyFromId && !orderId) {
    if (!detailQuery.data) return <ErrorState title="Could not load the order to copy" description={errorMessage(detailQuery.error)} action={{ label: "Retry", onPress: () => detailQuery.refetch() }} />;
    return <OrderForm key={`copy-${copyFromId}`} options={optionsQuery.data} detail={null} copy={copyOf(detailQuery.data)} supplierId={supplierId} />;
  }
  if (orderId && !detailQuery.data) return <ErrorState title="Could not load this purchase order" description={errorMessage(detailQuery.error)} action={{ label: "Retry", onPress: () => detailQuery.refetch() }} />;
  if (detailQuery.data && !detailQuery.data.actions.edit)
    return <ErrorState title="This order cannot be edited" description={`It is ${detailQuery.data.order.statusLabel.toLowerCase()}. A confirmed order is changed by amending it.`} />;
  return <OrderForm key={orderId ?? "new"} options={optionsQuery.data} detail={detailQuery.data ?? null} supplierId={supplierId} />;
}

function OrderForm({ options, detail, supplierId, copy = null }: { options: PurchaseOrderOptions; detail: PurchaseOrderDetail | null; supplierId?: string; copy?: PurchaseOrderDetail | null }) {
  const workspace = useWorkspaceContext();
  // Without Stock nothing is received into a warehouse: goods are marked received on the order.
  const stockOn = useApp("stock");
  const router = useRouter();
  const [header, setHeader] = useState<Header>(() => headerFrom(detail ?? copy, supplierId, options));
  const [lines, setLines] = useState<Line[]>(() => linesFrom(detail ?? copy, options.settings.defaultWarehouseId ?? "").map((line) => (copy && !detail ? { ...line, lineId: undefined } : line)));
  const [failure, setFailure] = useState<unknown>(null);
  const set = (key: keyof Header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const setLine = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const supplierQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier", header.supplierId), queryFn: () => getSupplier(header.supplierId), enabled: Boolean(header.supplierId) });
  const supplier = supplierQuery.data;
  const canDescribe = Boolean(options.capabilities.descriptiveLines);

  const payload = useMemo(() => {
    const pick = (value: string) => (value && value !== DEFAULT && value !== NONE ? value : undefined);
    const choose = (value: string) => (value === DEFAULT ? undefined : value === NONE ? null : value);
    const shipTo = header.shipToLine1 || header.shipToCity ? { line1: header.shipToLine1, city: header.shipToCity, stateCode: header.shipToStateCode || null, postalCode: header.shipToPostalCode || null } : null;
    return {
      supplierId: header.supplierId, currencyCode: pick(header.currencyCode), paymentTermId: pick(header.paymentTermId), buyerUserId: pick(header.buyerUserId),
      ...(header.buyingRegistrationId !== DEFAULT ? { buyingRegistrationId: pick(header.buyingRegistrationId) ?? null } : {}),
      defaultWarehouseId: pick(header.defaultWarehouseId) ?? null, orderDate: header.orderDate || undefined, expectedDeliveryDate: header.expectedDeliveryDate || null,
      supplierReference: header.supplierReference, supplierQuotationReference: header.supplierQuotationReference, priceMode: header.priceMode,
      documentDiscountType: pick(header.documentDiscountType) ?? null, documentDiscountValue: header.documentDiscountType !== NONE ? header.documentDiscountValue || "0" : "0",
      ...Object.fromEntries((["supplierContactId", "supplierAddressId", "supplierBillingAddressId", "supplierShipFromId"] as const)
        .filter((key) => header[key] !== DEFAULT).map((key) => [key, choose(header[key])])),
      shipTo, supplierNotes: header.supplierNotes, internalNotes: header.internalNotes, paymentTermsNote: header.paymentTermsNote, paymentTermChangeReason: header.paymentTermChangeReason || undefined,
      advancePercentage: header.advancePercentage || undefined,
      lines: lines.filter((line) => line.productId || line.descriptive).map((line) => ({
        lineId: line.lineId, productId: line.descriptive ? undefined : line.productId, description: line.description || undefined, productType: line.descriptive ? line.productType : undefined,
        quantity: line.quantity, uomId: line.uomId || undefined, unitPrice: line.unitPrice, zeroPriceReason: line.zeroPriceReason || undefined,
        discountType: line.discountType === NONE ? null : line.discountType, discountValue: line.discountType === NONE ? "0" : line.discountValue || "0",
        warehouseId: line.warehouseId || undefined, expectedDeliveryDate: line.expectedDeliveryDate || undefined,
        taxCategoryId: line.descriptive && !line.noTax ? line.taxCategoryId || undefined : undefined, noTax: line.descriptive ? line.noTax : undefined,
        expenseAccountId: line.descriptive ? line.expenseAccountId || undefined : undefined, sourceQuotationLineId: line.sourceQuotationLineId ?? undefined,
      })),
    };
  }, [header, lines]);

  // Totals from the server, a moment after the last change.
  const [debounced, setDebounced] = useState(payload);
  useEffect(() => { const timer = setTimeout(() => setDebounced(payload), 450); return () => clearTimeout(timer); }, [payload]);
  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "po-preview", detail?.order.id ?? "new", debounced),
    queryFn: () => previewPurchaseOrder({ ...debounced, orderId: detail?.order.id }),
    enabled: Boolean(debounced.supplierId),
    retry: false,
  });
  const preview = previewQuery.data;

  const submit = useSubmitKey();
  useFormChangesWarning({ header, lines });
  const save = useMutation({
    mutationFn: () => submit.run(async () => (detail
      ? updatePurchaseOrder(detail.order.id, { ...payload, expectedRevision: detail.order.revision }).then(() => detail.order.id)
      : createPurchaseOrder(payload).then((result) => result.id))),
    onSuccess: (id) => router.replace(`/procurement/purchase-orders/${id}`),
    onError: setFailure,
  });

  // The suppliers and products this form knows: the options' first page and every one picked since (ProcurementSearchPicker).
  const [knownSuppliers, keepSupplier] = useKnownRows(options.suppliers);
  const [knownProducts, keepProduct] = useKnownRows(options.products);
  const uomOptions = options.uoms.map((uom) => ({ value: uom.id, label: uom.code }));
  const warehouseOptions = options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }));
  const choosePerson = supplier ? supplier.contacts.filter((contact) => contact.status === "active").map((contact) => ({ value: contact.id, label: contact.name })) : [];
  const chooseLocation = supplier ? supplier.addresses.filter((address) => address.status === "active").map((address) => ({ value: address.id, label: `${address.label} · ${address.city}` })) : [];
  const issues = issuesOf(failure);

  return (
    <>
    <DocumentFormPage
      header={{
        title: detail ? `${detail.order.amending ? "Amend" : "Edit"} ${detail.order.purchaseOrderNumber}` : "New Purchase Order",
        description: detail?.order.amending ? `Amendment: ${detail.order.amendmentReason}. Confirming it makes version ${detail.order.versionNumber + 1}.` : "The server sets the number and the totals when you save.",
      }}
      banner={<div className="flex flex-col gap-3">
        {Boolean(failure) && <Notice>{errorMessage(failure)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
      </div>}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.replace(detail ? `/procurement/purchase-orders/${detail.order.id}` : "/procurement/purchase-orders")}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending || save.isSuccess} isDisabled={save.isPending || save.isSuccess || !header.supplierId} onPress={() => save.mutate()}>Save draft</Button>
        </>
      }
    >
      <FormSection columns={1} title="Supplier and terms" description="Choosing the supplier proposes its currency, payment terms, buyer, contact and locations. Change what differs.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProcurementSearchPicker kind="suppliers" label="Supplier" isRequired activeOnly value={header.supplierId || null} isDisabled={Boolean(detail?.order.sourceQuotationId)}
            known={knownSuppliers} onPick={(id, row) => {
              keepSupplier(row as (typeof knownSuppliers)[number] | null);
              setHeader((current) => ({ ...current, supplierId: id, supplierContactId: DEFAULT, supplierAddressId: DEFAULT, supplierBillingAddressId: DEFAULT,
                supplierShipFromId: DEFAULT, currencyCode: DEFAULT, paymentTermId: DEFAULT }));
            }} />
          <Select label="Currency" selectedKey={header.currencyCode} onSelectionChange={(value) => set("currencyCode")(String(value))}
            options={[{ value: DEFAULT, label: `Supplier's (${preview?.currencyCode ?? "…"})` }, ...options.currencies.map((currency) => ({ value: currency.code, label: currency.code }))]} />
          <Select label="Payment terms" selectedKey={header.paymentTermId} onSelectionChange={(value) => set("paymentTermId")(String(value))}
            options={[{ value: DEFAULT, label: `Supplier's (${preview?.paymentTerm?.name ?? "…"})` }, ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
          {(header.advancePercentage || options.paymentTerms.find((term) => term.id === header.paymentTermId)?.term_type === "advance") && (
            <TextField label="Advance (% of the order)" inputMode="decimal" value={header.advancePercentage} onChange={set("advancePercentage")} description="Paid by Finance as a supplier advance and applied to the bill." />
          )}
          <TextField label="Payment notes" value={header.paymentTermsNote} onChange={set("paymentTermsNote")} description="For example: as agreed in the supplier's quotation." />
          {header.paymentTermId !== DEFAULT && <TextField label="Why these terms" value={header.paymentTermChangeReason} onChange={set("paymentTermChangeReason")} description="When they differ from the supplier's." />}
          <Select label="Buyer" selectedKey={header.buyerUserId} onSelectionChange={(value) => set("buyerUserId")(String(value))}
            options={[{ value: DEFAULT, label: "Supplier's buyer, else me" }, ...options.buyers.map((buyer) => ({ value: buyer.id, label: buyer.name }))]} />
          <TextField label="Order date" type="date" value={header.orderDate} onChange={set("orderDate")} description="Today if left empty." />
          <TextField label="Expected delivery" type="date" value={header.expectedDeliveryDate} onChange={set("expectedDeliveryDate")} isRequired={options.settings.requireExpectedDate} />
          <TextField label="Supplier reference" value={header.supplierReference} onChange={set("supplierReference")} />
          <TextField label="Supplier quotation reference" value={header.supplierQuotationReference} onChange={set("supplierQuotationReference")} />
          <Select label="Prices" selectedKey={header.priceMode} onSelectionChange={(value) => set("priceMode")(String(value))}
            options={[{ value: "exclusive", label: "Exclusive of tax" }, { value: "inclusive", label: "Inclusive of tax" }]} />
        </div>
      </FormSection>

      {supplier && (
        <FormSection columns={1} title="Supplier contact and locations" description="From the supplier's defaults unless chosen here. The order keeps a copy of what it was placed with.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Contact" selectedKey={header.supplierContactId} onSelectionChange={(value) => set("supplierContactId")(String(value))}
              options={[{ value: DEFAULT, label: `Default (${preview?.contact?.name ?? "none"})` }, ...choosePerson, { value: NONE, label: "No contact" }]} />
            <Select label="Ordering address" selectedKey={header.supplierAddressId} onSelectionChange={(value) => set("supplierAddressId")(String(value))}
              options={[{ value: DEFAULT, label: `Default (${preview?.orderingAddress?.label ?? "none"})` }, ...chooseLocation]} />
            <Select label="Billing address" selectedKey={header.supplierBillingAddressId} onSelectionChange={(value) => set("supplierBillingAddressId")(String(value))}
              options={[{ value: DEFAULT, label: `Default (${preview?.billingAddress?.label ?? "none"})` }, ...chooseLocation]} />
            <Select label="Ship-from location" selectedKey={header.supplierShipFromId} onSelectionChange={(value) => set("supplierShipFromId")(String(value))}
              options={[{ value: DEFAULT, label: `Default (${preview?.shipFrom?.label ?? "none"})` }, ...chooseLocation, { value: NONE, label: "Not known" }]} />
          </div>
          {preview?.supplierTaxRegistration?.gstin && <p className="text-sm text-text-secondary">Supplier GSTIN {preview.supplierTaxRegistration.gstin}{preview.supplyType === "non_gst" ? " · no GST charged" : ""}</p>}
        </FormSection>
      )}

      <FormSection columns={1} title="Buying company and delivery" description="The registration the order is placed from, and where the goods are received.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Company registration" selectedKey={header.buyingRegistrationId} onSelectionChange={(value) => set("buyingRegistrationId")(String(value))}
            options={[{ value: DEFAULT, label: "Default registration" }, ...options.registrations.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.gstin ? ` · ${entry.gstin}` : ""}` }))]} />
          {stockOn && <Select label="Receiving warehouse" selectedKey={header.defaultWarehouseId} onSelectionChange={(value) => set("defaultWarehouseId")(String(value))}
            options={[{ value: NONE, label: "None (services only)" }, ...warehouseOptions]} />}
          <TextField label="Ship to (address)" value={header.shipToLine1} onChange={set("shipToLine1")} description="Leave empty to deliver to the receiving warehouse’s address (else the company address)." />
          <TextField label="Ship to (city)" value={header.shipToCity} onChange={set("shipToCity")} />
          <TextField label="Ship to (state code)" value={header.shipToStateCode} onChange={set("shipToStateCode")} description="Decides intra- or inter-state GST." />
          <TextField label="Ship to (PIN)" value={header.shipToPostalCode} onChange={set("shipToPostalCode")} />
        </div>
      </FormSection>

      <FormSection columns={1} title="Items" actions={(
        <span className="flex gap-2">
          <Button size="compact" variant="secondary" onPress={() => setLines((current) => [...current, blankLine(header.defaultWarehouseId === NONE ? "" : header.defaultWarehouseId)])}>
            <Plus className="size-3.5" aria-hidden="true" />Add product
          </Button>
          {canDescribe && <Button size="compact" variant="ghost" onPress={() => setLines((current) => [...current, { ...blankLine(), descriptive: true }])}>Add one-off service or expense</Button>}
        </span>
      )}>
        <div className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const priced = preview?.lines[lines.filter((entry) => entry.productId || entry.descriptive).indexOf(line)];
            const product = knownProducts.find((entry) => entry.id === line.productId);
            const stocked = line.descriptive ? false : product ? product.item_type !== "service" : true;
            return (
              <div key={line.key} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                  {line.descriptive ? (
                    <>
                      <TextField className="sm:col-span-2" label={`Line ${index + 1} description`} value={line.description} onChange={(value) => setLine(line.key, { description: value })} />
                      <Select label="Kind" selectedKey={line.productType} onSelectionChange={(value) => setLine(line.key, { productType: String(value) })}
                        options={[{ value: "service", label: "Service" }, { value: "non_stock", label: "Non-stock item" }]} />
                    </>
                  ) : (
                    <ProcurementSearchPicker kind="products" className="sm:col-span-3" label={`Line ${index + 1} product`} value={line.productId || null}
                      isDisabled={Boolean(line.sourceQuotationLineId)} supplierId={header.supplierId || null} known={knownProducts}
                      onPick={(id, row) => {
                        const chosen = (row ?? knownProducts.find((entry) => entry.id === id)) as (typeof knownProducts)[number] | undefined;
                        keepProduct(chosen ?? null);
                        setLine(line.key, { productId: id, uomId: chosen?.purchase_uom_id ?? chosen?.uom_id ?? "",
                          unitPrice: line.unitPrice || (chosen?.contract_rate ? trimNumber(chosen.contract_rate) : chosen?.last_purchase_price ? trimNumber(chosen.last_purchase_price) : "") });
                      }} />
                  )}
                  <TextField label="Quantity" inputMode="decimal" value={line.quantity} onChange={(value) => setLine(line.key, { quantity: value })} />
                  <Select label="Unit" selectedKey={line.uomId || null} onSelectionChange={(value) => setLine(line.key, { uomId: String(value) })} options={uomOptions} isDisabled={Boolean(line.sourceQuotationLineId)} />
                  <TextField label={`Unit price (${preview?.currencyCode ?? ""})`} inputMode="decimal" value={line.unitPrice} onChange={(value) => setLine(line.key, { unitPrice: value })}
                    description={line.sourceQuotationLineId ? "Quoted price" : product?.contract_rate ? `Rate contract ${product.contract_number}: ${trimNumber(product.contract_rate)}` : product?.last_purchase_price ? `Last price paid ${trimNumber(product.last_purchase_price)}: confirm the agreed price` : undefined} />
                </div>
                <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-6">
                  <Select label="Discount" selectedKey={line.discountType} onSelectionChange={(value) => setLine(line.key, { discountType: String(value) })}
                    options={[{ value: NONE, label: "None" }, { value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }]} />
                  {line.discountType !== NONE && <TextField label="Discount value" inputMode="decimal" value={line.discountValue} onChange={(value) => setLine(line.key, { discountValue: value })} />}
                  {stocked && stockOn && <Select label="Warehouse" selectedKey={line.warehouseId || null} onSelectionChange={(value) => setLine(line.key, { warehouseId: String(value) })} options={warehouseOptions} />}
                  <TextField label="Expected date" type="date" value={line.expectedDeliveryDate} onChange={(value) => setLine(line.key, { expectedDeliveryDate: value })} />
                  {line.unitPrice !== "" && Number(line.unitPrice) === 0 && <TextField label="Why no charge" value={line.zeroPriceReason} onChange={(value) => setLine(line.key, { zeroPriceReason: value })} />}
                  {line.descriptive && (
                    <>
                      {!line.noTax && <Select label="Tax category" selectedKey={line.taxCategoryId || null} onSelectionChange={(value) => setLine(line.key, { taxCategoryId: String(value) })}
                        options={options.taxCategories.map((category) => ({ value: category.id, label: category.name }))} />}
                      <Checkbox isSelected={line.noTax} onChange={(value) => setLine(line.key, { noTax: value })}>Not taxed</Checkbox>
                      <Select label="Expense account" selectedKey={line.expenseAccountId || null} onSelectionChange={(value) => setLine(line.key, { expenseAccountId: String(value) })}
                        options={options.expenseAccounts.map((account) => ({ value: account.id, label: `${account.code} ${account.name}` }))} />
                    </>
                  )}
                  <div className="flex items-end justify-between gap-2 sm:col-start-6">
                    <span className="text-sm tabular-nums text-text-secondary">{priced ? money(preview?.currencyCode, priced.lineTotal) : ""}
                      {priced && Number(priced.taxTotal) > 0 && <span className="block text-xs text-text-muted">incl. {priced.components.map((c) => `${c.label} ${Number(c.rate)}%`).join(" + ")}</span>}</span>
                    <IconButton aria-label={`Remove line ${index + 1}`} variant="ghost" isDisabled={lines.length <= 1} onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </FormSection>

      <FormSection columns={1} title="Discount and totals" description="Calculated by the server with the shared tax engine.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Order discount" selectedKey={header.documentDiscountType} onSelectionChange={(value) => set("documentDiscountType")(String(value))}
            options={[{ value: NONE, label: "None" }, { value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }]} />
          {header.documentDiscountType !== NONE && <TextField label="Discount value" inputMode="decimal" value={header.documentDiscountValue} onChange={set("documentDiscountValue")} />}
        </div>
        {previewQuery.isError && <Notice tone="warning">{errorMessage(previewQuery.error)}</Notice>}
        {preview && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-md">
            <dt className="text-text-muted">Subtotal</dt><dd className="text-right tabular-nums">{money(preview.currencyCode, preview.totals.grossTotal)}</dd>
            <dt className="text-text-muted">Discounts</dt><dd className="text-right tabular-nums">-{money(preview.currencyCode, Number(preview.totals.lineDiscountTotal) + Number(preview.totals.documentDiscountAmount))}</dd>
            <dt className="text-text-muted">Taxable value</dt><dd className="text-right tabular-nums">{money(preview.currencyCode, preview.totals.taxableTotal)}</dd>
            <dt className="text-text-muted">Tax</dt><dd className="text-right tabular-nums">{money(preview.currencyCode, preview.totals.taxTotal)}</dd>
            <dt className="font-medium">Total</dt><dd className="text-right font-medium tabular-nums">{money(preview.currencyCode, preview.totals.grandTotal)}</dd>
          </dl>
        )}
        {preview?.warnings.map((warning) => <p key={`${warning.line}-${warning.code}`} className="text-sm text-warning">{warning.message}</p>)}
      </FormSection>

      <FormSection columns={1} title="Notes">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextArea label="Notes for the supplier" value={header.supplierNotes} onChange={set("supplierNotes")} description="Printed on the purchase order." />
          <TextArea label="Internal notes" value={header.internalNotes} onChange={set("internalNotes")} description="Never shown to the supplier." />
        </div>
      </FormSection>
    </DocumentFormPage>
    
    </>
  );
}
