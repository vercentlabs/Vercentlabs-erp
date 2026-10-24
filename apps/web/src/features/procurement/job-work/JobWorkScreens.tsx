"use client";

// Job work (Procurement report Phase 3): material sent to a job worker on a job-work challan (no tax, GST s.143), and what came back —
// processed into the product, unprocessed, or lost as waste. Inputs are due back within a year, capital goods within three. ITC-04 exports
// what was sent and what came back for a period.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Plus, Printer, Send } from "lucide-react";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PageHeader, PermissionState, RecordDetailsPage, Select, StatusBadge,
  TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { useSubmitKey } from "@/shared/http/submit-once";
import { ProcApiError } from "@/features/procurement/shared/http";
import { ProcurementSearchPicker, useKnownRows } from "@/features/procurement/shared/ProcurementSearchPicker";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { getPurchaseOrder, getPurchaseOrderOptions, listPurchaseOrders } from "@/features/procurement/purchase-orders/api/purchase-orders-api";

import { createJobWork, errorMessage, getJobWork, itc04Url, jobWorkAction, listJobWork, type JobWork } from "./api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE: Record<JobWork["status"], Tone> = { draft: "neutral", sent: "info", partly_returned: "warning", completed: "success", cancelled: "neutral" };
const VIEWS = [{ id: "open", label: "Open" }, { id: "overdue", label: "Overdue" }, { id: "all", label: "All" }];
const inr = (value: number) => money("INR", String(value));
const today = () => new Date().toISOString().slice(0, 10);

export function JobWorkListScreen() {
  const router = useRouter();
  const [view, setView] = useState("open");
  const query = useQuery({ queryKey: ["procurement", "job-work", view], queryFn: () => listJobWork(view) });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<JobWork, unknown>[]>(() => [
    { id: "number", header: "Challan", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span> },
    { id: "worker", header: "Job worker", cell: ({ row }) => row.original.jobWorker.name ?? "—" },
    { id: "job", header: "Job", cell: ({ row }) => row.original.natureOfJob ?? "—" },
    { id: "sent", header: "Sent", cell: ({ row }) => (row.original.sentDate ? calendarDate(row.original.sentDate) : "—") },
    { id: "due", header: "Due back", cell: ({ row }) => <span className={row.original.overdue ? "text-danger" : ""}>{row.original.dueDate ? calendarDate(row.original.dueDate) : "—"}</span> },
    { id: "value", header: "Value", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.totalValue)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex flex-wrap gap-1"><StatusBadge tone={TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge>
      {row.original.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}</span> },
  ], []);
  if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to job work" description="Ask an administrator for a buyer role." />;
  return (
    <div className="flex flex-col gap-4">
      <EnterpriseListPage header={{ title: "Job Work", description: "Material sent to job workers and what came back.",
        primaryAction: query.data?.canManage ? <LinkButton variant="primary" href="/procurement/job-work/new"><Plus className="size-4" aria-hidden="true" />Send material</LinkButton> : undefined }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: setView }}>
        <EnterpriseDataGrid<JobWork> aria-label="Job work" columns={columns} data={rows} getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (view === "all" ? "empty" : "no-results") : "ready"}
          loadingContent={<LoadingState label="Loading job work" rows={5} />}
          errorContent={<ErrorState title="Could not load job work" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No job work yet" description="Send material to a job worker on a job-work challan." />}
          noResultsContent={<NoResultsState title="Nothing in this view" description="Try All." />}
          onRowClick={(row) => router.push(`/procurement/job-work/${row.id}`)}
          renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.number} · {row.jobWorker.name ?? ""}</span>
            <span className={`text-xs ${row.overdue ? "text-danger" : "text-text-muted"}`}>{row.statusLabel}{row.dueDate ? ` · due back ${calendarDate(row.dueDate)}` : ""}</span></div>} />
      </EnterpriseListPage>
      <Itc04Panel />
    </div>
  );
}

function Itc04Panel() {
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${new Date().getMonth() >= 3 ? year : year - 1}-04-01`);
  const [to, setTo] = useState(today());
  return (
    <Panel title="Form ITC-04" description="What was sent to job workers and what came back, for the period.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField label="From" type="date" value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
        <a className={buttonVariants({ variant: "secondary" })} href={itc04Url(from, to)} download><Download className="size-4" aria-hidden="true" />Download ITC-04 (CSV)</a>
      </div>
    </Panel>
  );
}

type Row = { key: string; itemId: string; description: string; quantity: string; unitValue: string; unit: string };
const blank = (): Row => ({ key: crypto.randomUUID(), itemId: "", description: "", quantity: "", unitValue: "", unit: "" });

export function JobWorkFormScreen() {
  const options = useQuery({ queryKey: ["procurement", "po-options", "job-work"], queryFn: () => getPurchaseOrderOptions({}), staleTime: 60_000 });
  if (options.isLoading) return <LoadingState label="Loading" />;
  if (!options.data) return <ErrorState title="Could not load the form" description={errorMessage(options.error)} />;
  return <JobWorkForm options={options.data} />;
}

function JobWorkForm({ options }: { options: NonNullable<Awaited<ReturnType<typeof getPurchaseOrderOptions>>> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [header, setHeader] = useState({ supplierId: "", warehouseId: options.warehouses[0]?.id ?? "", goodsKind: "inputs", natureOfJob: "", purchaseOrderId: "", vehicleNumber: "", notes: "" });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [knownSuppliers, keepSupplier] = useKnownRows(options.suppliers);
  const [knownProducts, keepProduct] = useKnownRows(options.products);
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const setRow = (key: string, change: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const orders = useQuery({ queryKey: ["procurement", "job-work", "orders", header.supplierId], enabled: Boolean(header.supplierId),
    queryFn: () => listPurchaseOrders({ supplierId: header.supplierId, view: "open", limit: 50 }) });
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submitKey.run(() => createJobWork({ ...header, warehouseId: header.warehouseId || undefined, purchaseOrderId: header.purchaseOrderId || undefined,
      natureOfJob: header.natureOfJob.trim() || undefined, vehicleNumber: header.vehicleNumber.trim() || undefined, notes: header.notes.trim() || undefined,
      lines: rows.filter((row) => Number(row.quantity) > 0).map((row) => ({ itemId: row.itemId || undefined, description: row.description.trim() || undefined, quantity: row.quantity,
        unitValue: row.unitValue.trim() || undefined, unit: row.unit.trim() || undefined })) })),
    onSuccess: (job) => { void queryClient.invalidateQueries({ queryKey: ["procurement", "job-work"] }); router.replace(`/procurement/job-work/${job.id}`); },
  });
  const ready = Boolean(header.supplierId) && rows.some((row) => Number(row.quantity) > 0 && (row.itemId || row.description.trim()));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Send material for job work" description="A job-work challan: no tax; the material stays yours."
        secondaryActions={<Button variant="secondary" onPress={() => router.replace("/procurement/job-work")}>Cancel</Button>}
        primaryAction={<Button variant="primary" isDisabled={!ready || save.isPending || save.isSuccess} isLoading={save.isPending} onPress={() => save.mutate()}>Save draft</Button>} />
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      <Panel title="Job worker">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProcurementSearchPicker kind="suppliers" label="Job worker" isRequired activeOnly value={header.supplierId || null} known={knownSuppliers}
            onPick={(id, row) => { keepSupplier(row as (typeof knownSuppliers)[number] | null); setHeader((current) => ({ ...current, supplierId: id, purchaseOrderId: "" })); }} />
          <TextField label="Job" value={header.natureOfJob} onChange={set("natureOfJob")} placeholder="Machining, plating, stitching" />
          <Select label="Goods" selectedKey={header.goodsKind} onSelectionChange={(value) => set("goodsKind")(String(value))}
            options={[{ value: "inputs", label: "Inputs (back within 1 year)" }, { value: "capital_goods", label: "Capital goods (back within 3 years)" }]} />
          <Select label="Sent from" selectedKey={header.warehouseId || null} onSelectionChange={(value) => set("warehouseId")(String(value))}
            options={options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
          <Select label="Job worker's order" selectedKey={header.purchaseOrderId || "none"} isDisabled={!header.supplierId}
            onSelectionChange={(value) => set("purchaseOrderId")(value === "none" ? "" : String(value))} description="The order for the product or the job charge."
            options={[{ value: "none", label: "None" }, ...(orders.data?.rows ?? []).map((order) => ({ value: order.id, label: order.purchaseOrderNumber }))]} />
          <TextField label="Vehicle number" value={header.vehicleNumber} onChange={set("vehicleNumber")} />
        </div>
      </Panel>
      <Panel title="Material sent">
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 items-end gap-2 border-b border-border pb-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_8rem_8rem_auto]">
              <ProcurementSearchPicker kind="products" label={`Item ${index + 1}`} value={row.itemId || null} known={knownProducts}
                onPick={(id, picked) => { keepProduct(picked as (typeof knownProducts)[number] | null); setRow(row.key, { itemId: id }); }} />
              <TextField label="Description" value={row.description} onChange={(value) => setRow(row.key, { description: value })} placeholder={row.itemId ? "The item's name" : "Describe the material"} />
              <TextField label="Quantity" inputMode="decimal" value={row.quantity} onChange={(value) => setRow(row.key, { quantity: value.replace(/[^0-9.]/g, "") })} />
              <TextField label="Value per unit" inputMode="decimal" value={row.unitValue} onChange={(value) => setRow(row.key, { unitValue: value.replace(/[^0-9.]/g, "") })} description="Empty: its cost." />
              <Button variant="ghost" isDisabled={rows.length === 1} onPress={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>Remove</Button>
            </div>
          ))}
          <div><Button variant="secondary" onPress={() => setRows((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add material</Button></div>
          <TextArea label="Notes" value={header.notes} onChange={set("notes")} rows={2} />
        </div>
      </Panel>
    </div>
  );
}

export function JobWorkDetailScreen({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["procurement", "job-work", "one", id], queryFn: () => getJobWork(id) });
  const [dialog, setDialog] = useState<"send" | "return" | null>(null);
  const cancel = useMutation({ mutationFn: () => jobWorkAction(id, "cancel"), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["procurement", "job-work"] }) });
  if (query.isLoading) return <LoadingState label="Loading job work" />;
  if (!query.data) return <ErrorState title="Could not load this job work" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => void query.refetch() }} />;
  const job = query.data;
  const done = () => { setDialog(null); void queryClient.invalidateQueries({ queryKey: ["procurement", "job-work"] }); };
  const lineName = new Map((job.lines ?? []).map((line) => [line.id, line.description]));
  return (
    <div className="flex flex-col gap-4">
      {cancel.error && <Notice>{errorMessage(cancel.error)}</Notice>}
      {job.overdue && <Notice tone="warning">Due back on {calendarDate(job.dueDate)}. Material not back in time is treated as supplied to the job worker: GST is payable on it.</Notice>}
      <RecordDetailsPage header={{
        title: job.number,
        status: <span className="flex flex-wrap gap-1"><StatusBadge tone={TONE[job.status]}>{job.statusLabel}</StatusBadge>{job.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}</span>,
        fields: [
          { label: "Job worker", value: <Link className="text-brand hover:underline" href={`/procurement/suppliers/${job.supplierId}`}>{job.jobWorker.name ?? "—"}</Link> },
          { label: "Sent", value: job.sentDate ? calendarDate(job.sentDate) : "Not yet" },
          { label: "Due back", value: job.dueDate ? calendarDate(job.dueDate) : "—" },
          { label: "Value", value: inr(job.totalValue) },
        ],
        primaryAction: job.actions?.send ? <Button variant="primary" onPress={() => setDialog("send")}><Send className="size-4" aria-hidden="true" />Send</Button>
          : job.actions?.recordReturn ? <Button variant="primary" onPress={() => setDialog("return")}>Record what came back</Button> : undefined,
        secondaryActions: <div className="flex flex-wrap gap-2">
          {job.status !== "draft" && job.status !== "cancelled" && <LinkButton variant="secondary" href={`/procurement/job-work/${job.id}/print`}><Printer className="size-4" aria-hidden="true" />Print challan</LinkButton>}
          {job.actions?.cancel && <Button variant="ghost" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel draft</Button>}
        </div>,
      }}>
        <div className="flex flex-col gap-4">
          <Panel title="Details">
            <Facts items={[
              { label: "Job", value: job.natureOfJob ?? "—" }, { label: "Goods", value: job.goodsKind === "capital_goods" ? "Capital goods" : "Inputs" },
              { label: "Sent from", value: job.warehouseName ?? "—" }, { label: "Stock", value: job.stockMoved ? "Moved to At job workers" : "Not moved" },
              { label: "Job worker's order", value: job.purchaseOrderId ? <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${job.purchaseOrderId}`}>{job.purchaseOrderNumber}</Link> : "—" },
              { label: "GSTIN", value: job.jobWorker.gstin ?? "Unregistered" },
            ]} />
          </Panel>
          <Panel title="Material">
            <ul className="flex flex-col divide-y divide-border text-sm">
              {(job.lines ?? []).map((line) => (
                <li key={line.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span><span className="font-medium">{line.description}</span><span className="text-text-muted">{` · ${quantity(String(line.quantity))} ${line.unit ?? ""} · ${inr(line.value)}`}</span></span>
                  <span className="text-xs text-text-secondary">{`Processed ${quantity(String(line.processed))} · back ${quantity(String(line.returned))} · waste ${quantity(String(line.waste))} · still out ${quantity(String(line.pending))}`}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {(job.returns ?? []).length > 0 && (
            <Panel title="Came back">
              <ul className="flex flex-col divide-y divide-border text-sm">
                {job.returns!.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                    <span>{`${calendarDate(entry.returnDate)} · ${lineName.get(entry.lineId) ?? ""} · ${quantity(String(entry.quantity))} ${entry.kind === "processed" ? "processed" : entry.kind === "waste" ? "waste or lost" : "unprocessed"}`}</span>
                    <span className="text-xs text-text-muted">{[entry.challanNumber ? `their challan ${entry.challanNumber}` : null, entry.goodsReceiptNumber ? `GRN ${entry.goodsReceiptNumber}` : null].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </RecordDetailsPage>
      {dialog === "send" && <SendDialog job={job} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "return" && <ReturnDialog job={job} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function SendDialog({ job, onClose, onDone }: { job: JobWork; onClose: () => void; onDone: () => void }) {
  const [sentDate, setSentDate] = useState("");
  const run = useMutation({ mutationFn: () => jobWorkAction(job.id, "send", { sentDate: sentDate || undefined }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Send ${job.number}`} description="Stocked material moves to the At job workers warehouse." size="md">
      <div className="flex flex-col gap-3">
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        <TextField label="Sent on" type="date" value={sentDate} onChange={setSentDate} description="Leave empty for today." />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={run.isPending} onPress={() => run.mutate()}>Send</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReturnDialog({ job, onClose, onDone }: { job: JobWork; onClose: () => void; onDone: () => void }) {
  const open = (job.lines ?? []).filter((line) => line.pending > 0);
  const [values, setValues] = useState<Record<string, { processed: string; unprocessed: string; waste: string }>>(
    () => Object.fromEntries(open.map((line) => [line.id, { processed: "", unprocessed: "", waste: "" }])));
  const [header, setHeader] = useState({ returnDate: "", challanNumber: "", challanDate: "", goodsReceiptId: "" });
  const order = useQuery({ queryKey: ["procurement", "job-work", "order", job.purchaseOrderId], enabled: Boolean(job.purchaseOrderId), queryFn: () => getPurchaseOrder(job.purchaseOrderId!) });
  const receipts = (order.data?.related.receipts ?? []).filter((receipt) => receipt.status === "posted");
  const run = useMutation({
    mutationFn: () => jobWorkAction(job.id, "returns", { returnDate: header.returnDate || undefined, challanNumber: header.challanNumber.trim() || undefined,
      challanDate: header.challanDate || undefined, goodsReceiptId: header.goodsReceiptId || undefined,
      lines: open.map((line) => ({ lineId: line.id, processed: values[line.id]?.processed || 0, unprocessed: values[line.id]?.unprocessed || 0, waste: values[line.id]?.waste || 0 })) }),
    onSuccess: onDone,
  });
  const number = (value: string) => value.replace(/[^0-9.]/g, "");
  const anything = open.some((line) => ["processed", "unprocessed", "waste"].some((key) => Number(values[line.id]?.[key as "processed"]) > 0));
  return (
    <Dialog isOpen onOpenChange={(state) => !state && onClose()} title="Record what came back" size="lg"
      description="Processed: inside the product you received. Unprocessed: returned as sent. Waste: used up or lost at the job worker.">
      <div className="flex flex-col gap-3">
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        {open.map((line) => (
          <div key={line.id} className="flex flex-col gap-2 border-b border-border pb-3">
            <span className="text-sm font-medium">{`${line.description} · ${quantity(String(line.pending))} still out`}</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["processed", "unprocessed", "waste"] as const).map((key) => (
                <TextField key={key} label={key === "processed" ? "Processed" : key === "unprocessed" ? "Back unprocessed" : "Waste or lost"} inputMode="decimal" value={values[line.id]?.[key] ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, [line.id]: { ...current[line.id], [key]: number(value) } }))} />
              ))}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Came back on" type="date" value={header.returnDate} onChange={(value) => setHeader((current) => ({ ...current, returnDate: value }))} description="Leave empty for today." />
          <TextField label="Job worker's challan" value={header.challanNumber} onChange={(value) => setHeader((current) => ({ ...current, challanNumber: value }))} />
          <TextField label="Their challan date" type="date" value={header.challanDate} onChange={(value) => setHeader((current) => ({ ...current, challanDate: value }))} />
          {job.purchaseOrderId && <Select label="Product received on" selectedKey={header.goodsReceiptId || "none"}
            onSelectionChange={(value) => setHeader((current) => ({ ...current, goodsReceiptId: value === "none" ? "" : String(value) }))}
            description="Its stock value takes the material's cost." options={[{ value: "none", label: "Not chosen" }, ...receipts.map((receipt) => ({ value: receipt.id, label: receipt.number }))]} />}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!anything} isLoading={run.isPending} onPress={() => run.mutate()}>Record</Button>
        </div>
      </div>
    </Dialog>
  );
}

// The job-work challan to print (Rule 55): three copies go with the material.
export function JobWorkChallanPrint({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["procurement", "job-work", "one", id], queryFn: () => getJobWork(id) });
  if (query.isLoading) return <LoadingState label="Loading challan" />;
  if (!query.data) return <ErrorState title="Could not load the challan" description={errorMessage(query.error)} />;
  const job = query.data;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 bg-surface p-4 text-sm print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <LinkButton variant="secondary" href={`/procurement/job-work/${job.id}`}>Back</LinkButton>
        <Button variant="primary" onPress={() => window.print()}><Printer className="size-4" aria-hidden="true" />Print</Button>
      </div>
      <h1 className="text-lg font-semibold">Delivery challan for job work</h1>
      <p className="text-text-secondary">Goods sent for job work under section 143 of the CGST Act, 2017. Not a supply; no tax charged.</p>
      <Facts items={[
        { label: "Challan", value: job.number }, { label: "Date", value: job.sentDate ? calendarDate(job.sentDate) : "—" },
        { label: "Job worker", value: job.jobWorker.name ?? "—" }, { label: "GSTIN", value: job.jobWorker.gstin ?? "Unregistered" },
        { label: "Job", value: job.natureOfJob ?? "—" }, { label: "Vehicle", value: job.vehicleNumber ?? "—" },
      ]} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left">
          <thead><tr className="border-b border-border"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Description</th><th className="py-1 pr-2">HSN</th><th className="py-1 pr-2 text-right">Quantity</th><th className="py-1 text-right">Value</th></tr></thead>
          <tbody>
            {(job.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-border"><td className="py-1 pr-2">{line.sequence}</td><td className="py-1 pr-2">{line.description}</td><td className="py-1 pr-2">{line.hsnSacCode ?? ""}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{`${quantity(String(line.quantity))} ${line.unit ?? ""}`}</td><td className="py-1 text-right tabular-nums">{inr(line.value)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4} className="py-1 pr-2 text-right font-medium">Total</td><td className="py-1 text-right font-medium tabular-nums">{inr(job.totalValue)}</td></tr></tfoot>
        </table>
      </div>
      <p className="text-text-secondary">{job.goodsKind === "capital_goods" ? "Capital goods: to be returned within three years." : "Inputs: to be returned within one year."} Due back by {job.dueDate ? calendarDate(job.dueDate) : "—"}.</p>
      <div className="mt-8 flex justify-between gap-4"><span>Received by (job worker)</span><span>For the sender</span></div>
    </div>
  );
}
