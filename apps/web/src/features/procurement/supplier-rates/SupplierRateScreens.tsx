"use client";

// Supplier Rates (Procurement report H1): each supplier's price list — rate per unit from a minimum quantity, period, lead time, the
// supplier's own item code and the preferred supplier for each item. Orders take these rates after a rate contract; reorder and
// make-to-order buy from the preferred supplier. Shown with the rate contracts under one Supplier Rates page.
import { useMemo, useRef, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Upload } from "lucide-react";
import {
  Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PageHeader, PermissionState, SearchField, Select, StatusBadge,
  TextArea, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { LinkTabs } from "@/shared/ui/RouteTabs";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useListState } from "@/features/procurement/shared/navigation";
import { gridPaging, pageFilters, usePageIndex } from "@/features/procurement/shared/paging";
import { ProcurementSearchPicker, SupplierFilter, useKnownRows } from "@/features/procurement/shared/ProcurementSearchPicker";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { getPurchaseOrderOptions } from "@/features/procurement/purchase-orders/api/purchase-orders-api";

import {
  createSupplierRate, errorMessage, fillSupplierRates, getSupplierRate, importSupplierRates, listSupplierRates, setSupplierRateActive, updateSupplierRate,
  type SupplierRate, type SupplierRateImport,
} from "./api";

const VIEWS = [{ id: "active", label: "Current" }, { id: "preferred", label: "Preferred" }, { id: "ended", label: "Ended" }, { id: "inactive", label: "Switched off" }, { id: "all", label: "All" }];
const STATE_LABEL: Record<SupplierRate["state"], string> = { current: "Current", scheduled: "Starts later", ended: "Ended", inactive: "Switched off" };

// Price lists | Rate contracts: the two kinds of supplier rates.
export function RatesTabs({ current }: { current: "prices" | "contracts" }) {
  return <LinkTabs label="Supplier rates" current={current} tabs={[
    { id: "prices", label: "Price lists", href: "/procurement/supplier-rates" },
    { id: "contracts", label: "Rate contracts", href: "/procurement/rate-contracts" },
  ]} />;
}

const rateText = (row: SupplierRate) => `${money(row.currencyCode, row.rate)} per ${row.uomCode ?? "unit"}${Number(row.minimumQuantity) > 1 ? ` from ${quantity(row.minimumQuantity)}` : ""}`;

export function SupplierRatesScreen({ supplierId, embedded = false }: { supplierId?: string; embedded?: boolean }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const list = useListState(supplierId ? `supplier-rates-${supplierId}` : "supplier-rates", { view: supplierId ? "all" : "active", filters: { supplierId: "any" } });
  const [importing, setImporting] = useState(false);
  const filters = useMemo(() => ({ view: list.view, search: list.search.trim() || undefined,
    supplierId: supplierId ?? (list.filters.supplierId === "any" ? undefined : list.filters.supplierId) }), [list.view, list.search, list.filters.supplierId, supplierId]);
  const [pageIndex, setPageIndex] = usePageIndex(filters);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-rates", filters, pageIndex), queryFn: () => listSupplierRates({ ...filters, ...pageFilters(pageIndex) }),
    placeholderData: (previous) => previous });
  const fill = useMutation({ mutationFn: fillSupplierRates, onSuccess: () => void queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("supplier-rates") }) });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<SupplierRate, unknown>[]>(() => [
    { id: "item", header: "Item", cell: ({ row }) => <span><span className="font-medium">{row.original.productName}</span>
      <span className="block text-xs text-text-muted">{[row.original.productCode, row.original.supplierItemCode ? `their code ${row.original.supplierItemCode}` : null].filter(Boolean).join(" · ")}</span></span> },
    ...(supplierId ? [] : [{ id: "supplier", header: "Supplier", cell: ({ row }: { row: { original: SupplierRate } }) => (
      <span className="flex flex-wrap items-center gap-1">{row.original.supplierName}{row.original.preferred && <StatusBadge tone="success">Preferred</StatusBadge>}</span>) }]),
    { id: "rate", header: "Rate", cell: ({ row }) => <span className="tabular-nums">{rateText(row.original)}</span> },
    { id: "valid", header: "Valid", cell: ({ row }) => `${calendarDate(row.original.validFrom)}${row.original.validTo ? ` – ${calendarDate(row.original.validTo)}` : " onwards"}` },
    { id: "lead", header: "Lead time", cell: ({ row }) => (row.original.leadTimeDays !== null ? `${row.original.leadTimeDays} days` : "—") },
    { id: "state", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.state === "current" ? "success" : row.original.state === "scheduled" ? "info" : "neutral"}>{STATE_LABEL[row.original.state]}</StatusBadge> },
  ], [supplierId]);
  if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to supplier rates" description="Ask an administrator for a buyer role." />;
  const newHref = `/procurement/supplier-rates/new${supplierId ? `?supplierId=${supplierId}` : ""}`;
  const grid = (
    <EnterpriseDataGrid<SupplierRate> aria-label="Supplier rates" columns={columns} data={rows} getRowId={(row) => row.id} {...gridPaging(query.data?.total ?? 0, pageIndex, setPageIndex)}
      state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (list.search || list.view !== "all" ? "no-results" : "empty") : "ready"}
      loadingContent={<LoadingState label="Loading supplier rates" rows={6} />}
      errorContent={<ErrorState title="Could not load supplier rates" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      emptyContent={<EmptyState title="No supplier rates yet" description="Add the prices your suppliers quote, or fill them from past orders." />}
      noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view, supplier or search." />}
      onRowClick={(row) => router.push(`/procurement/supplier-rates/${row.id}/edit`)}
      renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium">{row.productName}{row.preferred ? " · Preferred" : ""}</span>
        <span className="text-xs text-text-muted">{supplierId ? "" : `${row.supplierName} · `}{rateText(row)}</span></div>} />
  );
  if (embedded) {
    return (
      <Panel title="Rates" description="What this supplier sells and for how much."
        actions={<LinkButton size="compact" variant="secondary" href={newHref}><Plus className="size-3.5" aria-hidden="true" />Add rate</LinkButton>}>
        {grid}
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <RatesTabs current="prices" />
      {fill.data && <Notice tone="success">{fill.data.created ? `${fill.data.created} rate${fill.data.created === 1 ? "" : "s"} added from past orders: check them.` : "Every item bought in the last year already has a rate."}</Notice>}
      {fill.error && <Notice>{errorMessage(fill.error)}</Notice>}
      {importing && <ImportPanel onClose={() => setImporting(false)} />}
      <EnterpriseListPage header={{ title: "Supplier Rates", description: "Each supplier's prices. Orders take them when there is no rate contract.",
        primaryAction: <LinkButton variant="primary" href={newHref}><Plus className="size-4" aria-hidden="true" />New rate</LinkButton>,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onPress={() => setImporting(true)}><Upload className="size-4" aria-hidden="true" />Import</Button>
            <Button variant="secondary" isLoading={fill.isPending} onPress={() => fill.mutate()}>Fill from past orders</Button>
          </div>
        ) }}
        savedViews={{ views: VIEWS, activeViewId: list.view, onSelect: list.setView }}
        actionBar={{ start: (
          <>
            <SearchField aria-label="Search supplier rates" placeholder="Item, supplier or their code" className="w-full sm:w-80" value={list.search} onChange={list.setSearch} />
            <SupplierFilter known={[]} value={list.filters.supplierId} onChange={(id) => list.setFilter("supplierId", id || "any")} />
          </>
        ) }}>
        {grid}
      </EnterpriseListPage>
    </div>
  );
}

function ImportPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SupplierRateImport | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importSupplierRates(file!, dryRun),
    onSuccess: (outcome) => { setResult(outcome); if (!outcome.dryRun) void queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("supplier-rates") }); },
  });
  return (
    <Panel title="Import supplier rates" description="A CSV or Excel file with Supplier, Item code and Rate columns. Check it first, then import."
      actions={<Button size="compact" variant="ghost" onPress={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">Optional columns: Unit, Minimum quantity, Currency, Valid from, Valid to, Lead time (days), Supplier&apos;s item code, Preferred (yes).</p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".csv,.xlsx" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); }} />
          <Button variant="secondary" onPress={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Choose file</Button>
          <span className="min-w-0 truncate text-sm text-text-muted">{file?.name ?? "No file chosen"}</span>
        </div>
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        {result && (
          <Notice tone={result.errors.length ? "warning" : "success"}>
            {result.dryRun ? "Checked: " : "Imported: "}{result.created} new, {result.updated} updated{result.errors.length ? `, ${result.errors.length} with problems` : ""}.
            {result.errors.length > 0 && <ul className="mt-1 list-disc pl-5">{result.errors.slice(0, 20).map((error) => <li key={error.row}>Row {error.row}: {error.message}</li>)}</ul>}
          </Notice>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" isDisabled={!file} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check</Button>
          <Button variant="primary" isDisabled={!file || (result?.dryRun === false)} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import</Button>
        </div>
      </div>
    </Panel>
  );
}

export function SupplierRateFormScreen({ rateId, supplierId }: { rateId?: string; supplierId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-rate", rateId), queryFn: () => getSupplierRate(rateId!), enabled: Boolean(rateId) });
  const current = existing.data?.rate;
  const include = { supplierIds: [current?.supplierId ?? supplierId ?? ""], productIds: [current?.productId ?? ""] };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options", include.supplierIds.join(","), include.productIds.join(",")),
    queryFn: () => getPurchaseOrderOptions(include), staleTime: 60_000, enabled: !rateId || Boolean(existing.data) });
  if ((rateId && existing.isLoading) || options.isLoading) return <LoadingState label="Loading supplier rate" />;
  if (!options.data || (rateId && !existing.data)) return <ErrorState title="Could not load the form" description={errorMessage(options.error ?? existing.error)} />;
  return <RateForm options={options.data} current={current ?? null} supplierId={supplierId} canEdit={!existing.data || existing.data.actions.edit} />;
}

function RateForm({ options, current, supplierId, canEdit }: {
  options: NonNullable<Awaited<ReturnType<typeof getPurchaseOrderOptions>>>; current: SupplierRate | null; supplierId?: string; canEdit: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    supplierId: current?.supplierId ?? supplierId ?? "", productId: current?.productId ?? "", uomId: current?.uomId ?? "", rate: current ? String(Number(current.rate)) : "",
    minimumQuantity: current ? String(Number(current.minimumQuantity)) : "1", currencyCode: current?.currencyCode ?? "", validFrom: current?.validFrom ?? "", validTo: current?.validTo ?? "",
    leadTimeDays: current?.leadTimeDays !== null && current?.leadTimeDays !== undefined ? String(current.leadTimeDays) : "", supplierItemCode: current?.supplierItemCode ?? "",
    preferred: current?.preferred ?? false, notes: current?.notes ?? "",
  });
  const [knownSuppliers, keepSupplier] = useKnownRows(options.suppliers);
  const [knownProducts, keepProduct] = useKnownRows(options.products);
  const set = (key: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [key]: value }));
  const back = () => router.replace(supplierId ? `/procurement/suppliers/${supplierId}` : "/procurement/supplier-rates");
  const submitKey = useSubmitKey();
  const done = () => { void queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("supplier-rates") }); back(); };
  const save = useMutation({
    mutationFn: () => submitKey.run(async () => {
      const body = { supplierId: values.supplierId, productId: values.productId, uomId: values.uomId || undefined, rate: values.rate.trim(), minimumQuantity: values.minimumQuantity.trim() || "1",
        currencyCode: values.currencyCode || undefined, validFrom: values.validFrom || undefined, validTo: values.validTo || null,
        leadTimeDays: values.leadTimeDays.trim() === "" ? null : Number(values.leadTimeDays), supplierItemCode: values.supplierItemCode.trim() || null, preferred: values.preferred,
        notes: values.notes.trim() || null };
      return current ? updateSupplierRate(current.id, body) : createSupplierRate(body);
    }),
    onSuccess: done,
  });
  const toggle = useMutation({ mutationFn: () => setSupplierRateActive(current!.id, current!.status !== "active"), onSuccess: done });
  const ready = Boolean(values.supplierId && values.productId && /^\d+(\.\d+)?$/.test(values.rate.trim()));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={current ? `${current.productName} · ${current.supplierName}` : "New supplier rate"} description="A supplier's price for an item."
        secondaryActions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" onPress={back}>Cancel</Button>
          {current && canEdit && <Button variant="secondary" isLoading={toggle.isPending} onPress={() => toggle.mutate()}>{current.status === "active" ? "Switch off" : "Switch on"}</Button>}
        </div>}
        primaryAction={canEdit ? <Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending || save.isSuccess} onPress={() => save.mutate()}>Save</Button> : undefined} />
      {(save.error || toggle.error) && <Notice>{errorMessage(save.error ?? toggle.error)}</Notice>}
      <Panel title="Rate">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProcurementSearchPicker kind="suppliers" label="Supplier" isRequired activeOnly value={values.supplierId || null} known={knownSuppliers} isDisabled={Boolean(current)}
            onPick={(id, row) => { keepSupplier(row as (typeof knownSuppliers)[number] | null); set("supplierId")(id); }} />
          <ProcurementSearchPicker kind="products" label="Item" isRequired value={values.productId || null} known={knownProducts} isDisabled={Boolean(current)}
            onPick={(id, row) => {
              const product = (row ?? knownProducts.find((entry) => entry.id === id)) as (typeof knownProducts)[number] | undefined;
              keepProduct(product ?? null);
              setValues((state) => ({ ...state, productId: id, uomId: product?.purchase_uom_id ?? product?.uom_id ?? "" }));
            }} />
          <Select label="Unit" selectedKey={values.uomId || null} onSelectionChange={(value) => set("uomId")(String(value))} options={options.uoms.map((uom) => ({ value: uom.id, label: uom.code }))} />
          <TextField label="Rate (excl. GST)" isRequired inputMode="decimal" value={values.rate} onChange={(value) => set("rate")(value.replace(/[^0-9.]/g, ""))} />
          <TextField label="From quantity" inputMode="decimal" value={values.minimumQuantity} onChange={(value) => set("minimumQuantity")(value.replace(/[^0-9.]/g, ""))}
            description="The rate applies from this quantity." />
          <Select label="Currency" selectedKey={values.currencyCode || "supplier"} onSelectionChange={(value) => set("currencyCode")(value === "supplier" ? "" : String(value))}
            options={[{ value: "supplier", label: "Supplier's currency" }, ...options.currencies.map((currency) => ({ value: currency.code, label: currency.code }))]} />
          <TextField label="Valid from" type="date" value={values.validFrom} onChange={set("validFrom")} description="Today if empty." />
          <TextField label="Valid to" type="date" value={values.validTo} onChange={set("validTo")} description="Empty: until changed." />
          <TextField label="Lead time (days)" inputMode="numeric" value={values.leadTimeDays} onChange={(value) => set("leadTimeDays")(value.replace(/\D/g, ""))} />
          <TextField label="Supplier's item code" value={values.supplierItemCode} onChange={set("supplierItemCode")} />
        </div>
        <Checkbox isSelected={values.preferred} onChange={(on) => setValues((state) => ({ ...state, preferred: on }))}>
          Preferred supplier for this item (reorder and make-to-order buy from it)
        </Checkbox>
        <TextArea label="Notes" value={values.notes} onChange={set("notes")} rows={2} />
      </Panel>
    </div>
  );
}
