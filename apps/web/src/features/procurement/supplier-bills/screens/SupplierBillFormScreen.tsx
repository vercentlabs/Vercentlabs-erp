"use client";

// New (or draft) supplier bill. One bill, two ways in:
//   From a purchase order   the order's eligible lines at the agreed price — or the unbilled quantities of chosen goods receipts
//   Direct bill (no PO)     rent, utilities, internet, subscriptions, fees, repairs: expense or asset lines, never stock
// Every amount shown is the server's preview (tax engine, TDS, matching, duplicates, due date); nothing is calculated here.
import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button, Checkbox, ErrorState, PageHeader, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { listPurchaseOrders } from "@/features/procurement/purchase-orders/api/purchase-orders-api";
import { useFormChangesWarning } from "@/features/procurement/shared/navigation";

import {
  billAction, createBill, errorMessage, getBill, getBillOptions, getEligibility, getSupplierBillDefaults, issuesOf, previewBill, updateBill, type BillDetail, type BillOptions,
} from "../api/supplier-bills-api";
import { MatchBadge } from "./TwoWayMatching";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { Notice } from "@/shared/ui/Panel";

type Source = "purchase_order" | "goods_receipt" | "direct";
type OrderRow = { include: boolean; quantity: string; unitPrice: string; byAmount?: boolean; amount?: string; discountType?: string; discountValue?: string };
type DirectRow = {
  key: string; expenseCategoryId: string; expenseAccountId: string; description: string; quantity: string; uomId: string; unitPrice: string; discountType: string; discountValue: string;
  taxCategoryId: string; hsnSacCode: string; costCenterId: string; blockedCredit: boolean;
};
const blankDirect = (): DirectRow => ({ key: crypto.randomUUID(), expenseCategoryId: "", expenseAccountId: "", description: "", quantity: "1", uomId: "", unitPrice: "", discountType: "none",
  discountValue: "", taxCategoryId: "none", hsnSacCode: "", costCenterId: "", blockedCredit: false });
const trim = (value: string | null | undefined) => (value == null || value === "" ? "" : String(Number(value)));

export function SupplierBillFormScreen({ orderId, receiptIds, billId, source, supplierId }: { orderId?: string; receiptIds?: string[]; billId?: string; source?: string; supplierId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-options"), queryFn: getBillOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill", billId), queryFn: () => getBill(billId!), enabled: Boolean(billId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading supplier bill" />;
  if (!options.data || (billId && !existing.data)) return <ErrorState title="Could not load the bill form" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.bill.status !== "draft") return <ErrorState title="This bill cannot be edited" description="Only a draft is edited. Correct a posted bill with a vendor credit, or reverse it." />;
  const preset: Source | null = existing.data ? (existing.data.bill.sourceType as Source) : receiptIds?.length ? "goods_receipt" : orderId ? "purchase_order"
    : source === "direct" || supplierId ? "direct" : source === "purchase_order" ? "purchase_order" : null;
  return <BillForm options={options.data} existing={existing.data ?? null} presetSource={preset} presetOrderId={orderId} presetReceiptIds={receiptIds} presetSupplierId={supplierId} />;
}

// The two ways to record a bill.
function SourceChooser({ onChoose }: { onChoose: (source: Source) => void }) {
  const card = "flex flex-1 flex-col items-start gap-2 rounded-[var(--radius-card)] border border-border p-5 text-left transition hover:border-brand hover:bg-surface-raised";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Create Supplier Bill" description="Record what a supplier has charged. Posting records the payable through Finance; it never pays the supplier." />
      <div className="flex flex-col gap-4 sm:flex-row">
        <button type="button" className={card} onClick={() => onChoose("purchase_order")}>
          <ShoppingCart className="size-6 text-brand" aria-hidden="true" /><span className="text-base font-semibold">From Purchase Order</span>
          <span className="text-sm text-text-secondary">Bill an existing purchasing commitment and its goods receipts: quantities and prices are matched against the order.</span>
        </button>
        <button type="button" className={card} onClick={() => onChoose("direct")}>
          <FileText className="size-6 text-brand" aria-hidden="true" /><span className="text-base font-semibold">Direct Bill — Without PO</span>
          <span className="text-sm text-text-secondary">Rent, utilities, internet, subscriptions, professional fees, repairs and other expenses that have no purchase order.</span>
        </button>
      </div>
    </div>
  );
}

function BillForm({ options, existing, presetSource, presetOrderId, presetReceiptIds, presetSupplierId }: {
  options: BillOptions; existing: BillDetail | null; presetSource: Source | null; presetOrderId?: string; presetReceiptIds?: string[]; presetSupplierId?: string;
}) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const saved = existing?.bill;
  const [source, setSource] = useState<Source | null>(presetSource);
  const [orderId, setOrderId] = useState<string>(saved?.purchaseOrderId ?? presetOrderId ?? "");
  const [receipts, setReceipts] = useState<string[]>(presetReceiptIds ?? existing?.related.receipts.map((entry) => entry.id) ?? []);
  const [header, setHeader] = useState({
    supplierId: saved?.supplierId ?? presetSupplierId ?? "", supplierInvoiceNumber: saved?.supplierInvoiceNumber ?? "", supplierInvoiceDate: saved?.supplierInvoiceDate ?? "",
    postingDate: saved?.postingDate ?? "", dueDate: saved?.dueDateOverrideReason ? saved.dueDate ?? "" : "", dueDateOverrideReason: saved?.dueDateOverrideReason ?? "",
    paymentTermId: saved?.paymentTermId ?? "", currencyCode: saved?.currencyCode ?? "", exchangeRate: saved && saved.currencyCode !== saved.baseCurrencyCode ? saved.exchangeRate : "",
    supplierTaxRegistrationId: saved?.supplierTaxRegistrationId ?? "", buyingRegistrationId: saved?.buyingRegistrationId ?? "", placeOfSupply: saved?.placeOfSupply ?? "",
    withholdingSectionId: saved ? saved.withholdingSection?.id ?? "none" : "default", supplierInvoiceTotal: saved?.supplierStatedTotal ? trim(saved.supplierStatedTotal) : "",
    notes: saved?.notes ?? "", priceMode: saved?.priceMode ?? "exclusive",
    documentDiscountType: "none", documentDiscountValue: "", invoiceReceivedDate: saved?.invoiceReceivedDate ?? "", acceptanceDate: saved?.acceptanceDate ?? "",
    supplierStatedTermId: saved?.supplierStatedTermId ?? "", supplierStatedTerms: saved?.supplierStatedTerms ?? "", paymentTermChangeReason: saved?.paymentTermChangeReason ?? "",
  });
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const [orderRows, setOrderRows] = useState<Record<string, OrderRow>>(() => Object.fromEntries((existing?.lines ?? []).filter((line) => line.purchaseOrderLineId)
    .map((line) => [line.purchaseOrderLineId!, { include: true, quantity: trim(line.quantity), unitPrice: trim(line.unitPrice), byAmount: line.billingBasis === "amount", amount: trim(line.billedAmount) }])));
  const [directRows, setDirectRows] = useState<DirectRow[]>(() => saved?.sourceType === "direct" ? existing!.lines.map((line) => ({
    key: line.id, expenseCategoryId: line.expenseCategoryId ?? "", expenseAccountId: options.accounts.find((account) => line.account.startsWith(`${account.code} `))?.id ?? "",
    description: line.description, quantity: trim(line.quantity), uomId: line.uomId ?? "", unitPrice: trim(line.unitPrice), discountType: line.lineDiscountType ?? "none",
    discountValue: trim(line.lineDiscountValue), taxCategoryId: line.taxCategoryId ?? "none", hsnSacCode: line.hsnSacCode ?? "", costCenterId: line.costCenterId ?? "",
    blockedCredit: line.inputTaxEligibility === "blocked",
  })) : [blankDirect()]);

  const [orderSupplier, setOrderSupplier] = useState<string>(presetSupplierId ?? "");
  const orders = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "billable-orders", orderSupplier), queryFn: () => listPurchaseOrders({ view: "confirmed", limit: 200, supplierId: orderSupplier || undefined }),
    enabled: source !== null && source !== "direct" && !saved });
  const eligibility = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-eligibility", orderId, saved?.id), queryFn: () => getEligibility(orderId, saved?.id),
    enabled: source !== null && source !== "direct" && Boolean(orderId) });
  // A direct bill starts from the supplier's defaults: currency, terms, TDS section, and its GSTIN when it has only one (the server applies them; a choice is asked
  // only between several GSTINs).
  const defaults = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-defaults", header.supplierId), queryFn: () => getSupplierBillDefaults(header.supplierId),
    enabled: source === "direct" && Boolean(header.supplierId) });
  const receiptChoices = useMemo(() => [...new Map((eligibility.data?.lines ?? []).flatMap((line) => line.receipts).filter((entry) => Number(entry.remaining) > 0 || receipts.includes(entry.goodsReceiptId))
    .map((entry) => [entry.goodsReceiptId, entry.receiptNumber])).entries()], [eligibility.data, receipts]);

  const payload = useMemo(() => {
    const base: Record<string, unknown> = {
      sourceType: source, supplierInvoiceNumber: header.supplierInvoiceNumber || null, supplierInvoiceDate: header.supplierInvoiceDate || undefined, postingDate: header.postingDate || undefined,
      dueDate: header.dueDate || undefined, dueDateOverrideReason: header.dueDateOverrideReason || undefined, paymentTermId: header.paymentTermId || undefined,
      placeOfSupply: header.placeOfSupply || undefined, supplierTaxRegistrationId: header.supplierTaxRegistrationId || undefined, buyingRegistrationId: header.buyingRegistrationId || undefined,
      supplierInvoiceTotal: header.supplierInvoiceTotal || null, notes: header.notes || null, invoiceReceivedDate: header.invoiceReceivedDate || null, acceptanceDate: header.acceptanceDate || null,
      supplierStatedTermId: header.supplierStatedTermId || null, supplierStatedTerms: header.supplierStatedTerms || null, paymentTermChangeReason: header.paymentTermChangeReason || null,
      ...(header.withholdingSectionId === "default" ? {} : { withholdingSectionId: header.withholdingSectionId === "none" ? null : header.withholdingSectionId }),
      ...(header.exchangeRate ? { exchangeRate: header.exchangeRate } : {}),
    };
    if (source === "direct") return {
      ...base, supplierId: header.supplierId, currencyCode: header.currencyCode || undefined, priceMode: header.priceMode,
      documentDiscountType: header.documentDiscountType === "none" ? undefined : header.documentDiscountType, documentDiscountValue: header.documentDiscountValue || undefined,
      lines: directRows.filter((row) => row.description || row.unitPrice).map((row) => ({
        expenseCategoryId: row.expenseCategoryId || undefined, expenseAccountId: row.expenseAccountId || undefined, description: row.description, quantity: row.quantity || "1",
        uomId: row.uomId || undefined, unitPrice: row.unitPrice, discountType: row.discountType === "none" ? undefined : row.discountType, discountValue: row.discountValue || undefined,
        taxCategoryId: row.taxCategoryId === "none" ? undefined : row.taxCategoryId, noTax: row.taxCategoryId === "none", hsnSacCode: row.hsnSacCode || undefined,
        costCenterId: row.costCenterId || undefined, inputTaxEligibility: row.blockedCredit ? "blocked" : "eligible",
      })),
    };
    // Only the lines (and quantities or amounts) on the supplier's invoice: a line billed nothing is left out, never a zero line.
    const lines = Object.entries(orderRows).filter(([, row]) => row.include && (row.byAmount ? Number(row.amount) > 0 : Number(row.quantity) > 0)).map(([purchaseOrderLineId, row]) => (row.byAmount
      ? { purchaseOrderLineId, billingBasis: "amount", amount: row.amount }
      : { purchaseOrderLineId, quantity: row.quantity, unitPrice: row.unitPrice || undefined,
        ...(row.discountType && row.discountType !== "agreed" ? { discountType: row.discountType, discountValue: row.discountValue || "0" } : {}) }));
    return { ...base, purchaseOrderId: orderId || undefined, goodsReceiptIds: source === "goods_receipt" ? receipts : undefined, lines: lines.length ? lines : undefined };
  }, [source, header, directRows, orderRows, orderId, receipts]);
  const deferred = useDeferredValue(payload);
  const ready = source === "direct" ? Boolean(header.supplierId) && directRows.some((row) => Number(row.unitPrice) > 0 && (row.expenseAccountId || row.expenseCategoryId))
    : Boolean(orderId) && (source !== "goods_receipt" || receipts.length > 0);
  const preview = useQuery({ queryKey: ["procurement", "bill-preview", JSON.stringify(deferred), saved?.id], queryFn: () => previewBill({ ...deferred, billId: saved?.id }), enabled: ready, retry: false });
  const c = (value: string | null | undefined) => money(preview.data?.header.currencyCode ?? header.currencyCode, value ?? "0");

  const submit = useSubmitKey();
  useFormChangesWarning({ source, orderId, receipts, header, orderRows, directRows });
  const save = useMutation({
    mutationFn: (post: boolean) => submit.run(async () => {
      const id = saved ? (await updateBill(saved.id, { ...payload, expectedUpdatedAt: saved.updatedAt })).id : (await createBill(payload)).id;
      if (post) {
        try { await billAction(id, "post", {}); } catch (error) { router.push(`/procurement/supplier-bills/${id}`); throw error; }
      }
      return id;
    }),
    onSuccess: (id) => router.push(`/procurement/supplier-bills/${id}`),
  });
  const issues = issuesOf(save.error);
  const setRow = (lineId: string, change: Partial<OrderRow>, rowDefaults: OrderRow) => setOrderRows((current) => ({ ...current, [lineId]: { ...rowDefaults, ...current[lineId], ...change } }));
  const changeDirect = (key: string, change: Partial<DirectRow>) => setDirectRows((current) => current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));
  const computedDue = preview.data?.header.computedDueDate ?? null;
  const overriding = Boolean(header.dueDate && computedDue && header.dueDate !== computedDue);

  if (!source) return <SourceChooser onChoose={setSource} />;
  return (
    <>
    <DocumentFormPage
      header={{
        title: saved ? `Edit ${saved.billNumber}` : source === "direct" ? "New Supplier Bill — Direct (without PO)" : "New Supplier Bill — From Purchase Order",
        description: "Enter the supplier's invoice as issued. Totals are calculated by the server; posting checks everything again and records the payable through Finance.",
      }}
      banner={<div className="flex flex-col gap-3">
        {!options.capabilities.manage && <Notice tone="info">You can record drafts; Accounts Payable validates and posts them.</Notice>}
      {Boolean(save.error) && <Notice>{errorMessage(save.error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
      </div>}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `/procurement/supplier-bills/${saved.id}` : "/procurement/supplier-bills")}>Cancel</Button>
          <Button variant="secondary" isLoading={save.isPending && save.variables === false} isDisabled={!ready} onPress={() => save.mutate(false)}>Save Draft</Button>
          {options.capabilities.manage ? <Button variant="primary" isLoading={save.isPending && save.variables === true} isDisabled={!ready} onPress={() => save.mutate(true)}>Validate &amp; Post</Button> : undefined}
        </>
      }
    >
      <FormSection columns={1} title="Bill source" actions={!saved ? <Button size="compact" variant="ghost" onPress={() => setSource(null)}>Change</Button> : undefined}>
        {source !== "direct" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!saved && (
              <Select label="Supplier" selectedKey={orderSupplier || "any"} onSelectionChange={(value) => { setOrderSupplier(value === "any" ? "" : String(value)); setOrderId(""); setOrderRows({}); setReceipts([]); }}
                options={[{ value: "any", label: "Any supplier" }, ...options.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
            )}
            <Select label="Purchase order" isDisabled={Boolean(saved)} selectedKey={orderId || null} onSelectionChange={(value) => { setOrderId(String(value)); setOrderRows({}); setReceipts([]); }}
              options={(orders.data?.rows ?? (saved ? [{ id: saved.purchaseOrderId!, purchaseOrderNumber: saved.purchaseOrderNumber!, supplierName: saved.supplierName }] : []))
                .map((order) => ({ value: order.id, label: `${order.purchaseOrderNumber} · ${order.supplierName}` }))} />
            {!saved && <Checkbox isSelected={source === "goods_receipt"} onChange={(value) => setSource(value ? "goods_receipt" : "purchase_order")}>Bill the received quantities of chosen goods receipts</Checkbox>}
            {source === "goods_receipt" && orderId && (
              <div className="flex flex-col gap-1 sm:col-span-2"><span className="text-sm font-medium">Goods receipts</span>
                {!receiptChoices.length && <span className="text-sm text-text-muted">No posted receipt of this order is left to bill.</span>}
                {receiptChoices.map(([id, number]) => (
                  <Checkbox key={id} isSelected={receipts.includes(id)} onChange={(value) => setReceipts((current) => (value ? [...current, id] : current.filter((entry) => entry !== id)))}>{number}</Checkbox>
                ))}
              </div>
            )}
          </div>
        )}
        {source === "direct" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Supplier" isRequired isDisabled={Boolean(saved)} selectedKey={header.supplierId || null} onSelectionChange={(value) => set("supplierId")(String(value))}
              options={options.suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.name}${supplier.status !== "active" ? ` (${supplier.status})` : ""}` }))} />
            <Select label="Currency" selectedKey={header.currencyCode || "default"} onSelectionChange={(value) => set("currencyCode")(value === "default" ? "" : String(value))}
              options={[{ value: "default", label: defaults.data?.currencyCode ? `Supplier's default (${defaults.data.currencyCode})` : "Supplier's default" }, ...options.currencies.map((entry) => ({ value: entry.code, label: `${entry.code} · ${entry.name}` }))]} />
            <Select label="Prices on the invoice" selectedKey={header.priceMode} onSelectionChange={(value) => set("priceMode")(String(value))}
              options={[{ value: "exclusive", label: "Exclusive of tax" }, { value: "inclusive", label: "Inclusive of tax" }]} />
            {defaults.data?.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
          </div>
        )}
      </FormSection>

      <FormSection columns={1} title="Supplier invoice">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Supplier invoice number" isRequired value={header.supplierInvoiceNumber} onChange={set("supplierInvoiceNumber")} description="Exactly as on the supplier's invoice." />
          <TextField label="Supplier invoice date" type="date" isRequired value={header.supplierInvoiceDate} onChange={set("supplierInvoiceDate")} />
          <TextField label="Posting date" type="date" value={header.postingDate} onChange={set("postingDate")} description="Today if empty; must be in an open period." />
          <Select label="Payment terms" selectedKey={header.paymentTermId || "default"} onSelectionChange={(value) => set("paymentTermId")(value === "default" ? "" : String(value))}
            options={[{ value: "default", label: source === "direct" ? `Supplier's terms${defaults.data?.paymentTermName ? ` (${defaults.data.paymentTermName})` : ""}` : "The order's terms" },
              ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
          {source !== "direct" && header.paymentTermId && <TextField label="Why other terms than the order's" isRequired value={header.paymentTermChangeReason} onChange={set("paymentTermChangeReason")}
            description="Changing the agreed terms needs the permission and a reason." />}
          <TextField label="Invoice received on" type="date" value={header.invoiceReceivedDate} onChange={set("invoiceReceivedDate")}
            description={options.paymentTerms.find((term) => term.id === header.paymentTermId)?.needs_invoice_received_date ? "Required: the terms count from it." : "When the supplier's invoice reached you."} />
          <Select label="Terms on the supplier's invoice" selectedKey={header.supplierStatedTermId || "none"} onSelectionChange={(value) => set("supplierStatedTermId")(value === "none" ? "" : String(value))}
            options={[{ value: "none", label: "Not stated / same as agreed" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
          <TextField label="Acceptance date (goods or service)" type="date" value={header.acceptanceDate} onChange={set("acceptanceDate")} description="For bills without goods receipts: the statutory deadline (MSME) counts from it." />
          <TextField label="Due date" type="date" value={header.dueDate} onChange={set("dueDate")} isDisabled={!options.capabilities.overrideDueDate}
            description={computedDue ? `From the terms: ${calendarDate(computedDue)}${options.capabilities.overrideDueDate ? ". A different date needs a reason." : "."}` : "Worked out from the terms."} />
          {overriding && <TextField label="Reason for the due date" isRequired value={header.dueDateOverrideReason} onChange={set("dueDateOverrideReason")} />}
          <TextField label="Total on the supplier's invoice" inputMode="decimal" value={header.supplierInvoiceTotal} onChange={set("supplierInvoiceTotal")} description="Checked against the calculation." />
          {(source === "direct" ? defaults.data?.registrations.length ?? 0 : preview.data?.header.registrationChoices ?? 0) > 1 && (
            <Select label="Supplier GSTIN (on the invoice)" isRequired selectedKey={header.supplierTaxRegistrationId || null} onSelectionChange={(value) => set("supplierTaxRegistrationId")(String(value))}
              options={(defaults.data?.registrations ?? []).map((entry) => ({ value: entry.id, label: `${entry.gstin} · state ${entry.stateCode}` }))} />
          )}
          <Select label="Buying company" selectedKey={header.buyingRegistrationId || "default"} onSelectionChange={(value) => set("buyingRegistrationId")(value === "default" ? "" : String(value))}
            options={[{ value: "default", label: source === "direct" ? "Default registration" : "The order's" }, ...options.registrations.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.gstin ? ` · ${entry.gstin}` : ""}` }))]} />
          <TextField label="Place of supply (state code)" value={header.placeOfSupply} onChange={set("placeOfSupply")} description={preview.data ? `Supplier state ${preview.data.header.supplierStateCode ?? "— (unregistered)"}` : undefined} />
          <Select label="TDS section" selectedKey={header.withholdingSectionId} onSelectionChange={(value) => set("withholdingSectionId")(String(value))}
            options={[{ value: "default", label: defaults.data?.withholdingSection ? `Supplier's usual (${defaults.data.withholdingSection.code})` : "Supplier's usual" }, { value: "none", label: "No TDS" },
              ...options.withholdingSections.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name} (${Number(entry.rate)}%)` }))]} />
          {(header.currencyCode || saved?.currencyCode) && preview.data && preview.data.header.currencyCode !== "INR" && (
            <TextField label="Exchange rate" inputMode="decimal" value={header.exchangeRate} onChange={set("exchangeRate")} description="Finance's rate for the posting date if empty; posting needs one." />
          )}
        </div>
      </FormSection>

      {source !== "direct" && eligibility.data && (
        <>
        {eligibility.data.order.matchingPolicy && (
          <Notice tone="info">Matching policy: {({ three_way_accepted: "3-Way — acceptance required", three_way_received: "3-Way — physical receipt", two_way: "2-Way — PO-based billing" } as Record<string, string>)[eligibility.data.order.matchingPolicy]}.
            {eligibility.data.order.matchingPolicy !== "two_way" ? " Goods are billed only against posted goods receipts." : " Goods may be billed before they arrive."}</Notice>
        )}
        <FormSection columns={1} title="Lines billed" description="Enter exactly what the supplier's invoice bills — prefilled with what may be billed now, never more than the order still commits. A quantity not yet received is kept as a pending draft until its goods receipt. The agreed price is the matching basis; a different price is a variance.">
          <div className="flex flex-col gap-3">
            {eligibility.data.lines.filter((line) => !line.zeroPrice).map((line) => {
              const rowDefaults = { include: false, quantity: trim(line.remainingToBill), unitPrice: trim(line.orderedUnitPrice) };
              const scoped = source === "goods_receipt" ? line.receipts.filter((entry) => receipts.includes(entry.goodsReceiptId)).reduce((total, entry) => total + Number(entry.remaining), 0) : null;
              const row = orderRows[line.purchaseOrderLineId] ?? { ...rowDefaults, include: source === "goods_receipt" ? Boolean(scoped) : !saved && Number(line.remainingToBill) > 0,
                quantity: scoped !== null ? String(scoped) : rowDefaults.quantity };
              return (
                <div key={line.purchaseOrderLineId} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Checkbox isSelected={row.include} onChange={(value) => setRow(line.purchaseOrderLineId, { include: value }, row)}>
                      <span className="font-medium">{line.lineNumber}. {line.description}</span>
                    </Checkbox>
                    <span className="text-sm tabular-nums text-text-secondary">Ordered {quantity(line.ordered)}{Number(line.cancelled) > 0 ? ` · Cancelled ${quantity(line.cancelled)}` : ""}
                      {line.productType !== "service" ? ` · Received ${quantity(line.received)}` : ""} · Billed {quantity(line.billed)} · Remaining {quantity(line.remainingCommitment)} ·
                      {" "}<span className="font-medium text-text">Eligible now {quantity(scoped !== null ? scoped : line.remainingToBill)} {line.uom ?? ""}</span>
                      {" "}({line.productType === "service" ? "service" : line.basis === "receipt" ? "receipt-based" : "PO-based"})</span>
                  </div>
                  {line.rejectionWarning && <p className="text-xs text-warning">{line.rejectionWarning}</p>}
                  {line.basis === "receipt" && line.receipts.length > 0 && (
                    <p className="text-xs tabular-nums text-text-muted">{line.receipts.map((entry) => `${entry.receiptNumber}: ${quantity(entry.billable)} eligible, ${quantity(entry.allocated)} billed, ${quantity(entry.remaining)} left`).join(" · ")}</p>
                  )}
                  {line.draftBills.length > 0 && <p className="text-xs text-text-muted">{quantity(line.draftBilled)} is also on unposted bill{line.draftBills.length === 1 ? "" : "s"} {line.draftBills.join(", ")} — not billed until posted; whichever posts first counts.</p>}
                  {row.include && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {line.amountBillable && (
                        <Checkbox isSelected={Boolean(row.byAmount)} onChange={(value) => setRow(line.purchaseOrderLineId, { include: true, byAmount: value }, row)}>
                          Bill by amount (fixed-value service)
                        </Checkbox>
                      )}
                      {row.byAmount ? (
                        <TextField label="Amount billed" inputMode="decimal" value={row.amount ?? ""} onChange={(value) => setRow(line.purchaseOrderLineId, { include: true, amount: value }, row)}
                          description={`${money(eligibility.data.order.currencyCode, line.remainingAmount)} of ${money(eligibility.data.order.currencyCode, line.agreedAmount)} agreed is left`} />
                      ) : (
                        <>
                          <TextField label="Bill now (quantity on the invoice)" inputMode="decimal" value={row.quantity} onChange={(value) => setRow(line.purchaseOrderLineId, { include: true, quantity: value }, row)} />
                          <TextField label="Invoiced unit price" inputMode="decimal" value={row.unitPrice} onChange={(value) => setRow(line.purchaseOrderLineId, { include: true, unitPrice: value }, row)}
                            description={`Agreed ${money(eligibility.data.order.currencyCode, line.orderedUnitPrice)}`} />
                          <Select label="Invoice discount" selectedKey={row.discountType ?? "agreed"} onSelectionChange={(value) => setRow(line.purchaseOrderLineId, { include: true, discountType: String(value) }, row)}
                            options={[{ value: "agreed", label: "As agreed on the order" }, { value: "none", label: "None on the invoice" }, { value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }]} />
                          {row.discountType && !["agreed", "none"].includes(row.discountType) && (
                            <TextField label="Invoice discount value" inputMode="decimal" value={row.discountValue ?? ""} onChange={(value) => setRow(line.purchaseOrderLineId, { include: true, discountValue: value }, row)} />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </FormSection>
        </>
      )}

      {source === "direct" && (
        <FormSection columns={1} title="Expenses and services" description="Each line posts to its expense category's (or the chosen) account. Stock is bought on a purchase order and received — never on a direct bill."
          actions={<Button size="compact" variant="secondary" onPress={() => setDirectRows((current) => [...current, blankDirect()])}><Plus className="size-4" aria-hidden="true" />Add line</Button>}>
          <div className="flex flex-col gap-3">
            {directRows.map((row, index) => (
              <div key={row.key} className="grid grid-cols-1 gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-4">
                <Select label="Expense category" selectedKey={row.expenseCategoryId || "none"} onSelectionChange={(value) => {
                  const category = options.expenseCategories.find((entry) => entry.id === value);
                  changeDirect(row.key, category ? { expenseCategoryId: category.id, expenseAccountId: category.account_id, taxCategoryId: category.default_tax_category_id ?? row.taxCategoryId,
                    hsnSacCode: category.default_hsn_sac ?? row.hsnSacCode, description: row.description || category.name } : { expenseCategoryId: "" });
                }} options={[{ value: "none", label: "No category" }, ...options.expenseCategories.map((entry) => ({ value: entry.id, label: entry.name }))]} />
                <Select label="Account" isRequired selectedKey={row.expenseAccountId || null} onSelectionChange={(value) => changeDirect(row.key, { expenseAccountId: String(value) })}
                  options={options.accounts.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))} />
                <TextField label="Description" isRequired value={row.description} onChange={(value) => changeDirect(row.key, { description: value })} />
                <TextField label="HSN / SAC" value={row.hsnSacCode} onChange={(value) => changeDirect(row.key, { hsnSacCode: value })} />
                <TextField label="Quantity" inputMode="decimal" value={row.quantity} onChange={(value) => changeDirect(row.key, { quantity: value })} />
                <Select label="Unit" selectedKey={row.uomId || "none"} onSelectionChange={(value) => changeDirect(row.key, { uomId: value === "none" ? "" : String(value) })}
                  options={[{ value: "none", label: "—" }, ...options.uoms.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
                <TextField label="Rate" inputMode="decimal" isRequired value={row.unitPrice} onChange={(value) => changeDirect(row.key, { unitPrice: value })} />
                <Select label="Tax" selectedKey={row.taxCategoryId} onSelectionChange={(value) => changeDirect(row.key, { taxCategoryId: String(value) })}
                  options={[{ value: "none", label: "No tax / outside GST" }, ...options.taxCategories.map((category) => ({ value: category.id, label: `${category.name}${category.reverse_charge ? " (reverse charge)" : ""}` }))]} />
                <Select label="Discount" selectedKey={row.discountType} onSelectionChange={(value) => changeDirect(row.key, { discountType: String(value) })}
                  options={[{ value: "none", label: "None" }, { value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }]} />
                {row.discountType !== "none" && <TextField label="Discount value" inputMode="decimal" value={row.discountValue} onChange={(value) => changeDirect(row.key, { discountValue: value })} />}
                {options.costCenters.length > 0 && (
                  <Select label="Cost centre" selectedKey={row.costCenterId || "none"} onSelectionChange={(value) => changeDirect(row.key, { costCenterId: value === "none" ? "" : String(value) })}
                    options={[{ value: "none", label: "None" }, ...options.costCenters.map((entry) => ({ value: entry.id, label: entry.name }))]} />
                )}
                <div className="flex items-end justify-between gap-2 sm:col-span-2">
                  <Checkbox isSelected={row.blockedCredit} onChange={(value) => changeDirect(row.key, { blockedCredit: value })}>Input tax is a blocked credit (part of the cost)</Checkbox>
                  {directRows.length > 1 && <Button variant="ghost" aria-label={`Remove line ${index + 1}`} onPress={() => setDirectRows((current) => current.filter((entry) => entry.key !== row.key))}><Trash2 className="size-4" aria-hidden="true" /></Button>}
                </div>
                {preview.data?.lines[index] && (
                  <p className="text-xs tabular-nums text-text-muted sm:col-span-4">Taxable {c(preview.data.lines[index].taxableAmount)} · tax {c(preview.data.lines[index].taxAmount)}
                    {preview.data.lines[index].reverseCharge ? ` · reverse charge ${c(preview.data.lines[index].reverseChargeTax)}` : ""} · line total {c(preview.data.lines[index].lineTotal)}</p>
                )}
              </div>
            ))}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <Select label="Bill discount" selectedKey={header.documentDiscountType} onSelectionChange={(value) => set("documentDiscountType")(String(value))}
                options={[{ value: "none", label: "None" }, { value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }]} />
              {header.documentDiscountType !== "none" && <TextField label="Bill discount value" inputMode="decimal" value={header.documentDiscountValue} onChange={set("documentDiscountValue")} />}
            </div>
          </div>
        </FormSection>
      )}

      <FormSection columns={1} title="Totals" description="Calculated by the server from the lines, the shared tax engine and the TDS section.">
        {!ready && <p className="text-sm text-text-muted">{source === "direct" ? "Choose the supplier and enter at least one line with its account." : "Choose the order and lines to see the totals."}</p>}
        {preview.error && <Notice>{errorMessage(preview.error)}</Notice>}
        {preview.data && (
          <>
            {preview.data.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
            {preview.data.duplicates.length > 0 && <Notice tone="warning">Possible duplicate supplier invoice: {preview.data.duplicates.map((entry) => `${entry.billNumber} (${entry.status})`).join(", ")}.</Notice>}
            {preview.data.twoWay && preview.data.twoWay.result !== "not_applicable" && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">2-Way Matching <MatchBadge result={preview.data.twoWay.result} /></span>
                  <Button size="compact" variant="ghost" isLoading={preview.isFetching} onPress={() => void preview.refetch()}>Check Matching</Button>
                </div>
                {preview.data.twoWay.lines && preview.data.twoWay.lines.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-text-muted">{["Line", "PO price", "Invoice price", "Expected", "Invoice amount", "Difference"].map((name, index) => <th key={name} className={index ? "py-1 pr-2 text-right font-normal" : "py-1 pr-2 font-normal"}>{name}</th>)}</tr></thead>
                      <tbody>{preview.data.twoWay.lines.map((line) => (
                        <tr key={line.sequence}><td className="py-1 pr-2">{line.orderLineNumber ? `PO line ${line.orderLineNumber}` : "Not on the order"}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{line.expectedUnitPrice ? c(line.expectedUnitPrice) : "—"}</td><td className="py-1 pr-2 text-right tabular-nums">{c(line.actualUnitPrice)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{c(line.expectedNet)}</td><td className="py-1 pr-2 text-right tabular-nums">{c(line.actualNet)}</td>
                          <td className={Number(line.variance) !== 0 ? "py-1 pr-2 text-right tabular-nums text-danger" : "py-1 pr-2 text-right tabular-nums"}>{c(line.variance)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {(preview.data.twoWay.discrepancies ?? []).map((entry, index) => (
                  <p key={index} className="text-sm"><span className={entry.approved ? "text-warning" : "text-danger"}>{entry.label}:</span> {entry.message} <span className="text-text-muted">{entry.approved ? "Accepted." : entry.guidance}</span></p>
                ))}
                {preview.data.twoWay.result === "mismatch" && <p className="text-xs text-text-muted">The draft can be saved; posting is blocked until the discrepancies are resolved. A price, discount or charge variance can be accepted on the saved bill by an authorised approver (not its creator).</p>}
              </div>
            )}
            <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
              {[["Subtotal", preview.data.totals.gross], ["Discounts", String(Number(preview.data.totals.lineDiscount) + Number(preview.data.totals.documentDiscount))], ["Taxable value", preview.data.totals.taxable],
                ["Tax", preview.data.totals.tax], ...(Number(preview.data.totals.reverseChargeTax) > 0 ? [["Reverse-charge tax (self-assessed)", preview.data.totals.reverseChargeTax]] : []),
                ["Invoice total", preview.data.totals.invoiceTotal], ...(Number(preview.data.totals.withholding) > 0 ? [[`TDS${preview.data.header.withholdingSection ? ` (${preview.data.header.withholdingSection.code})` : ""}`, `-${preview.data.totals.withholding}`]] : []),
                ["Net payable", preview.data.totals.netPayable]].map(([name, value]) => (
                <div key={name} className="contents"><dt className="text-text-secondary">{name}</dt><dd className="text-right tabular-nums">{c(value)}</dd></div>
              ))}
              {preview.data.header.dueDate && <div className="contents"><dt className="text-text-secondary">Due</dt><dd className="text-right">{calendarDate(preview.data.header.dueDate)}</dd></div>}
            </dl>
          </>
        )}
      </FormSection>

      <FormSection columns={1} title="Notes" description="Attach the supplier's original invoice from the bill once it is saved.">
        <TextArea label="Internal notes" value={header.notes} onChange={set("notes")} />
      </FormSection>
    </DocumentFormPage>
    
    </>
  );
}
