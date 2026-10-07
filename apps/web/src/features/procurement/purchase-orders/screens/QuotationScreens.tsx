"use client";

// Procurement → Supplier Quotations: what a supplier offered, recorded so the
// purchase order made from it keeps the quoted prices, discounts and terms. A
// quotation becomes one order; making it again names that order.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, LinkButton, NoResultsState, PageHeader, RecordDetailsPage, SearchField, Select, StatusBadge, TextArea,
  TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, money, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";

import {
  cancelQuotation, convertQuotation, createQuotation, errorMessage, getPurchaseOrderOptions, getQuotation, listQuotations, updateQuotation, type QuotationDetail, type QuotationRow,
} from "../api/purchase-orders-api";

export function SupplierQuotationsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions, staleTime: 60_000 });
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "quotations", search), queryFn: () => listQuotations({ search: search.trim() || undefined }) });
  const rows = query.data ?? [];
  const canCreate = Boolean(options.data?.capabilities.quotations);
  const columns = useMemo<ColumnDef<QuotationRow, unknown>[]>(() => [
    { id: "number", header: "Quotation", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.quotationNumber}</span> },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "reference", header: "Supplier reference", cell: ({ row }) => row.original.supplierReference ?? "" },
    { id: "date", header: "Date", cell: ({ row }) => calendarDate(row.original.quotationDate) },
    { id: "valid", header: "Valid until", cell: ({ row }) => (row.original.validUntil ? calendarDate(row.original.validUntil) : "") },
    { id: "value", header: "Value (before tax)", cell: ({ row }) => <span className="tabular-nums">{money(row.original.currencyCode, row.original.grossValue)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "order", header: "Purchase order", cell: ({ row }) => row.original.purchaseOrderNumber ?? "" },
  ], []);
  return (
    <EnterpriseListPage header={{ title: "Supplier Quotations", description: "Offers received from suppliers, ready to become purchase orders at the quoted prices.",
      primaryAction: canCreate ? <LinkButton variant="primary" href="/procurement/purchase-orders/quotations/new"><Plus className="size-4" aria-hidden="true" />Record quotation</LinkButton> : undefined }}
      actionBar={{ start: <SearchField aria-label="Search quotations" placeholder="Quotation, supplier reference or supplier" className="w-full sm:w-96" value={search} onChange={setSearch} /> }}>
      <EnterpriseDataGrid<QuotationRow> aria-label="Supplier quotations" columns={columns} data={rows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (search ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading quotations" rows={6} />}
        errorContent={<ErrorState title="Could not load quotations" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No supplier quotations" description="Record what a supplier offered, then create the purchase order from it." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different search." />}
        onRowClick={(row) => router.push(`/procurement/purchase-orders/quotations/${row.id}`)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.quotationNumber}</span><span className="text-xs text-text-muted">{row.supplierName}</span></div>} />
    </EnterpriseListPage>
  );
}

type QuoteLine = { key: number; productId: string; quantity: string; uomId: string; unitPrice: string; discountType: string; discountValue: string };
let quoteKey = 0;
const blank = (): QuoteLine => ({ key: ++quoteKey, productId: "", quantity: "1", uomId: "", unitPrice: "", discountType: "none", discountValue: "" });

export function SupplierQuotationFormScreen({ quotationId }: { quotationId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "quotation", quotationId), queryFn: () => getQuotation(quotationId!), enabled: Boolean(quotationId) });
  if (options.isLoading || (quotationId && existing.isLoading)) return <LoadingState label="Loading quotation" />;
  if (!options.data || (quotationId && !existing.data)) return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => options.refetch() }} />;
  return <QuotationForm options={options.data} existing={existing.data ?? null} />;
}

function QuotationForm({ options, existing }: { options: NonNullable<Awaited<ReturnType<typeof getPurchaseOrderOptions>>>; existing: QuotationDetail | null }) {
  const router = useRouter();
  const q = existing?.quotation;
  const [values, setValues] = useState({
    supplierId: q?.supplierId ?? "", supplierReference: q?.supplierReference ?? "", rfqReference: q?.rfqReference ?? "", quotationDate: q?.quotationDate ?? "", validUntil: q?.validUntil ?? "",
    currencyCode: q?.currencyCode ?? "", paymentTermId: q?.paymentTermId ?? "", priceMode: q?.priceMode ?? "exclusive", deliveryLeadDays: q?.deliveryLeadDays != null ? String(q.deliveryLeadDays) : "",
    notes: q?.notes ?? "",
  });
  const [lines, setLines] = useState<QuoteLine[]>(() => existing?.lines.length ? existing.lines.map((line) => ({
    key: ++quoteKey, productId: line.productId, quantity: String(Number(line.quantity)), uomId: line.uomId ?? "", unitPrice: String(Number(line.unitPrice)), discountType: line.discountType ?? "none",
    discountValue: line.discountType ? String(Number(line.discountValue)) : "" })) : [blank()]);
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const setLine = (key: number, change: Partial<QuoteLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      const body = { ...values, currencyCode: values.currencyCode || undefined, paymentTermId: values.paymentTermId || null, quotationDate: values.quotationDate || undefined,
        validUntil: values.validUntil || null, deliveryLeadDays: values.deliveryLeadDays || null,
        lines: lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: line.quantity, uomId: line.uomId || undefined, unitPrice: line.unitPrice,
          discountType: line.discountType === "none" ? null : line.discountType, discountValue: line.discountType === "none" ? "0" : line.discountValue || "0" })) };
      return existing ? updateQuotation(existing.quotation.id, body).then(() => existing.quotation.id) : createQuotation(body).then((result) => result.id);
    }),
    onSuccess: (id) => router.push(`/procurement/purchase-orders/quotations/${id}`),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={existing ? `Edit ${existing.quotation.quotationNumber}` : "Record supplier quotation"}
        secondaryActions={<Button variant="secondary" onPress={() => router.push(existing ? `/procurement/purchase-orders/quotations/${existing.quotation.id}` : "/procurement/purchase-orders/quotations")}>Cancel</Button>}
        primaryAction={<Button variant="primary" isLoading={save.isPending || save.isSuccess} isDisabled={!values.supplierId} onPress={() => save.mutate()}>Save</Button>} />
      {save.error && <ProcAlert>{errorMessage(save.error)}</ProcAlert>}
      <ProcPanel title="Quotation">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Supplier" isRequired selectedKey={values.supplierId || null} onSelectionChange={(value) => set("supplierId")(String(value))}
            options={options.suppliers.filter((supplier) => supplier.status === "active").map((supplier) => ({ value: supplier.id, label: `${supplier.name} · ${supplier.supplier_number}` }))} />
          <TextField label="Supplier's reference" value={values.supplierReference} onChange={set("supplierReference")} />
          <TextField label="RFQ reference" value={values.rfqReference} onChange={set("rfqReference")} />
          <TextField label="Quotation date" type="date" value={values.quotationDate} onChange={set("quotationDate")} />
          <TextField label="Valid until" type="date" value={values.validUntil} onChange={set("validUntil")} />
          <Select label="Currency" selectedKey={values.currencyCode || "supplier"} onSelectionChange={(value) => set("currencyCode")(value === "supplier" ? "" : String(value))}
            options={[{ value: "supplier", label: "Supplier's currency" }, ...options.currencies.map((currency) => ({ value: currency.code, label: currency.code }))]} />
          <Select label="Payment terms" selectedKey={values.paymentTermId || "supplier"} onSelectionChange={(value) => set("paymentTermId")(value === "supplier" ? "" : String(value))}
            options={[{ value: "supplier", label: "Supplier's terms" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
          <Select label="Prices" selectedKey={values.priceMode} onSelectionChange={(value) => set("priceMode")(String(value))}
            options={[{ value: "exclusive", label: "Exclusive of tax" }, { value: "inclusive", label: "Inclusive of tax" }]} />
          <TextField label="Delivery lead time (days)" inputMode="numeric" value={values.deliveryLeadDays} onChange={set("deliveryLeadDays")} />
        </div>
      </ProcPanel>
      <ProcPanel title="Quoted lines" actions={<Button size="compact" variant="secondary" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-3.5" aria-hidden="true" />Add line</Button>}>
        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]">
            <Select label={`Line ${index + 1} product`} selectedKey={line.productId || null} onSelectionChange={(value) => {
              const product = options.products.find((entry) => entry.id === String(value));
              setLine(line.key, { productId: String(value), uomId: product?.purchase_uom_id ?? product?.uom_id ?? "" });
            }} options={options.products.map((product) => ({ value: product.id, label: `${product.name} (${product.code})` }))} />
            <TextField label="Quantity" inputMode="decimal" value={line.quantity} onChange={(value) => setLine(line.key, { quantity: value })} />
            <Select label="Unit" selectedKey={line.uomId || null} onSelectionChange={(value) => setLine(line.key, { uomId: String(value) })} options={options.uoms.map((uom) => ({ value: uom.id, label: uom.code }))} />
            <TextField label="Quoted price" inputMode="decimal" value={line.unitPrice} onChange={(value) => setLine(line.key, { unitPrice: value })} />
            <Select label="Discount" selectedKey={line.discountType} onSelectionChange={(value) => setLine(line.key, { discountType: String(value) })}
              options={[{ value: "none", label: "None" }, { value: "percent", label: "Percent" }, { value: "amount", label: "Amount" }]} />
            <TextField label="Discount value" inputMode="decimal" isDisabled={line.discountType === "none"} value={line.discountValue} onChange={(value) => setLine(line.key, { discountValue: value })} />
            <IconButton aria-label={`Remove line ${index + 1}`} variant="ghost" isDisabled={lines.length <= 1} onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </ProcPanel>
      <ProcPanel title="Notes"><TextArea label="Notes" value={values.notes} onChange={set("notes")} /></ProcPanel>
    </div>
  );
}

export function SupplierQuotationDetailScreen({ quotationId }: { quotationId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "quotation", quotationId), queryFn: () => getQuotation(quotationId) });
  const [key] = useState(() => crypto.randomUUID());
  const convert = useMutation({ mutationFn: () => convertQuotation(quotationId, { idempotencyKey: key }), onSuccess: (result) => router.push(`/procurement/purchase-orders/${result.id}`) });
  const cancel = useMutation({ mutationFn: () => cancelQuotation(quotationId), onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }) });
  if (query.isLoading) return <LoadingState label="Loading quotation" />;
  if (!query.data) return <ErrorState title="Could not load this quotation" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const { quotation, lines, actions } = query.data;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/purchase-orders/quotations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-3.5" aria-hidden="true" />All supplier quotations</Link>
      {(convert.error || cancel.error) && <ProcAlert>{errorMessage(convert.error ?? cancel.error)}</ProcAlert>}
      {quotation.expired && quotation.status === "received" && <ProcAlert tone="warning">This quotation expired on {calendarDate(quotation.validUntil)}. Check the prices with the supplier before ordering.</ProcAlert>}
      <RecordDetailsPage header={{
        title: quotation.quotationNumber,
        status: <StatusBadge tone={statusTone(quotation.status)}>{statusLabel(quotation.status)}</StatusBadge>,
        fields: [
          { label: "Supplier", value: <Link className="text-brand hover:underline" href={`/procurement/suppliers/${quotation.supplierId}`}>{quotation.supplierName}</Link> },
          { label: "Supplier reference", value: quotation.supplierReference ?? "—" },
          { label: "Quoted on", value: calendarDate(quotation.quotationDate) },
          { label: "Valid until", value: quotation.validUntil ? calendarDate(quotation.validUntil) : "—" },
        ],
        primaryAction: actions.convert ? <Button variant="primary" isLoading={convert.isPending} onPress={() => convert.mutate()}>Create Purchase Order</Button>
          : quotation.convertedPurchaseOrderId ? <LinkButton variant="secondary" href={`/procurement/purchase-orders/${quotation.convertedPurchaseOrderId}`}>Open {quotation.convertedPurchaseOrderNumber}</LinkButton> : undefined,
        secondaryActions: (
          <div className="flex gap-2">
            {actions.edit && <LinkButton variant="secondary" href={`/procurement/purchase-orders/quotations/${quotation.id}/edit`}>Edit</LinkButton>}
            {actions.cancel && <Button variant="ghost" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel quotation</Button>}
          </div>
        ),
      }}>
        <div className="flex flex-col gap-4 pt-2">
          <ProcPanel title="Terms">
            <ProcFacts columns={3} items={[
              { label: "Currency", value: quotation.currencyCode },
              { label: "Payment terms", value: quotation.paymentTermName ?? "Supplier's terms" },
              { label: "Prices", value: quotation.priceMode === "inclusive" ? "Inclusive of tax" : "Exclusive of tax" },
              { label: "Delivery lead time", value: quotation.deliveryLeadDays != null ? `${quotation.deliveryLeadDays} days` : "—" },
              { label: "RFQ reference", value: quotation.rfqReference ?? "—" },
            ]} />
          </ProcPanel>
          <ProcPanel title="Quoted lines">
            <ul className="flex flex-col divide-y divide-border text-sm">
              {lines.map((line) => (
                <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{line.lineNumber}. {line.productName} ({line.productCode})</span>
                  <span className="tabular-nums">{quantity(line.quantity)} {line.uomCode ?? ""} × {money(quotation.currencyCode, line.unitPrice)}
                    {line.discountType ? ` − ${line.discountType === "percent" ? `${Number(line.discountValue)}%` : money(quotation.currencyCode, line.discountValue)}` : ""}</span></li>
              ))}
            </ul>
          </ProcPanel>
          {quotation.notes && <ProcPanel title="Notes"><p className="whitespace-pre-line text-sm">{quotation.notes}</p></ProcPanel>}
        </div>
      </RecordDetailsPage>
    </div>
  );
}
