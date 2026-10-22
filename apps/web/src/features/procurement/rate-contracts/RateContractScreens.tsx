"use client";

// Procurement → Buy → Rate Contracts (Procurement plan Phase 3): a supplier's agreed rates for items over a period, optionally capped by
// quantity or value. An order for a contracted item takes the contract rate by itself; each contract shows what has been drawn and by which
// orders. Contracts ending within 30 days show on the overview.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, LinkButton, NoResultsState, PageHeader, PermissionState, RecordDetailsPage, SearchField,
  Select, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useListState } from "@/features/procurement/shared/navigation";
import { gridPaging, pageFilters, usePageIndex } from "@/features/procurement/shared/paging";
import { ProcurementSearchPicker, SupplierFilter, useKnownRows } from "@/features/procurement/shared/ProcurementSearchPicker";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { getPurchaseOrderOptions } from "@/features/procurement/purchase-orders/api/purchase-orders-api";

import { createRateContract, errorMessage, getRateContract, listRateContracts, rateContractAction, updateRateContract, type RateContractDetail, type RateContractRow } from "./api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE: Record<string, Tone> = { draft: "neutral", active: "success", scheduled: "info", expired: "neutral", cancelled: "neutral" };
const VIEWS = [{ id: "active", label: "Active" }, { id: "expiring", label: "Ending in 30 days" }, { id: "draft", label: "Draft" }, { id: "ended", label: "Ended" }, { id: "all", label: "All" }];

export function RateContractsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const list = useListState("rate-contracts", { view: "active", filters: { supplierId: "any" } });
  const view = list.view;
  const filters = useMemo(() => ({ view: view === "all" ? undefined : view, search: list.search.trim() || undefined,
    supplierId: list.filters.supplierId === "any" ? undefined : list.filters.supplierId }), [view, list.search, list.filters.supplierId]);
  const [pageIndex, setPageIndex] = usePageIndex(filters);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rate-contracts", filters, pageIndex), queryFn: () => listRateContracts({ ...filters, ...pageFilters(pageIndex) }),
    placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<RateContractRow, unknown>[]>(() => [
    { id: "number", header: "Contract", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span> },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "items", header: "Items", cell: ({ row }) => <span className="line-clamp-2">{row.original.items ?? ""}</span> },
    { id: "period", header: "Period", cell: ({ row }) => `${calendarDate(row.original.validFrom)} – ${calendarDate(row.original.validTo)}` },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
  ], []);
  if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to rate contracts" description="Ask an administrator for a buyer role." />;
  return (
    <EnterpriseListPage header={{ title: "Rate Contracts", description: "Rates agreed with suppliers for a period. Orders for these items take the contract rate; no RFQ is needed.",
      primaryAction: <LinkButton variant="primary" href="/procurement/rate-contracts/new"><Plus className="size-4" aria-hidden="true" />New rate contract</LinkButton> }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: list.setView }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search rate contracts" placeholder="Contract, supplier or item" className="w-full sm:w-80" value={list.search} onChange={list.setSearch} />
          <SupplierFilter known={[]} value={list.filters.supplierId} onChange={(id) => list.setFilter("supplierId", id || "any")} />
        </>
      ) }}>
      <EnterpriseDataGrid<RateContractRow> aria-label="Rate contracts" columns={columns} data={rows} getRowId={(row) => row.id} {...gridPaging(query.data?.total ?? 0, pageIndex, setPageIndex)}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (list.search || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading rate contracts" rows={6} />}
        errorContent={<ErrorState title="Could not load rate contracts" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No rate contracts yet" description="Record the rates a supplier agreed for the year; orders then price themselves." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view, supplier or search." />}
        onRowClick={(row) => router.push(`/procurement/rate-contracts/${row.id}`)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.number} · {row.supplierName}</span>
          <span className="text-xs text-text-muted">{row.statusLabel} · to {calendarDate(row.validTo)}</span></div>} />
    </EnterpriseListPage>
  );
}

type Line = { key: number; productId: string; uomId: string; rate: string; maxQuantity: string; maxValue: string };
let lineKey = 0;
const blank = (): Line => ({ key: ++lineKey, productId: "", uomId: "", rate: "", maxQuantity: "", maxValue: "" });

export function RateContractFormScreen({ contractId }: { contractId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rate-contract", contractId), queryFn: () => getRateContract(contractId!), enabled: Boolean(contractId) });
  const include = { supplierIds: [existing.data?.contract.supplierId ?? ""], productIds: (existing.data?.lines ?? []).map((line) => line.productId) };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options", include.supplierIds.join(","), include.productIds.join(",")),
    queryFn: () => getPurchaseOrderOptions(include), staleTime: 60_000, enabled: !contractId || Boolean(existing.data) });
  if ((contractId && existing.isLoading) || options.isLoading) return <LoadingState label="Loading rate contract" />;
  if (!options.data || (contractId && !existing.data)) return <ErrorState title="Could not load the form" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && !existing.data.actions.edit) return <ErrorState title="This contract cannot be changed" description="Only a draft is changed. Cancel it and record a new one." />;
  return <ContractForm options={options.data} existing={existing.data ?? null} />;
}

function ContractForm({ options, existing }: { options: NonNullable<Awaited<ReturnType<typeof getPurchaseOrderOptions>>>; existing: RateContractDetail | null }) {
  const router = useRouter();
  const current = existing?.contract;
  const [values, setValues] = useState({ supplierId: current?.supplierId ?? "", validFrom: current?.validFrom ?? "", validTo: current?.validTo ?? "", supplierReference: current?.supplierReference ?? "",
    notes: current?.notes ?? "" });
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.length ? existing.lines.map((line) => ({ key: ++lineKey, productId: line.productId, uomId: line.uomId ?? "",
    rate: String(Number(line.rate)), maxQuantity: line.maxQuantity ? String(Number(line.maxQuantity)) : "", maxValue: line.maxValue ? String(Number(line.maxValue)) : "" })) : [blank()]);
  const [knownSuppliers, keepSupplier] = useKnownRows(options.suppliers);
  const [knownProducts, keepProduct] = useKnownRows(options.products);
  const set = (key: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [key]: value }));
  const setLine = (key: number, change: Partial<Line>) => setLines((state) => state.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: (activate: boolean) => submitKey.run(async () => {
      const body = { supplierId: values.supplierId, validFrom: values.validFrom, validTo: values.validTo, supplierReference: values.supplierReference || null, notes: values.notes || null,
        lines: lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, uomId: line.uomId || undefined, rate: line.rate, maxQuantity: line.maxQuantity || null,
          maxValue: line.maxValue || null })) };
      if (existing) {
        await updateRateContract(existing.contract.id, body);
        if (activate) await rateContractAction(existing.contract.id, "activate");
        return existing.contract.id;
      }
      return (await createRateContract({ ...body, activate })).id;
    }),
    onSuccess: (id) => router.replace(`/procurement/rate-contracts/${id}`),
  });
  const ready = Boolean(values.supplierId && values.validFrom && values.validTo) && lines.some((line) => line.productId && line.rate);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={existing ? `Edit ${existing.contract.number}` : "New rate contract"} description="The rates a supplier agreed for a period. Activating it makes orders take these rates."
        secondaryActions={<div className="flex gap-2"><Button variant="secondary" onPress={() => router.replace(existing ? `/procurement/rate-contracts/${existing.contract.id}` : "/procurement/rate-contracts")}>Cancel</Button>
          <Button variant="secondary" isDisabled={!ready || save.isPending} onPress={() => save.mutate(false)}>Save draft</Button></div>}
        primaryAction={<Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending || save.isSuccess} onPress={() => save.mutate(true)}>Save and activate</Button>} />
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      <Panel title="Contract">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProcurementSearchPicker kind="suppliers" label="Supplier" isRequired activeOnly value={values.supplierId || null} known={knownSuppliers}
            onPick={(id, row) => { keepSupplier(row as (typeof knownSuppliers)[number] | null); set("supplierId")(id); }} />
          <TextField label="Valid from" type="date" isRequired value={values.validFrom} onChange={set("validFrom")} />
          <TextField label="Valid to" type="date" isRequired value={values.validTo} onChange={set("validTo")} />
          <TextField label="Supplier's reference" value={values.supplierReference} onChange={set("supplierReference")} />
        </div>
      </Panel>
      <Panel title="Agreed rates" actions={<Button size="compact" variant="secondary" onPress={() => setLines((state) => [...state, blank()])}><Plus className="size-3.5" aria-hidden="true" />Add item</Button>}>
        <div className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
              <ProcurementSearchPicker kind="products" label={`Item ${index + 1}`} value={line.productId || null} known={knownProducts}
                onPick={(id, row) => {
                  const product = (row ?? knownProducts.find((entry) => entry.id === id)) as (typeof knownProducts)[number] | undefined;
                  keepProduct(product ?? null);
                  setLine(line.key, { productId: id, uomId: product?.purchase_uom_id ?? product?.uom_id ?? "" });
                }} />
              <Select label="Unit" selectedKey={line.uomId || null} onSelectionChange={(value) => setLine(line.key, { uomId: String(value) })} options={options.uoms.map((uom) => ({ value: uom.id, label: uom.code }))} />
              <TextField label="Rate (excl. GST)" inputMode="decimal" value={line.rate} onChange={(value) => setLine(line.key, { rate: value })} />
              <TextField label="Up to quantity" inputMode="decimal" value={line.maxQuantity} onChange={(value) => setLine(line.key, { maxQuantity: value })} description="Optional" />
              <TextField label="Up to value" inputMode="decimal" value={line.maxValue} onChange={(value) => setLine(line.key, { maxValue: value })} description="Optional" />
              <IconButton aria-label={`Remove item ${index + 1}`} variant="ghost" isDisabled={lines.length <= 1} onPress={() => setLines((state) => state.filter((entry) => entry.key !== line.key))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Notes"><TextArea label="Notes" value={values.notes} onChange={set("notes")} /></Panel>
    </div>
  );
}

export function RateContractDetailScreen({ contractId }: { contractId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rate-contract", contractId), queryFn: () => getRateContract(contractId) });
  const act = useMutation({ mutationFn: (action: "activate" | "cancel") => rateContractAction(contractId, action),
    onSuccess: () => queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("procurement") }) });
  if (query.isLoading) return <LoadingState label="Loading rate contract" />;
  if (query.isError || !query.data) return <ErrorState title="Could not load this rate contract" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { contract, lines, orders, actions } = query.data;
  const currency = contract.currencyCode;
  return (
    <div className="flex flex-col gap-4">
      {act.error && <Notice>{errorMessage(act.error)}</Notice>}
      <RecordDetailsPage
        header={{
          title: contract.number,
          status: <StatusBadge tone={TONE[contract.status] ?? "neutral"}>{contract.statusLabel}</StatusBadge>,
          fields: [
            { label: "Supplier", value: <Link className="hover:underline" href={`/procurement/suppliers/${contract.supplierId}`}>{contract.supplierName}</Link> },
            { label: "Period", value: `${calendarDate(contract.validFrom)} – ${calendarDate(contract.validTo)}` },
            { label: "Supplier's reference", value: contract.supplierReference ?? "—" },
          ],
          primaryAction: actions.activate ? <Button variant="primary" isLoading={act.isPending} onPress={() => act.mutate("activate")}>Activate</Button> : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <LinkButton variant="secondary" href={`/procurement/rate-contracts/${contract.id}/edit`}>Edit</LinkButton>}
              {actions.cancel && <Button variant="ghost" onPress={() => act.mutate("cancel")}>Cancel contract</Button>}
            </div>
          ),
        }}
      >
        <Panel title="Agreed rates">
          <LinesTable columns={["Item", { label: "Rate", numeric: true }, { label: "Drawn", numeric: true }, { label: "Left", numeric: true }]}>
            {lines.map((line) => (
              <tr key={line.id}>
                <Cell><span className="font-medium">{line.productName}</span><span className="block text-xs text-text-muted">{line.productCode} · per {line.uomCode}</span></Cell>
                <Cell numeric>{money(currency, line.rate)}</Cell>
                <Cell numeric>{quantity(line.drawnQuantity)} · {money(currency, line.drawnValue)}</Cell>
                <Cell numeric>{[line.remainingQuantity !== null ? `${quantity(line.remainingQuantity)} ${line.uomCode ?? ""}` : null, line.remainingValue !== null ? money(currency, line.remainingValue) : null]
                  .filter(Boolean).join(" · ") || "No limit"}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
        <Panel title="Orders drawing on it">
          {orders.length ? (
            <ul className="flex flex-col gap-1 text-sm">{orders.map((order) => <li key={order.id}><Link className="text-brand hover:underline" href={order.href}>{order.number}</Link> · {calendarDate(order.date)} · {order.status}</li>)}</ul>
          ) : <p className="text-sm text-text-muted">No order has used this contract yet.</p>}
        </Panel>
        <Panel title="Details"><Facts items={[{ label: "Notes", value: contract.notes ?? "—" }, { label: "Activated", value: contract.activatedAt ? calendarDate(String(contract.activatedAt).slice(0, 10)) : "—" }]} /></Panel>
      </RecordDetailsPage>
    </div>
  );
}
