"use client";

// Quality — Incoming, In-Process, Final and Pre-Dispatch Inspection (one inspection engine, four sources). The workspace (overview with the
// dashboard figures and action queues, every work queue with its count, exceptions, the reports), one inspection (overview, samples & checks —
// the inspector's recording screen —, findings, review & decision with the authorized disposition, the authoritative inventory, production or
// delivery status, rework, nonconformances, documents, activity), and the Quality home's panels. Completing an inspection never releases stock,
// production or a delivery: the disposition decides, Inventory, Manufacturing or Sales carries it out.
import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, MetricStrip, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { InspectionRejectionsPanel } from "@/features/procurement/purchase-orders/screens/RejectionScreens";
import { formatDateTime } from "@/shared/format/human";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { act, readView } from "../shared/client";
import { dateLabel, errorMessage, errorStatus, newKey } from "../specifications/spec-api";
import {
  CHECKPOINT_LABEL, DISPOSITION_LABEL, OUTCOME_LABEL, OUTCOME_TONE, STATUS_TONE, apiFor, num,
  type Characteristic, type Counts, type Dashboard, type Detail, type DispatchDashboard, type FinalDashboard, type InProcessDashboard, type InspectionApi, type Kind, type Observation, type Options, type Row,
} from "./incoming-api";

// The kind of inspection a screen shows: its client, routes, query keys and wording.
const KindContext = createContext<Kind>("incoming");
const useApi = (): InspectionApi => apiFor(useContext(KindContext));
const isProduction = (A: InspectionApi) => A.kind === "in_process" || A.kind === "final";
const isFinalKind = (A: InspectionApi) => A.kind === "final";
const isDispatch = (A: InspectionApi) => A.kind === "pre_dispatch";
function Denied({ error, what }: { error: unknown; what: string }) {
  const A = useApi();
  return errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description={`It needs the ${A.noun} view permission.`} />
    : <Notice tone="danger">{errorMessage(error)}</Notice>;
}
const useRefresh = () => {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality", A.key) });
};
function useOptions(enabled = true) {
  const A = useApi();
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "options"), queryFn: A.options, retry: false, enabled, staleTime: 60_000 });
}
const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { URGENT: "danger", HIGH: "warning", NORMAL: "neutral", LOW: "neutral" };
const priorityLabel = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();
const outcomeBadge = (proposed: string | null, critical = false) => proposed
  ? <StatusBadge tone={OUTCOME_TONE[proposed] ?? "neutral"}>{`${OUTCOME_LABEL[proposed] ?? proposed}${critical ? " · critical" : ""}`}</StatusBadge> : null;

// ------------------------------------------------------------------ the workspace
const viewsOf = (production: boolean): Array<{ id: string; label: string; count?: keyof Counts }> => [{ id: "overview", label: "Overview" },
  { id: "awaiting", label: "Awaiting Inspection", count: "awaiting" }, { id: "mine", label: "Assigned to Me", count: "mine" }, { id: "in_progress", label: "In Progress", count: "in_progress" },
  { id: "review", label: "Awaiting Review", count: "review" }, { id: "disposition", label: "Awaiting Disposition", count: "disposition" },
  { id: "reinspection", label: production ? "Rework / Reinspection" : "Reinspection", count: "reinspection" }, { id: "overdue", label: "Overdue", count: "overdue" },
  { id: "completed", label: "Completed" }, { id: "cancelled", label: "Cancelled" }, { id: "exceptions", label: "Exceptions", count: "exceptions" }, { id: "reports", label: "Reports" }];

export function IncomingWorkspaceScreen() {
  return <KindContext.Provider value="incoming"><Workspace /></KindContext.Provider>;
}
export function InProcessWorkspaceScreen() {
  return <KindContext.Provider value="in_process"><Workspace /></KindContext.Provider>;
}
export function FinalWorkspaceScreen() {
  return <KindContext.Provider value="final"><Workspace /></KindContext.Provider>;
}
export function DispatchWorkspaceScreen() {
  return <KindContext.Provider value="pre_dispatch"><Workspace /></KindContext.Provider>;
}
function Workspace() {
  const A = useApi();
  const production = isProduction(A);
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const counts = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "counts"), queryFn: A.counts, retry: false });
  const options = useOptions(!counts.isError);
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  if (counts.isError) return <Denied error={counts.error} what={A.title.toLowerCase()} />;
  const c = counts.data;
  const open = (id: string) => router.replace(`${A.base}/${id}`);
  const dispatch = isDispatch(A);
  const manual = dispatch ? options.data?.canCreate && (options.data.deliveryLines?.length ?? 0) > 0
    : production ? options.data?.canCreate && (options.data.entries?.length ?? 0) > 0 : (options.data?.receiptLines?.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={A.title} description={dispatch
        ? "Goods picked for a customer delivery checked before they leave. Each inspection is bound to its delivery line, sales order and the exact specification version; the line is dispatched only as far as Quality's authorized decision allows."
        : isFinalKind(A)
        ? "Finished output checked before it becomes finished goods. Each inspection is bound to its Manufacturing Order, lot and reported output and the exact specification version; output is accepted and received into stock only as far as Quality's authorized decision allows."
        : production
        ? "Production output checked while it is made. Each inspection is bound to its Manufacturing Order, run, reported output and the exact specification version; output goes on only as far as Quality's authorized decision allows."
        : "Supplier goods inspected before they can be used. Each inspection is bound to its goods receipt line and the exact specification version; the held stock is released only by Quality's authorized decision."}
        primaryAction={manual ? <Button variant="primary" onPress={() => setAsk(dispatch ? manualDispatchAsk(A, options.data!, open) : production ? manualProductionAsk(A, options.data!, open) : manualReceiptAsk(A, options.data!, open))}>
          {dispatch ? "Request pre-dispatch inspection" : isFinalKind(A) ? "Request final inspection" : production ? "Request inspection" : "New manual inspection"}</Button> : undefined} />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label={`${A.title} views`}>{viewsOf(production).map((v) => <Tab key={v.id} id={v.id}>{v.count && c ? `${v.label} (${c[v.count] ?? 0})` : v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" ? (dispatch ? <DispatchOverview onSelect={select} /> : isFinalKind(A) ? <FinalOverview onSelect={select} /> : production ? <ProductionOverview onSelect={select} /> : <ReceivingOverview onSelect={select} />)
        : view === "exceptions" ? <ExceptionsPanel /> : view === "reports" ? <ReportsPanel /> : <QueuePanel view={view} key={view} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function manualReceiptAsk(A: InspectionApi, o: Options, onDone: (id: string) => void): Ask {
  const lines = o.receiptLines ?? [];
  return { title: "New manual incoming inspection", confirm: "Create inspection",
    description: "For goods a control point did not send to Quality (a complaint, a supplier under watch). The specification in force for the item and supplier is bound to it; it does not hold stock by itself.",
    fields: [{ name: "goodsReceiptLineId", label: "Goods receipt line", kind: "select", required: true, options: lines },
      { name: "quantity", label: "Quantity to inspect", kind: "quantity", description: "Leave empty for the whole received line." },
      { name: "priority", label: "Priority", kind: "select", initial: "NORMAL", options: o.priorities }, { name: "reason", label: "Why is it inspected?", kind: "textarea", required: true }],
    run: async (v, key) => {
      const line = lines.find((l) => l.value === v.goodsReceiptLineId);
      const r = await A.create({ ...v, quantity: v.quantity || String(line?.quantity ?? ""), idempotencyKey: key });
      onDone(r.id);
    } };
}
function manualProductionAsk(A: InspectionApi, o: Options, onDone: (id: string) => void): Ask {
  const final = isFinalKind(A);
  return { title: final ? "Request a final inspection" : "Request an in-process inspection", confirm: "Request inspection",
    description: final ? "For finished output a control point did not send to Quality (a complaint, a suspected defect). It is bound to the final specification in force for the product; it does not hold stock by itself."
      : "For output a control point did not send to Quality (suspected tool wear, a setup change). It is bound to the specification in force for the product; it does not stop production by itself.",
    fields: [{ name: "productionEntryId", label: "Reported output", kind: "select", required: true, options: o.entries ?? [] },
      { name: "quantity", label: "Quantity to inspect", kind: "quantity", description: "Leave empty for the whole reported output." },
      ...(final ? [] : [{ name: "operationLabel", label: "Operation", kind: "text" as const, description: "For example: Drilling (Op 20)" }]),
      { name: "priority", label: "Priority", kind: "select", initial: "NORMAL", options: o.priorities }, { name: "reason", label: "Why is it inspected?", kind: "textarea", required: true }],
    run: async (v, key) => { const r = await A.create({ ...v, quantity: v.quantity || undefined, idempotencyKey: key }); onDone(r.id); } };
}
function manualDispatchAsk(A: InspectionApi, o: Options, onDone: (id: string) => void): Ask {
  return { title: "Request a pre-dispatch inspection", confirm: "Request inspection",
    description: "For a delivery a control point did not send to Quality (a sensitive customer, a complaint). It is bound to the pre-dispatch specification in force for the item; it does not hold the delivery by itself.",
    fields: [{ name: "deliveryLineId", label: "Delivery line", kind: "select", required: true, options: o.deliveryLines ?? [] },
      { name: "quantity", label: "Quantity to inspect", kind: "quantity", description: "Leave empty for the whole delivery line." },
      { name: "priority", label: "Priority", kind: "select", initial: "NORMAL", options: o.priorities }, { name: "reason", label: "Why is it inspected?", kind: "textarea", required: true }],
    run: async (v, key) => { const r = await A.create({ ...v, quantity: v.quantity || undefined, idempotencyKey: key }); onDone(r.id); } };
}
function DispatchOverview({ onSelect }: { onSelect: (view: string) => void }) {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<DispatchDashboard>(), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the overview" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="the overview" />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <MetricStrip metrics={[{ label: "Awaiting inspection", value: num(d.counts.awaiting) }, { label: "Overdue", value: num(d.counts.overdue) },
        { label: "Deliveries held by Quality", value: `${num(d.deliveriesBlocked)} (${num(d.heldQuantity)} units)` }, { label: "Awaiting review", value: num(d.counts.review) },
        { label: "Awaiting disposition", value: num(d.counts.disposition) }, { label: "Rejected units", value: num(d.rejectedQuantity) },
        { label: "Rejections not yet on hold", value: num(d.rejectedNotHeld) }, { label: "Failed (90 days)", value: num(d.failed90) }]} />
      <Panel title="Deliveries held by Quality" description="Each delivery line and the exact requirement holding it. It is dispatched only as far as Quality clears it.">
        <LinesTable columns={["Delivery", "Line", "Requirement", { label: "Held", numeric: true }, "Inspection"]} empty={d.blocked.length ? undefined : "Nothing is held."}>
          {d.blocked.map((b, i) => <tr key={i}><Cell><Link className="text-brand hover:underline" href={`/sales/deliveries/${b.deliveryId}`}>{b.delivery}</Link></Cell><Cell>{b.label}</Cell>
            <Cell>{b.requirement}{b.exception && <span className="block text-xs text-danger">{b.exception === "RULE_CONFLICT" ? "Conflicting control points" : "No approved specification"}</span>}</Cell>
            <Cell numeric>{num(b.held)}</Cell>
            <Cell>{b.inspection ? <Link className="text-brand hover:underline" href={b.href}>{`${b.inspection.number} · ${b.inspection.status}`}</Link> : <Link className="text-brand hover:underline" href={b.href}>Resolve the exception</Link>}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <QueueTriad onSelect={onSelect} />
      <p className="text-xs text-text-muted">Figures are counted from the inspections, Sales&apos; deliveries, Inventory&apos;s hold cases and the Quality requirements themselves.</p>
    </div>
  );
}
function ReceivingOverview({ onSelect }: { onSelect: (view: string) => void }) {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<Dashboard>(), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the overview" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="the overview" />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <MetricStrip metrics={[{ label: "Pending inspections", value: num(d.counts.awaiting) }, { label: "Overdue", value: num(d.counts.overdue) },
        { label: "Receipts held for Quality", value: `${num(d.receiptsHeld)} (${num(d.quantityHeld)} units)` }, { label: "Awaiting review", value: num(d.counts.review) },
        { label: "Lots awaiting disposition", value: num(d.counts.disposition) }, { label: "Failed (90 days)", value: num(d.failed90) },
        { label: "Reinspection required", value: num(d.counts.reinspection) }, { label: "Average completion", value: d.averageHours === null ? "—" : `${d.averageHours} h` }]} />
      <QueueTriad onSelect={onSelect} />
      <p className="text-xs text-text-muted">Figures are counted from the inspections, goods receipts and Inventory holds themselves; nothing here is a separately edited total.</p>
    </div>
  );
}
function ProductionOverview({ onSelect }: { onSelect: (view: string) => void }) {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<InProcessDashboard>(), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the overview" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="the overview" />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <MetricStrip metrics={[{ label: "Pending inspections", value: num(d.counts.awaiting) }, { label: "Overdue", value: num(d.counts.overdue) },
        { label: "Production blocked by Quality", value: num(d.blockedOperations) }, { label: "WIP on Quality hold", value: `${num(d.wipOnHold)} units` },
        { label: "Awaiting review", value: num(d.counts.review) }, { label: "Awaiting disposition", value: num(d.counts.disposition) },
        { label: "Rework required", value: num(d.reworkRequired) }, { label: "Failed (90 days)", value: num(d.failed90) }]} />
      <Panel title="Production blocked by Quality" description="Each restriction and the exact requirement causing it. Output goes on only once Quality clears it.">
        <LinesTable columns={["Production order", "Output", "Requirement", "Restriction", { label: "Held", numeric: true }, "Inspection"]} empty={d.blocked.length ? undefined : "Nothing is blocked."}>
          {d.blocked.map((b, i) => <tr key={i}><Cell>{b.order}</Cell><Cell>{b.label}</Cell><Cell>{b.requirement}{b.exception && <span className="block text-xs text-danger">{b.exception === "RULE_CONFLICT" ? "Conflicting control points" : "No approved specification"}</span>}</Cell>
            <Cell>{b.scope}</Cell><Cell numeric>{num(b.held)}</Cell>
            <Cell>{b.inspection ? <Link className="text-brand hover:underline" href={b.href}>{`${b.inspection.number} · ${b.inspection.status}`}</Link> : <Link className="text-brand hover:underline" href={b.href}>Resolve the exception</Link>}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.pendingByOrder.length > 0 && <Panel title="Inspections pending by production order">
        <ul className="flex flex-wrap gap-3 text-sm">{d.pendingByOrder.map((o) => <li key={o.id} className="rounded-md border border-border px-3 py-2"><span className="font-medium">{o.number}</span>
          <span className="ml-2 text-text-muted">{`${o.pending} pending`}</span></li>)}</ul>
      </Panel>}
      <QueueTriad onSelect={onSelect} />
      <p className="text-xs text-text-muted">Figures are counted from the inspections, Manufacturing&apos;s production records and the Quality requirements themselves. Sample failures and lot quantities are different measures.</p>
    </div>
  );
}
function FinalOverview({ onSelect }: { onSelect: (view: string) => void }) {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<FinalDashboard>(), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the overview" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="the overview" />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <MetricStrip metrics={[{ label: "Awaiting inspection", value: num(d.counts.awaiting) }, { label: "Awaiting review", value: num(d.counts.review) },
        { label: "Lots held from finished goods", value: `${num(d.lotsOnHold)} (${num(d.heldQuantity)} units)` }, { label: "Awaiting disposition", value: num(d.counts.disposition) },
        { label: "Cleared, not yet accepted", value: num(d.awaitingAcceptance) }, { label: "Rework / reinspection", value: num(d.counts.reinspection) },
        { label: "Failed (90 days)", value: num(d.failed90) }, { label: "Average completion", value: d.averageHours === null ? "—" : `${d.averageHours} h` }]} />
      <Panel title="Finished output held by Quality" description="Each lot and the exact requirement holding it. Nothing here can be accepted, received or dispatched until Quality clears it.">
        <LinesTable columns={["Production order", "Output", "Requirement", { label: "Held", numeric: true }, "Inspection"]} empty={d.blocked.length ? undefined : "Nothing is held."}>
          {d.blocked.map((b, i) => <tr key={i}><Cell>{b.order}</Cell><Cell>{b.label}</Cell><Cell>{b.requirement}{b.exception && <span className="block text-xs text-danger">{b.exception === "RULE_CONFLICT" ? "Conflicting control points" : "No approved specification"}</span>}</Cell>
            <Cell numeric>{num(b.held)}</Cell>
            <Cell>{b.inspection ? <Link className="text-brand hover:underline" href={b.href}>{`${b.inspection.number} · ${b.inspection.status}`}</Link> : <Link className="text-brand hover:underline" href={b.href}>Resolve the exception</Link>}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.lots.length > 0 && <Panel title="Inspection progress">
        <ul className="flex flex-col gap-2 text-sm">{d.lots.map((l) => <li key={l.id}><Link className="font-medium text-brand hover:underline" href={`${A.base}/${l.id}`}>{l.number}</Link>
          <span className="ml-2 text-text-muted">{[l.item, l.lot ? `Lot ${l.lot}` : null, l.order, l.status].filter(Boolean).join(" · ")}</span></li>)}</ul>
      </Panel>}
      <QueueTriad onSelect={onSelect} />
      <p className="text-xs text-text-muted">Figures are counted from the inspections, Manufacturing&apos;s production and acceptance records and the Quality requirements themselves.</p>
    </div>
  );
}
function QueueTriad({ onSelect }: { onSelect: (view: string) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <QueuePanel view="awaiting" compact title="Awaiting inspection" onMore={() => onSelect("awaiting")} />
      <QueuePanel view="review" compact title="Awaiting review" onMore={() => onSelect("review")} />
      <QueuePanel view="disposition" compact title="Awaiting disposition" onMore={() => onSelect("disposition")} />
    </div>
  );
}
function QueuePanel({ view, compact, title, onMore }: { view: string; compact?: boolean; title?: string; onMore?: () => void }) {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "list", view, search, from, to), queryFn: () => A.list(view, search, from, to), retry: false });
  if (q.isLoading) return <LoadingState label="Loading inspections" rows={compact ? 2 : 4} />;
  if (q.isError) return <Denied error={q.error} what={A.title.toLowerCase()} />;
  const rows = q.data!.rows;
  if (compact) {
    return (
      <Panel title={title ?? ""} actions={rows.length > 5 && onMore ? <Button size="compact" variant="ghost" onPress={onMore}>{`All ${rows.length}`}</Button> : undefined}>
        {rows.length ? <ul className="flex flex-col gap-2 text-sm">{rows.slice(0, 5).map((r) => <li key={r.id}><Link className="font-medium text-brand hover:underline" href={`${A.base}/${r.id}`}>{r.number}</Link>
          <span className="block text-xs text-text-muted">{[r.item?.name, r.production ? `${r.production.order}${r.production.operation ? ` · ${r.production.operation}` : ""}` : r.supplier,
            r.delivery ? `${r.delivery.number}${r.delivery.customer ? ` · ${r.delivery.customer}` : ""}` : null,
            `${num(r.quantity)} ${r.unit ?? ""}`.trim(), r.dueAt ? `due ${dateLabel(r.dueAt)}` : null].filter(Boolean).join(" · ")}</span></li>)}</ul>
          : <p className="text-sm text-text-muted">Nothing waiting.</p>}
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Search" value={search} onChange={setSearch} description={isDispatch(A) ? "Inspection, delivery, sales order, customer or item"
          : isProduction(A) ? "Inspection, production order, output, operation or item" : "Inspection, receipt, item or supplier"} />
        <TextField label="Created from" type="date" value={from} onChange={setFrom} />
        <TextField label="to" type="date" value={to} onChange={setTo} />
      </div>
      <InspectionTable rows={rows} />
    </div>
  );
}
function InspectionTable({ rows }: { rows: Row[] }) {
  const A = useApi();
  const production = isProduction(A);
  if (isDispatch(A)) return <DispatchTable rows={rows} />;
  return (
    <LinesTable columns={["Inspection", production ? "Production order" : "Receipt", "Item", production ? "Operation / run" : "Supplier", { label: "Quantity", numeric: true }, "Inspector", "Priority / due", "Status", "Result", "Decision"]}
      empty={rows.length ? undefined : "No inspections here."}>
      {rows.map((r) => (
        <tr key={r.id}>
          <Cell><Link className="font-medium text-brand hover:underline" href={`${A.base}/${r.id}`}>{r.number}</Link>
            {r.reinspectionOf && <span className="block text-xs text-text-muted">{`${r.production?.checkpoint === "REWORK" ? "After rework of" : "Reinspection of"} ${r.reinspectionOf.number}`}</span>}</Cell>
          {production
            ? <Cell>{r.production ? r.production.order : "—"}{r.production?.entry && <span className="block text-xs text-text-muted">{r.production.entry}</span>}</Cell>
            : <Cell>{r.receipt ? `${r.receipt.number}${r.receipt.line ? ` / ${r.receipt.line}` : ""}` : "—"}{r.purchaseOrder && <span className="block text-xs text-text-muted">{r.purchaseOrder.number}</span>}</Cell>}
          <Cell>{r.item ? `${r.item.code} · ${r.item.name}` : "—"}{r.batch && <span className="block text-xs text-text-muted">{`Batch ${r.batch}`}</span>}</Cell>
          {production
            ? <Cell>{r.production?.operation ?? "—"}<span className="block text-xs text-text-muted">{[r.production?.run ? `Run ${r.production.run}` : null, r.production ? CHECKPOINT_LABEL[r.production.checkpoint] : null].filter(Boolean).join(" · ")}</span>
              {r.production?.reworkPending && <span className="block text-xs text-warning">Waiting for rework</span>}</Cell>
            : <Cell>{r.supplier ?? "—"}</Cell>}
          <Cell numeric>{`${num(r.quantity)} ${r.unit ?? ""}`}</Cell><Cell>{r.inspector?.name ?? "Unassigned"}</Cell>
          <Cell><StatusBadge tone={PRIORITY_TONE[r.priority] ?? "neutral"}>{priorityLabel(r.priority)}</StatusBadge>
            {r.dueAt && <span className={`block text-xs ${r.overdue ? "text-danger" : "text-text-muted"}`}>{`${r.overdue ? "Overdue · " : ""}${dateLabel(r.dueAt)}`}</span>}</Cell>
          <Cell><StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge>{r.sourceReversed && <span className="block text-xs text-danger">Receipt reversed</span>}</Cell>
          <Cell>{outcomeBadge(r.proposed, r.criticalFailure) ?? "—"}</Cell>
          <Cell>{r.disposition === "NONE" ? "—" : `${DISPOSITION_LABEL[r.disposition]}${r.accepted !== null ? ` · ${num(r.accepted)} accepted` : ""}${r.rejected ? ` · ${num(r.rejected)} rejected` : ""}`}</Cell>
        </tr>))}
    </LinesTable>
  );
}
function DispatchTable({ rows }: { rows: Row[] }) {
  const A = useApi();
  return (
    <LinesTable columns={["Inspection", "Delivery", "Item", "Customer", { label: "Quantity", numeric: true }, "Inspector", "Priority / due", "Status", "Result", "Decision"]}
      empty={rows.length ? undefined : "No inspections here."}>
      {rows.map((r) => (
        <tr key={r.id}>
          <Cell><Link className="font-medium text-brand hover:underline" href={`${A.base}/${r.id}`}>{r.number}</Link>
            {r.reinspectionOf && <span className="block text-xs text-text-muted">{`Reinspection of ${r.reinspectionOf.number}`}</span>}</Cell>
          <Cell>{r.delivery ? r.delivery.number : "—"}{r.delivery && <span className="block text-xs text-text-muted">{r.delivery.order}</span>}</Cell>
          <Cell>{r.item ? `${r.item.code} · ${r.item.name}` : "—"}</Cell><Cell>{r.delivery?.customer ?? "—"}</Cell>
          <Cell numeric>{`${num(r.quantity)} ${r.unit ?? ""}`}</Cell><Cell>{r.inspector?.name ?? "Unassigned"}</Cell>
          <Cell><StatusBadge tone={PRIORITY_TONE[r.priority] ?? "neutral"}>{priorityLabel(r.priority)}</StatusBadge>
            {r.dueAt && <span className={`block text-xs ${r.overdue ? "text-danger" : "text-text-muted"}`}>{`${r.overdue ? "Overdue · " : ""}${dateLabel(r.dueAt)}`}</span>}</Cell>
          <Cell><StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge></Cell>
          <Cell>{outcomeBadge(r.proposed, r.criticalFailure) ?? "—"}</Cell>
          <Cell>{r.disposition === "NONE" ? "—" : `${DISPOSITION_LABEL[r.disposition]}${r.accepted !== null ? ` · ${num(r.accepted)} cleared` : ""}${r.rejected ? ` · ${num(r.rejected)} rejected` : ""}`}</Cell>
        </tr>))}
    </LinesTable>
  );
}
const EXCEPTION_LABEL: Record<string, string> = { CONFLICT: "Control point conflict", SPEC_MISSING: "Missing standard", SOURCE_REVERSED: "Receipt reversed", RECOVERY: "Needs recovery",
  AWAITING_RELEASE: "Cleared, not released", REWORK_OVERDUE: "Rework not confirmed", SCRAP_PENDING: "Scrap not recorded", REJECTED_NOT_HELD: "Rejected, not on hold" };
function ExceptionsPanel() {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "exceptions"), queryFn: A.exceptions, retry: false });
  if (q.isLoading) return <LoadingState label="Checking for exceptions" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="exceptions" />;
  return (
    <Panel title="Exceptions" description={isDispatch(A)
      ? "Delivery lines held without an inspection Quality can work, and rejected units Inventory has not yet put on a quality hold."
      : isProduction(A)
      ? "Production output held without an inspection Quality can work, rework production has not confirmed after two days, and scrap Manufacturing has not recorded."
      : "Goods held without an inspection Quality can work, inspections whose receipt changed, and stock Quality cleared that Inventory has not released after two days."}>
      <LinesTable columns={["Exception", "What", "Since"]} empty={q.data!.length ? undefined : "No exceptions."}>
        {q.data!.map((x, i) => <tr key={i}><Cell><StatusBadge tone={["AWAITING_RELEASE", "REWORK_OVERDUE", "SCRAP_PENDING", "REJECTED_NOT_HELD"].includes(x.kind) ? "warning" : "danger"}>{EXCEPTION_LABEL[x.kind] ?? x.kind}</StatusBadge></Cell>
          <Cell><Link className="text-brand hover:underline" href={x.href}>{x.label}</Link></Cell><Cell>{formatDateTime(x.at)}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
function ReportsPanel() {
  const A = useApi();
  const workspace = useWorkspaceContext();
  const options = useOptions();
  const [kind, setKind] = useState("register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "report", kind, from, to), queryFn: () => A.report(kind, from, to), retry: false });
  const columns = q.data ? [...new Set(q.data.rows.flatMap((r) => Object.keys(r)))] : [];
  const show = (v: unknown, c: string) => (v === null || v === undefined || v === "" ? "—" : /(_at|^due)$/.test(c) ? formatDateTime(String(v)) : typeof v === "number" ? num(v) : String(v));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Report" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={options.data?.reports ?? [{ value: "register", label: `${A.title} register` }]} />
        <TextField label="From" type="date" value={from} onChange={setFrom} /><TextField label="To" type="date" value={to} onChange={setTo} />
        <a className="self-center text-sm text-brand hover:underline" href={A.csvHref(kind, from, to)}>Export CSV</a>
      </div>
      {["pass_rate", "failed_characteristics", "rework", "scrap"].includes(kind) && <p className="text-xs text-text-muted">Sample-level failures (failed observations), lot-level quantities (decided by disposition), rework and actual scrap are separate measures: a failed sample does not mean the whole lot is defective.</p>}
      {q.isLoading ? <LoadingState label="Preparing the report" rows={3} /> : q.isError ? <Denied error={q.error} what="this report" /> : (
        <LinesTable columns={columns.map((c) => c.replace(/_/g, " "))} empty={q.data!.rows.length ? undefined : "Nothing to report."}>
          {q.data!.rows.map((r, i) => <tr key={i}>{columns.map((c) => <Cell key={c}>{show(r[c], c)}</Cell>)}</tr>)}
        </LinesTable>)}
    </div>
  );
}

// ------------------------------------------------------------------ one inspection
const tabsOf = (production: boolean, final = false, dispatch = false) => dispatch
  ? [{ id: "overview", label: "Overview" }, { id: "samples", label: "Samples & Checks" }, { id: "findings", label: "Findings" }, { id: "decision", label: "Review & Disposition" },
    { id: "delivery", label: "Delivery Status" }, { id: "nonconformance", label: "Nonconformance" }, { id: "documents", label: "Documents" }, { id: "activity", label: "Activity & Audit" }]
  : final
  ? [{ id: "overview", label: "Overview" }, { id: "samples", label: "Samples & Checks" }, { id: "findings", label: "Findings" }, { id: "decision", label: "Review & Disposition" },
    { id: "wip", label: "Finished-Goods Status" }, { id: "rework", label: "Rework & Reinspection" }, { id: "nonconformance", label: "Nonconformance" }, { id: "documents", label: "Documents" },
    { id: "activity", label: "Activity & Audit" }]
  : production
  ? [{ id: "overview", label: "Overview" }, { id: "samples", label: "Samples & Measurements" }, { id: "findings", label: "Findings" }, { id: "decision", label: "Review & Disposition" },
    { id: "wip", label: "WIP & Operation Status" }, { id: "rework", label: "Rework" }, { id: "nonconformance", label: "Nonconformance" }, { id: "documents", label: "Documents" },
    { id: "activity", label: "Activity & Audit" }]
  : [{ id: "overview", label: "Overview" }, { id: "samples", label: "Samples & Checks" }, { id: "findings", label: "Findings" }, { id: "decision", label: "Review & Decision" },
    { id: "inventory", label: "Inventory Status" }, { id: "nonconformance", label: "Nonconformance" }, { id: "documents", label: "Documents" }, { id: "activity", label: "Activity & Audit" }];
type Run = (action: string, body?: Record<string, unknown>) => Promise<unknown>;

export function IncomingDetailScreen({ id }: { id: string }) {
  return <KindContext.Provider value="incoming"><InspectionDetail id={id} /></KindContext.Provider>;
}
export function InProcessDetailScreen({ id }: { id: string }) {
  return <KindContext.Provider value="in_process"><InspectionDetail id={id} /></KindContext.Provider>;
}
export function FinalDetailScreen({ id }: { id: string }) {
  return <KindContext.Provider value="final"><InspectionDetail id={id} /></KindContext.Provider>;
}
export function DispatchDetailScreen({ id }: { id: string }) {
  return <KindContext.Provider value="pre_dispatch"><InspectionDetail id={id} /></KindContext.Provider>;
}
function InspectionDetail({ id }: { id: string }) {
  const A = useApi();
  const production = isProduction(A);
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const refresh = useRefresh();
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "detail", id), queryFn: () => A.get(id), retry: false });
  const options = useOptions(Boolean(q.data?.actions.assign));
  if (q.isLoading) return <LoadingState label="Loading the inspection" rows={5} />;
  if (q.isError) return <Denied error={q.error} what="this inspection" />;
  const d = q.data!;
  const go = (next: string) => { setTab(next); router.replace(`${pathname}?tab=${next}`, { scroll: false }); };
  const run: Run = async (action, body = {}) => {
    setFailure(null);
    try { const r = await A.action(id, action, { version: d.rowVersion, ...body }); await refresh(); return r; }
    catch (error) { setFailure(errorMessage(error)); await refresh(); throw error; }
  };
  const reworkPending = Boolean(d.production?.reworkPending);
  const actions: ReactNode[] = [];
  if (d.actions.confirmRework) actions.push(<Button key="rework" variant="primary" onPress={() => setAsk({ title: "Confirm the rework", confirm: "Confirm rework",
    description: `The disposition asked for: ${d.production?.reworkInstruction ?? "rework"}. Confirm what production did, so Quality can reinspect the reworked units.`,
    fields: [{ name: "reference", label: "Rework carried out (instruction, order or note)", kind: "text", required: true }, { name: "note", label: "Note", kind: "textarea" }],
    run: async (x) => { await run("confirm-rework", x); } })}>Confirm rework</Button>);
  if (d.actions.start && !reworkPending) actions.push(<Button key="start" variant="primary" onPress={() => d.version?.method === "MANUAL_APPROVED_COUNT"
    ? setAsk({ title: "Approve the sample count", confirm: "Start", description: `This specification asks a reviewer to approve how many of the ${num(d.quantity)} units to inspect.`,
      fields: [{ name: "approvedSampleCount", label: "Units to inspect", kind: "quantity", required: true }], run: async (x) => { await run("start", x); go("samples"); } })
    : run("start").then(() => go("samples")).catch(() => undefined)}>Start inspection</Button>);
  if (d.actions.submit && d.samples.length) actions.push(<Button key="submit" variant="primary" onPress={() => setAsk({ title: "Submit the results", confirm: "Submit",
    description: d.evaluation?.proposed === "PASS" ? `Every check passed. Unless your company reviews every inspection, the evidence is completed now; the ${production ? "output" : "stock"} still waits for Quality's decision.`
      : "The results go to a Quality reviewer.", fields: [{ name: "note", label: "Note for the reviewer", kind: "textarea" }], run: async (x) => { await run("submit", x); } })}>Submit results</Button>);
  if (d.actions.review) {
    actions.push(<Button key="approve" variant="primary" onPress={() => setAsk({ title: "Approve the results", confirm: "Approve", description: "Approving completes the evidence. Nothing more is recorded on it; corrections are made with a reason.",
      fields: [...(d.evaluation?.proposed === "REVIEW_REQUIRED" ? [{ name: "outcome", label: "Your judgement", kind: "select" as const, required: true, options: [{ value: "PASS", label: "Pass" }, { value: "FAIL", label: "Fail" }] }] : []),
        { name: "note", label: "Review note", kind: "textarea" }], run: async (x) => { await run("review", { ...x, decision: "APPROVE" }); } })}>Approve results</Button>,
    <Button key="changes" variant="secondary" onPress={() => setAsk({ title: "Send back for changes", confirm: "Send back", fields: [{ name: "note", label: "What should be corrected?", kind: "textarea", required: true }],
      run: async (x) => { await run("review", { ...x, decision: "REQUEST_CHANGES" }); } })}>Request changes</Button>);
  }
  if (d.actions.decide) actions.push(<Button key="decide" variant="primary" onPress={() => setDeciding(true)}>Decide disposition</Button>);
  if (d.actions.assign && options.data) actions.push(<Button key="assign" variant="secondary" onPress={() => setAsk({ title: d.inspector ? "Reassign the inspection" : "Assign an inspector", confirm: "Save",
    fields: [{ name: "inspectorId", label: "Inspector", kind: "select", required: true, initial: d.inspector?.id ?? "", options: options.data!.inspectors },
      { name: "priority", label: "Priority", kind: "select", initial: d.priority, options: options.data!.priorities }, { name: "dueAt", label: "Due", kind: "date", initial: d.dueAt ? d.dueAt.slice(0, 10) : "" }],
    run: async (x) => { await run("assign", { ...x, dueAt: x.dueAt || undefined }); } })}>{d.inspector ? "Reassign" : "Assign"}</Button>);
  if (d.actions.cancel) actions.push(<Button key="cancel" variant="danger" onPress={() => setAsk({ title: "Cancel the inspection", confirm: "Cancel inspection", tone: "danger",
    description: `Only an inspection without a decision is cancelled. Its history stays; ${isDispatch(A) ? "a blocking check keeps the delivery line held" : production ? "the output stays restricted" : "held stock stays held"} until Quality decides another way.`,
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (x) => { await run("cancel", x); } })}>Cancel</Button>);
  const subtitle = isDispatch(A)
    ? [d.delivery?.number, d.delivery?.order, d.delivery?.customer, `${num(d.quantity)} ${d.unit ?? ""}`.trim(), d.version ? `${d.version.code} v${d.version.number}` : null]
    : production
    ? [d.production?.order, d.production?.entry, d.production?.run ? `${isFinalKind(A) ? "lot" : "run"} ${d.production.run}` : null, d.production?.operation, `${num(d.quantity)} ${d.unit ?? ""}`.trim(),
      d.version ? `${d.version.code} v${d.version.number}` : null]
    : [d.supplier, d.receipt ? `Receipt ${d.receipt.number}${d.receipt.line ? ` line ${d.receipt.line}` : ""}` : null, `${num(d.quantity)} ${d.unit ?? ""}`.trim(), d.version ? `${d.version.code} v${d.version.number}` : null];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${d.number} · ${d.item ? d.item.name : A.noun}`} description={subtitle.filter(Boolean).join(" · ")} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.statusLabel}</StatusBadge>{outcomeBadge(d.proposed, d.criticalFailure)}
        <StatusBadge tone={d.disposition === "DECIDED" ? "success" : d.disposition === "PARTIAL" ? "warning" : "neutral"}>{DISPOSITION_LABEL[d.disposition] ?? d.disposition}</StatusBadge>
        {d.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
        {d.production && <StatusBadge tone="info">{CHECKPOINT_LABEL[d.production.checkpoint] ?? d.production.checkpoint}</StatusBadge>}
        {d.reinspectionOf && <Link className="text-sm text-brand hover:underline" href={`${A.base}/${d.reinspectionOf.id}`}>{`${d.production?.checkpoint === "REWORK" ? "After rework of" : "Reinspection of"} ${d.reinspectionOf.number}`}</Link>}
        <span className="ml-auto flex flex-wrap gap-2">{actions}</span>
      </div>
      {failure && <Notice tone="danger">{failure}</Notice>}
      {reworkPending && <Notice tone="warning">{`Waiting for rework: ${d.production?.reworkInstruction ?? ""}. Production confirms the rework before this reinspection starts.`}</Notice>}
      {d.sourceReversed && <Notice tone="warning">The goods receipt was reversed. Nothing is left to decide; the inspection and its evidence are kept.</Notice>}
      {d.status === "CHANGES_REQUESTED" && <Notice tone="warning">{`Sent back by the reviewer: ${d.reviews.filter((r) => r.action === "CHANGES_REQUESTED").at(-1)?.note ?? ""}`}</Notice>}
      {d.status === "COMPLETED" && d.disposition !== "DECIDED" && !d.sourceReversed && <Notice tone="info">{`The evidence is complete. ${num(d.totals.undecided)} of ${num(d.quantity)} still await Quality's disposition — until then the ${isDispatch(A) ? "delivery line is not dispatched" : production ? "output stays restricted" : "stock stays held"}.`}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => go(String(k))}>
        <TabList aria-label="Inspection sections">{tabsOf(production, isFinalKind(A), isDispatch(A)).map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
      </Tabs>
      {tab === "overview" && <OverviewTab d={d} />}
      {tab === "samples" && <SamplesTab d={d} run={run} />}
      {tab === "findings" && <FindingsTab d={d} />}
      {tab === "decision" && <DecisionTab d={d} onDecide={() => setDeciding(true)} />}
      {tab === "inventory" && <InventoryTab d={d} />}
      {tab === "wip" && <WipTab d={d} />}
      {tab === "delivery" && <DeliveryTab d={d} />}
      {tab === "rework" && <ReworkTab d={d} />}
      {tab === "nonconformance" && <NonconformanceTab d={d} />}
      {tab === "documents" && <DocumentsTab d={d} />}
      {tab === "activity" && <ActivityTab d={d} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {deciding && <DispositionDialog d={d} onClose={() => setDeciding(false)} onDone={async () => { setDeciding(false); await refresh(); go("decision"); }} />}
    </div>
  );
}

function OverviewTab({ d }: { d: Detail }) {
  const final = isFinalKind(useApi());
  const step = (n: number, label: string, done: boolean, detail: string) => (
    <li className="flex gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? "bg-brand text-white" : "border border-border"}`}>{n}</span>
      <span><span className="font-medium">{label}</span><span className="block text-xs text-text-muted">{detail}</span></span></li>);
  const recorded = d.observations.length;
  const needed = d.samples.length * d.characteristics.filter((c) => c.required).length;
  const p = d.production;
  const ps = d.productionStatus;
  const dl = d.delivery;
  const source: Array<[string, ReactNode]> = dl
    ? [["Delivery", <Link key="dl" className="text-brand hover:underline" href={`/sales/deliveries/${dl.id}`}>{dl.number}</Link>], ["Sales order", dl.order], ["Customer", dl.customer ?? "—"],
      ["Checkpoint", dl.checkpoint === "MANUAL" ? "Requested by hand" : dl.checkpoint === "REINSPECTION" ? "Reinspection" : "Before dispatch"]]
    : p
    ? [["Production order", p.order], ["Reported output", p.entry ?? "—"], [final ? "Lot" : "Run", p.run ?? "—"], ...(final ? [] : [["Operation", p.operation ?? "—"] as [string, ReactNode]]),
      ["Checkpoint", CHECKPOINT_LABEL[p.checkpoint] ?? p.checkpoint],
      ["Work center / location", p.location ?? "—"], ["Operator", ps?.context.operator ?? "—"], ["Produced", ps?.context.produced !== undefined ? num(ps.context.produced) : "—"],
      ...(ps?.context.cumulative !== null && ps?.context.cumulative !== undefined ? [["Order output so far", num(ps.context.cumulative)] as [string, ReactNode]] : [])]
    : [["Goods receipt", d.receipt ? `${d.receipt.number}${d.receipt.line ? ` · line ${d.receipt.line}` : ""}` : "—"], ["Purchase order", d.purchaseOrder?.number ?? "—"], ["Supplier", d.supplier ?? "—"],
      ["Batch / lot", d.batch ?? "—"]];
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Inspection">
        <FactList items={[["Inspection", d.number], ...source, ["Item", d.item ? `${d.item.code} · ${d.item.name}` : "—"], ["Warehouse", d.warehouse ?? "—"],
          ["Quantity inspected", `${num(d.quantity)} ${d.unit ?? ""}`], ["Specification", d.version ? `${d.version.code} · ${d.version.name} — version ${d.version.number}` : "None"],
          ["Sampling", d.version?.sampling ?? "—"], ["Inspector", d.inspector?.name ?? "Unassigned"], ["Priority", priorityLabel(d.priority)], ["Due", d.dueAt ? dateLabel(d.dueAt) : "—"],
          ["Created", formatDateTime(d.createdAt)], ...(d.reinspectionReason ? [["Reinspection", `${d.reinspectionReason} (${d.standardDecision === "CURRENT" ? "current standard" : "original standard"})`] as [string, ReactNode]] : []),
          ...(d.cancelReason ? [["Cancelled", d.cancelReason] as [string, ReactNode]] : [])]} />
      </Panel>
      <Panel title="Progress" description="Select the inspection, identify the samples, record what you measure and see, review failed checks, then submit.">
        <ol className="flex flex-col gap-2 text-sm">
          {step(1, "Inspection selected", Boolean(d.inspector), d.inspector ? `Assigned to ${d.inspector.name}` : "Not yet assigned")}
          {step(2, "Samples identified", d.samples.length > 0, d.samples.length ? `${d.samples.length} sample${d.samples.length === 1 ? "" : "s"}: ${d.samples.map((s) => s.code).slice(0, 8).join(", ")}${d.samples.length > 8 ? " …" : ""}` : "Start the inspection to select the samples")}
          {step(3, "Measurements recorded", needed > 0 && recorded >= needed, `${recorded} of ${needed} required results`)}
          {step(4, "Failed checks reviewed", Boolean(d.evaluation) && d.evaluation!.incomplete === 0, d.evaluation ? `${d.evaluation.failed.length} failed check${d.evaluation.failed.length === 1 ? "" : "s"}` : "—")}
          {step(5, "Submitted", Boolean(d.submittedAt), d.submittedAt ? `Submitted ${formatDateTime(d.submittedAt)}` : "Not yet submitted")}
        </ol>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ samples & checks: the inspector's screen
function SamplesTab({ d, run }: { d: Detail; run: Run }) {
  const [sampleId, setSampleId] = useState(d.samples[0]?.id ?? "");
  const [amending, setAmending] = useState(false);
  if (!d.samples.length) return <Notice tone="info">{d.production?.reworkPending ? "The samples are selected once production confirms the rework and the inspection starts."
    : d.actions.start ? "Start the inspection to select the samples to inspect." : "The samples are selected when the inspector starts the inspection."}</Notice>;
  const sample = d.samples.find((s) => s.id === sampleId) ?? d.samples[0];
  const editable = d.actions.record || amending;
  const outcomeOf = (sId: string) => {
    const mine = d.observations.filter((o) => o.sampleId === sId);
    if (mine.some((o) => o.outcome === "FAIL")) return "FAIL";
    return mine.length >= d.characteristics.filter((c) => c.required).length ? "PASS" : null;
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">{d.version?.sampling}</p>
      <div className="flex flex-wrap gap-2">
        {d.samples.map((s) => {
          const o = outcomeOf(s.id);
          return <Button key={s.id} size="compact" variant={s.id === sample.id ? "primary" : "secondary"} onPress={() => setSampleId(s.id)}>
            {`${s.code}${o === "FAIL" ? " ✕" : o === "PASS" ? " ✓" : ""}`}</Button>;
        })}
      </div>
      {d.actions.amend && !amending && <span><Button size="compact" variant="secondary" onPress={() => setAmending(true)}>Correct a result</Button>
        <span className="ml-2 text-xs text-text-muted">The evidence is complete; a correction needs a reason and keeps the earlier value.</span></span>}
      <SampleRecorder key={`${sample.id}-${d.rowVersion}-${amending}`} d={d} sampleId={sample.id} editable={editable} amending={amending} run={run} onSaved={() => setAmending(false)} />
    </div>
  );
}
type Entry = { value: string; judgement: string; na: boolean; naReason: string; notes: string; evidence: string[] };
const entryOf = (o?: Observation): Entry => ({ value: o?.value ?? "", judgement: o?.judgement ?? "", na: Boolean(o?.notApplicable), naReason: o?.naReason ?? "", notes: o?.notes ?? "", evidence: o?.evidence ?? [] });
function SampleRecorder({ d, sampleId, editable, amending, run, onSaved }: { d: Detail; sampleId: string; editable: boolean; amending: boolean; run: Run; onSaved: () => void }) {
  const current = new Map(d.observations.filter((o) => o.sampleId === sampleId).map((o) => [o.characteristicId, o]));
  const [entries, setEntries] = useState<Record<string, Entry>>(() => Object.fromEntries(d.characteristics.map((c) => [c.id, entryOf(current.get(c.id))])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const sample = d.samples.find((s) => s.id === sampleId)!;
  const needsReason = amending || (d.status === "CHANGES_REQUESTED" && current.size > 0);
  const set = (id: string, patch: Partial<Entry>) => { setSaved(false); setEntries((e) => ({ ...e, [id]: { ...e[id], ...patch } })); };
  const save = async () => {
    setBusy(true); setError(null);
    const results = d.characteristics.map((c) => {
      const e = entries[c.id];
      const before = entryOf(current.get(c.id));
      if (JSON.stringify(e) === JSON.stringify(before)) return null;
      return { sampleId, characteristicId: c.id, value: e.value, judgement: e.judgement || undefined, notApplicable: e.na || undefined, naReason: e.naReason, notes: e.notes, evidenceFileIds: e.evidence,
        amendmentReason: reason || undefined };
    }).filter(Boolean);
    try {
      if (!results.length) { setError("Nothing changed on this sample."); return; }
      if (amending) await run("amend", { reason, results }); else await run("results", { results });
      setSaved(true); onSaved();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Panel title={`Sample ${sample.code}${sample.serialNumber ? ` — serial ${sample.serialNumber}` : ""} · ${d.item?.name ?? ""}${d.production?.operation ? ` · ${d.production.operation}` : ""}`}
      description={`${d.number} · ${d.statusLabel}${sample.method === "DOCUMENT" ? " · documents and certificates" : ""}`}>
      <div className="flex flex-col gap-4">
        {d.characteristics.map((c) => <CheckInput key={c.id} c={c} e={entries[c.id]} o={current.get(c.id)} files={d.files} editable={editable} onChange={(patch) => set(c.id, patch)} />)}
        {editable && needsReason && <TextField label="Why are these results changed?" value={reason} onChange={setReason} description="Required: the earlier values stay in the history." />}
        {error && <Notice tone="danger">{error}</Notice>}
        {saved && <Notice tone="success">Saved. Each result was evaluated against the specification; see the outcome next to each check.</Notice>}
        {editable && <span><Button variant="primary" isLoading={busy} isDisabled={needsReason && !reason.trim()} onPress={save}>{amending ? "Save correction" : `Save sample ${sample.code}`}</Button></span>}
        <p className="text-xs text-text-muted">{d.production
          ? "Saving records and evaluates this sample only. It does not let the output go on: that is Quality's disposition after the inspection is submitted and reviewed."
          : "Saving records and evaluates this sample only. It does not accept the lot or release stock: that is Quality's disposition after the inspection is submitted and reviewed."}</p>
      </div>
    </Panel>
  );
}
function CheckInput({ c, e, o, files, editable, onChange }: { c: Characteristic; e: Entry; o?: Observation; files: Detail["files"]; editable: boolean; onChange: (patch: Partial<Entry>) => void }) {
  const tone = c.criticality === "CRITICAL" ? "danger" : c.criticality === "MAJOR" ? "warning" : "neutral";
  const input = (() => {
    if (e.na) return null;
    switch (c.checkType) {
      case "NUMERIC_RANGE": case "NUMERIC_TARGET_TOLERANCE":
        return <TextField label={`Measured${c.unit ? ` (${c.unit})` : ""}`} inputMode="decimal" value={e.value} isDisabled={!editable} onChange={(v) => onChange({ value: v })} />;
      case "BOOLEAN":
        return <Select label="Result" selectedKey={e.value || null} isDisabled={!editable} onSelectionChange={(k) => onChange({ value: String(k) })}
          options={[{ value: "true", label: c.expected === false ? "Yes — it occurs" : "Works / present" }, { value: "false", label: c.expected === false ? "No — it does not occur" : "Does not work / absent" }]} />;
      case "ENUM":
        return <Select label="Observed" selectedKey={e.value || null} isDisabled={!editable} onSelectionChange={(k) => onChange({ value: String(k) })} options={c.choices.map((x) => ({ value: x.value, label: x.label }))} />;
      case "VISUAL":
        return <Select label="Observed" selectedKey={e.judgement || null} isDisabled={!editable} onSelectionChange={(k) => onChange({ judgement: String(k) })}
          options={[{ value: "PASS", label: "Acceptable" }, { value: "FAIL", label: "Not acceptable" }]} />;
      default:
        return <TextArea label="Observation" value={e.value} isDisabled={!editable} onChange={(v) => onChange({ value: v })} maxLength={2000} />;
    }
  })();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.name}</span><StatusBadge tone={tone}>{c.criticality.charAt(0) + c.criticality.slice(1).toLowerCase()}</StatusBadge>
        {!c.required && <span className="text-xs text-text-muted">Optional</span>}
        {o && <span className="ml-auto"><StatusBadge tone={OUTCOME_TONE[o.outcome] ?? "neutral"}>{o.outcomeLabel}</StatusBadge></span>}
      </div>
      <span className="text-sm text-text-secondary">{`Acceptable: ${c.criterion}`}</span>
      {c.instructions && <span className="text-xs text-text-muted">{c.instructions}{c.instrument ? ` · Use: ${c.instrument}` : ""}</span>}
      {o?.reason && o.outcome === "FAIL" && <span className="text-xs text-danger">{o.reason}</span>}
      <div className="flex flex-wrap items-end gap-3">
        {input}
        {c.allowNa && <Checkbox isSelected={e.na} isDisabled={!editable} onChange={(x) => onChange({ na: x })}>Not applicable</Checkbox>}
      </div>
      {e.na && <TextField label="Why is it not applicable?" value={e.naReason} isDisabled={!editable} onChange={(v) => onChange({ naReason: v })} />}
      {c.evidenceRequired && <span className="text-xs text-text-muted">Evidence required — attach a photo or record (upload it on the Documents tab).</span>}
      {(c.evidenceRequired || e.evidence.length > 0) && files.length > 0 && <div className="flex flex-wrap gap-3">
        {files.map((f) => <Checkbox key={f.id} isSelected={e.evidence.includes(f.id)} isDisabled={!editable}
          onChange={(x) => onChange({ evidence: x ? [...e.evidence, f.id] : e.evidence.filter((v) => v !== f.id) })}>{f.fileName}</Checkbox>)}
      </div>}
      {editable && c.checkType !== "TEXT_OBSERVATION" && <TextField label="Notes" value={e.notes} onChange={(v) => onChange({ notes: v })} />}
    </div>
  );
}

// ------------------------------------------------------------------ findings, review & decision
function FindingsTab({ d }: { d: Detail }) {
  const sample = (id: string) => d.samples.find((s) => s.id === id)?.code ?? "";
  const check = (id: string) => d.characteristics.find((c) => c.id === id);
  const failed = d.observations.filter((o) => o.outcome === "FAIL" || o.outcome === "REQUIRES_REVIEW");
  const e = d.evaluation;
  return (
    <div className="flex flex-col gap-4">
      {e && <Panel title="Evaluation" description="The consolidated result of the current observations under the specification's decision rule. Missing results never pass.">
        <FactList items={[["Proposed outcome", outcomeBadge(e.proposed, e.criticalFail) ?? "Incomplete"], ["Samples", `${e.sampleCount} (${e.failedSamples} failed)`],
          ["Defects", `${e.majorDefects} major · ${e.minorDefects} minor${e.criticalFail ? " · a critical check failed" : ""}`], ["Still to record", String(e.incomplete)],
          ["Evidence missing", e.missingEvidence.length ? e.missingEvidence.join(", ") : "None"], ["Evaluated", formatDateTime(e.evaluatedAt)]]} />
      </Panel>}
      <LinesTable columns={["Sample", "Check", "Importance", "Recorded", "Why", "Evidence", "By"]} empty={failed.length ? undefined : "No failed checks."}>
        {failed.map((o) => { const c = check(o.characteristicId); return (
          <tr key={o.id}><Cell>{sample(o.sampleId)}</Cell><Cell>{c?.name}</Cell><Cell>{c?.criticality}</Cell><Cell>{`${o.value ?? o.judgement ?? "—"}${o.unit ? ` ${o.unit}` : ""}`}</Cell>
            <Cell>{o.reason ?? o.outcomeLabel}</Cell><Cell>{o.evidence.length ? o.evidence.map((fid) => d.files.find((f) => f.id === fid)?.fileName ?? "file").join(", ") : "—"}</Cell>
            <Cell>{o.recordedBy ?? "—"}</Cell></tr>); })}
      </LinesTable>
      <p className="text-xs text-text-muted">{`A failed sample does not establish how many of the ${d.delivery ? "picked" : d.production ? "produced" : "received"} units are defective. The disposition decides exact quantities from what was segregated or inspected.`}</p>
    </div>
  );
}
const REVIEW_LABEL: Record<string, string> = { SUBMITTED: "Submitted", CHANGES_REQUESTED: "Sent back", APPROVED: "Approved", COMPLETED: "Evidence completed" };
function DecisionTab({ d, onDecide }: { d: Detail; onDecide: () => void }) {
  const A = useApi();
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Review" description="Every submission is kept, with what the reviewer decided.">
        <LinesTable columns={["Step", "Submission", "Proposed", "Note", "By", "When"]} empty={d.reviews.length ? undefined : "Not submitted yet."}>
          {d.reviews.map((r) => <tr key={r.id}><Cell>{REVIEW_LABEL[r.action] ?? r.action}</Cell><Cell numeric>{r.submission}</Cell><Cell>{outcomeBadge(r.proposed) ?? "—"}</Cell>
            <Cell>{r.note ?? "—"}</Cell><Cell>{r.actor ?? "—"}</Cell><Cell>{formatDateTime(r.at)}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Disposition" description="Quality's authorized decision on exact quantities. One unit is never both accepted and rejected."
        actions={d.actions.decide ? <Button size="compact" variant="primary" onPress={onDecide}>Decide disposition</Button> : undefined}>
        <FactList items={[["Inspected", `${num(d.quantity)} ${d.unit ?? ""}`], [d.production ? "Accepted to go on" : "Accepted", num(d.totals.accept)], ["Accepted under deviation", num(d.totals.conditional)],
          [d.production ? "Rejected / scrapped" : "Rejected", num(d.totals.reject)], ...(d.production ? [["Sent to rework", num(d.totals.rework)] as [string, ReactNode]] : []),
          ["Sent to reinspection", num(d.totals.reinspect)], ["Still undecided", num(d.totals.undecided)]]} />
        <LinesTable columns={["Decision", "Quantities", "Reason", "Links", "By", "When"]} empty={d.dispositions.length ? undefined : "No decision yet."}>
          {d.dispositions.map((x) => <tr key={x.id}><Cell><span className="font-medium">{x.number}</span><span className="block text-xs text-text-muted">{x.label}</span></Cell>
            <Cell>{[x.accept ? `${num(x.accept)} accepted` : null, x.conditional ? `${num(x.conditional)} under deviation` : null,
              x.reject ? `${num(x.reject)} rejected${x.route && x.route !== "HOLD" ? ` (${x.route === "SCRAP" ? "scrap" : "return to supplier"})` : ""}` : null,
              x.rework ? `${num(x.rework)} to rework` : null, x.reinspect ? `${num(x.reinspect)} to reinspection` : null, x.hold ? `${num(x.hold)} held for review` : null].filter(Boolean).join(" · ")}</Cell>
            <Cell>{x.reason}{x.conditions && <span className="block text-xs text-text-muted">{`Conditions: ${x.conditions}`}</span>}
              {x.reworkInstruction && <span className="block text-xs text-text-muted">{`Rework: ${x.reworkInstruction}`}</span>}</Cell>
            <Cell><span className="flex flex-col gap-1 text-sm">
              {x.reinspection && <Link className="text-brand hover:underline" href={`${A.base}/${x.reinspection.id}`}>{`${x.rework ? "Reinspection after rework" : "Reinspection"} ${x.reinspection.number}`}</Link>}
              {x.nonconformance && <Link className="text-brand hover:underline" href={`/quality/nonconformances/${x.nonconformance.id}`}>{`Nonconformance ${x.nonconformance.number}`}</Link>}
              {x.rejection && <span>{`Rejection case ${x.rejection.number}`}</span>}
              {d.production && x.route === "SCRAP" && x.reject > 0 && <span>{x.manufacturingDecision ? "Scrap recorded by Manufacturing" : "Scrap awaits Manufacturing"}</span>}</span></Cell>
            <Cell>{x.decidedBy ?? "—"}</Cell><Cell>{formatDateTime(x.decidedAt)}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.reinspections.length > 0 && <Panel title={d.production ? "Rework and reinspections" : "Reinspections"}>
        <LinesTable columns={["Reinspection", { label: "Quantity", numeric: true }, "Standard", "Status", "Created"]}>
          {d.reinspections.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={`${A.base}/${r.id}`}>{r.number}</Link></Cell><Cell numeric>{num(r.quantity)}</Cell>
            <Cell>{r.standard === "CURRENT" ? "Current version" : "Original version"}</Cell><Cell>{r.status.replace(/_/g, " ").toLowerCase()}</Cell><Cell>{formatDateTime(r.createdAt)}</Cell></tr>)}
        </LinesTable>
      </Panel>}
    </div>
  );
}
function DispositionDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: () => void }) {
  const A = useApi();
  const production = isProduction(A);
  const dispatch = isDispatch(A);
  const failed = d.proposed !== "PASS";
  const [decision, setDecision] = useState(failed ? "PARTIAL_ACCEPT" : "ACCEPT");
  const [v, setV] = useState<Record<string, string>>({ acceptQuantity: "", rejectQuantity: "", conditionalQuantity: "", reinspectQuantity: "", reworkQuantity: "", reworkInstruction: "",
    rejectRoute: "HOLD", reason: "", conditions: "", standard: "ORIGINAL", reinspectionReason: "", severity: d.criticalFailure ? "critical" : "major", ncDescription: "" });
  const [openNc, setOpenNc] = useState(failed && d.actions.nonconformance && !d.nonconformances.length);
  const [apply, setApply] = useState(d.actions.release);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string) => (value: string) => setV((x) => ({ ...x, [name]: value }));
  const left = d.totals.undecided;
  const DECISIONS = [{ value: "ACCEPT", label: dispatch ? "Clear all undecided for dispatch" : production ? "Accept all undecided to go on" : "Accept all undecided" },
    { value: "PARTIAL_ACCEPT", label: "Partly accept (exact split)" },
    { value: "REJECT", label: dispatch ? "Reject — keep on Quality hold" : production ? "Reject — keep blocked" : "Reject" },
    ...(production || dispatch ? [] : [{ value: "RETURN_TO_SUPPLIER", label: "Reject — return to supplier" }]),
    ...(dispatch ? [] : [{ value: "SCRAP", label: "Reject — scrap" }]), ...(production ? [{ value: "REWORK", label: "Send to rework, then reinspect" }] : []), { value: "REINSPECT", label: "Send to reinspection" },
    ...(d.actions.waive ? [{ value: "CONDITIONAL_ACCEPT", label: "Accept under an approved deviation" }] : []), { value: "HOLD_FOR_REVIEW", label: "Keep on hold for review (no decision)" }]
    .filter((x) => !(x.value === "ACCEPT" && failed) && !(["REINSPECT", "REWORK"].includes(x.value) && !d.actions.reinspect));
  const qty = (name: string, label: string) => <TextField label={label} inputMode="decimal" value={v[name]} onChange={set(name)} description={`Up to ${num(left)}`} />;
  const showReject = ["PARTIAL_ACCEPT", "REJECT"].includes(decision) && !dispatch;
  const rework = decision === "REWORK" || (decision === "PARTIAL_ACCEPT" && Number(v.reworkQuantity) > 0);
  const reinspect = decision === "REINSPECT" || (decision === "PARTIAL_ACCEPT" && Number(v.reinspectQuantity) > 0);
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      await A.action(d.id, "dispose", { decision, acceptQuantity: v.acceptQuantity, rejectQuantity: v.rejectQuantity, conditionalQuantity: v.conditionalQuantity, reinspectQuantity: v.reinspectQuantity,
        reworkQuantity: v.reworkQuantity, reworkInstruction: rework ? v.reworkInstruction : undefined, rejectRoute: v.rejectRoute, reason: v.reason, conditions: v.conditions || undefined,
        applyToStock: production || dispatch ? undefined : apply, idempotencyKey: key, reinspection: reinspect || rework ? { standard: v.standard, reason: v.reinspectionReason || v.reason } : undefined,
        nonconformance: openNc ? { severity: v.severity, description: v.ncDescription || undefined } : undefined });
      onDone();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Disposition of ${d.number}`} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">{`${num(left)} of ${num(d.quantity)} ${d.unit ?? ""} are undecided. ${failed ? `The inspection ${d.criticalFailure ? "failed a critical check" : "failed"}: decide the exact quantities from what was segregated — a sample failing does not tell how many units are defective.` : "Every check passed."}`}</p>
        <Select label="Decision" selectedKey={decision} onSelectionChange={(k) => setDecision(String(k))} options={DECISIONS} />
        {decision === "PARTIAL_ACCEPT" && <div className="grid gap-2 sm:grid-cols-2">{qty("acceptQuantity", dispatch ? "Clear for dispatch" : production ? "Accept to go on" : "Accept")}{qty("rejectQuantity", "Reject")}
          {production && qty("reworkQuantity", "Send to rework")}{qty("reinspectQuantity", "Send to reinspection")}
          {d.actions.waive && qty("conditionalQuantity", "Accept under deviation")}</div>}
        {["REJECT", "RETURN_TO_SUPPLIER", "SCRAP"].includes(decision) && qty("rejectQuantity", "Quantity rejected (empty: all undecided)")}
        {decision === "REWORK" && qty("reworkQuantity", "Quantity to rework (empty: all undecided)")}
        {decision === "REINSPECT" && qty("reinspectQuantity", "Quantity to reinspect (empty: all undecided)")}
        {decision === "CONDITIONAL_ACCEPT" && qty("conditionalQuantity", "Quantity accepted under deviation (empty: all undecided)")}
        {showReject && <Select label={production ? "What happens to the rejected output" : "What happens to the rejected goods"} selectedKey={v.rejectRoute} onSelectionChange={(k) => set("rejectRoute")(String(k))}
          options={[{ value: "HOLD", label: "Stay blocked — decide later" }, ...(production ? [] : [{ value: "RETURN_TO_SUPPLIER", label: "Return to the supplier" }]), { value: "SCRAP", label: "Scrap" }]} />}
        {rework && <TextArea label="What must the rework correct?" value={v.reworkInstruction} onChange={set("reworkInstruction")} maxLength={1000} />}
        {(decision === "CONDITIONAL_ACCEPT" || Number(v.conditionalQuantity) > 0) && <TextArea label="Conditions of the deviation" value={v.conditions} onChange={set("conditions")} maxLength={2000} />}
        {(reinspect || rework) && <div className="grid gap-2 sm:grid-cols-2">
          <Select label="Reinspect under" selectedKey={v.standard} onSelectionChange={(k) => set("standard")(String(k))}
            options={[{ value: "ORIGINAL", label: `The original standard (v${d.version?.number ?? ""})` }, { value: "CURRENT", label: "The specification version in force now" }]} />
          <TextField label="Why reinspect?" value={v.reinspectionReason} onChange={set("reinspectionReason")} /></div>}
        <TextArea label="Reason for the decision" value={v.reason} onChange={set("reason")} maxLength={2000} />
        {d.actions.nonconformance && <Checkbox isSelected={openNc} onChange={setOpenNc}>Open a nonconformance for the findings</Checkbox>}
        {openNc && <div className="grid gap-2 sm:grid-cols-2">
          <Select label="Severity" selectedKey={v.severity} onSelectionChange={(k) => set("severity")(String(k))} options={[{ value: "minor", label: "Minor" }, { value: "major", label: "Major" }, { value: "critical", label: "Critical" }]} />
          <TextField label="Describe the defect" value={v.ncDescription} onChange={set("ncDescription")} /></div>}
        {dispatch && <p className="text-xs text-text-muted">The delivery is dispatched only up to what you clear. Rejected units stay in the warehouse on an Inventory quality hold — opened now when you may create holds — where Inventory decides their scrap, return or release.</p>}
        {!production && !dispatch && d.actions.release && <Checkbox isSelected={apply} onChange={setApply}>Release the accepted quantity into stock now (you may release held goods)</Checkbox>}
        {!production && !dispatch && !d.actions.release && <p className="text-xs text-text-muted">Inventory releases the accepted quantity; rejected goods are handled through Procurement&apos;s rejection case.</p>}
        {production && <p className="text-xs text-text-muted">{isFinalKind(A)
          ? `${d.actions.scrap ? "Accepting records Manufacturing's acceptance at once (up to what every required check allows), and scrap too" : "Manufacturing records the acceptance and the scrap"}; the accepted output is then received as finished goods.`
          : `Manufacturing accepts the cleared quantity at its final inspection, never more. ${d.actions.scrap ? "Scrap is recorded in Manufacturing at once." : "Scrap waits for someone in Manufacturing to record it."}`}</p>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!v.reason.trim() || (rework && !v.reworkInstruction.trim())} onPress={confirm}>Authorize decision</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ inventory / production / delivery status, rework, nonconformance, documents, activity
function DeliveryTab({ d }: { d: Detail }) {
  const s = d.dispatchStatus;
  if (!s) return <Notice tone="info">No delivery context is recorded for this inspection.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Quality gate" description="What this requirement lets the delivery do. Read from the requirement and the delivery — never stored on the inspection.">
        {s.gate ? <FactList items={[["Requirement", `${s.gate.requirement ?? ""} — ${s.gate.label ?? s.gate.status}`], ["Restriction", s.gate.blocking ? "The line is dispatched only up to the clearance" : "Advisory: nothing is blocked"],
          ["Inspected", num(s.gate.controlled)], ["Cleared by Quality", num(s.gate.cleared)], ["Rejected by Quality", num(s.gate.rejected)],
          ["On the delivery line now", num(s.delivery?.lineQuantity)], ["Can be dispatched now", num(s.gate.shippable)], ["Held back", num(s.gate.blockedNow)]]} />
          : <p className="text-sm text-text-muted">This inspection was requested by hand: it records quality evidence but holds nothing.</p>}
        {s.gate?.blocking && (s.gate.blockedNow ?? 0) > 0 && s.gate.status !== "PENDING" && <p className="mt-2 text-xs text-text-muted">To ship what Quality cleared, return the delivery to draft and reduce the line; the rest of the order goes on another delivery, inspected there.</p>}
      </Panel>
      <Panel title="Delivery" description="As Sales records it.">
        <FactList items={[["Delivery", s.delivery ? <Link key="d" className="text-brand hover:underline" href={`/sales/deliveries/${s.delivery.id}`}>{s.delivery.number}</Link> : "—"],
          ["Status", s.delivery?.statusLabel ?? "—"], ["Dispatched", s.delivery?.dispatchedAt ? formatDateTime(s.delivery.dispatchedAt) : "—"], ["Sales order", s.context.order], ["Customer", s.context.customer ?? "—"]]} />
      </Panel>
      <Panel title="Rejected units on hold" description="Inventory's quality hold cases opened from this inspection's decisions.">
        <LinesTable columns={["Hold", "Decision", { label: "Rejected", numeric: true }, { label: "Still held", numeric: true }, "Status"]} empty={s.holds.length ? undefined : "No hold case."}>
          {s.holds.map((h) => <tr key={h.id}><Cell><Link className="text-brand hover:underline" href={`/inventory/quality-holds/${h.id}`}>{h.number}</Link></Cell><Cell>{h.disposition}</Cell>
            <Cell numeric>{num(h.rejected)}</Cell><Cell numeric>{num(h.unresolved)}</Cell><Cell>{h.status === "draft" ? "Draft — Inventory places it" : h.status.replace(/_/g, " ")}</Cell></tr>)}
        </LinesTable>
      </Panel>
    </div>
  );
}
function InventoryTab({ d }: { d: Detail }) {
  const s = d.inventory;
  return (
    <div className="flex flex-col gap-4">
      {!s ? <Notice tone="info">This inspection does not hold stock (a manual inspection, or goods not held on the receipt).</Notice> : (
        <Panel title="Inventory status" description="Read from the goods receipt, Inventory's hold and the control point requirement — never stored on the inspection.">
          <FactList items={[["Goods receipt", s.receipt ? `${s.receipt.number} · line ${s.receipt.line}` : "—"], ["Held for Quality", num(s.held)], ["Still held", num(s.stillHeld)],
            ["Cleared by Quality", num(s.cleared)], ["Released into stock", num(s.released)], ["Cleared, awaiting release", num(s.awaitingRelease)], ["Blocked on a rejection case", num(s.blocked)],
            ["Returned to the supplier", num(s.returned)], ["Disposed of", num(s.disposed)],
            ["Requirement", s.requirement ? `${s.requirement.label ?? s.requirement.status} · ${num(s.requirement.controlled)} controlled${s.requirement.blocking ? " · blocks stock" : ""}` : "—"],
            ["Stock hold", s.hold ? <Link key="hold" className="text-brand hover:underline" href={`/inventory/quality-holds/${s.hold.id}`}>{`${s.hold.number} (${s.hold.status.replace(/_/g, " ")})`}</Link> : "—"]]} />
        </Panel>)}
      <InspectionRejectionsPanel inspectionId={d.reinspectionOf?.id ?? d.id} />
    </div>
  );
}
function WipTab({ d }: { d: Detail }) {
  const A = useApi();
  const final = isFinalKind(A);
  const s = d.productionStatus;
  if (!s) return <Notice tone="info">No production context is recorded for this inspection.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Quality gate" description="What this requirement lets production do. Read from the requirement and Manufacturing's decisions — never stored on the inspection.">
        {s.gate ? <FactList items={[["Requirement", `${s.gate.requirement} — ${s.gate.label ?? s.gate.status}`], ["Restriction", s.gate.blocking ? (s.gate.scope === "RUN" ? "The run takes no more output until cleared" : "The output is accepted only up to the clearance") : "Advisory: nothing is blocked"],
          ["Controlled", num(s.gate.controlled)], ["Cleared by Quality", num(s.gate.cleared)], ["Cleared, not yet accepted by Manufacturing", num(s.gate.awaitingAcceptance)]]} />
          : <p className="text-sm text-text-muted">This inspection was requested by hand: it records quality evidence but restricts nothing.</p>}
        {final && s.gate?.blocking && <p className="mt-2 text-xs text-text-muted">Uncleared output stays in production custody: Manufacturing accepts it, and the finished-goods receipt brings it into stock, only up to Quality&apos;s clearance — so it can&apos;t be allocated or dispatched before.</p>}
      </Panel>
      <Panel title={final ? "Finished goods" : "Production"} description="As Manufacturing and Inventory record it.">
        <FactList items={[["Production order", s.order ? `${s.order.number} (${s.order.status.replace(/_/g, " ").toLowerCase()})` : "—"], ["Reported output", s.entry ? `${s.entry.number} — ${num(s.entry.reported)} reported` : "—"],
          [final ? "Lot" : "Run", s.run ? `${s.run.reference} (${s.run.status.toLowerCase()})` : "—"], ...(final ? [] : [["Operation", s.context.operation ?? "—"] as [string, ReactNode]]), ["Location", s.context.location ?? "—"], ["Operator", s.context.operator ?? "—"],
          ["Still awaiting final inspection", s.entry ? num(s.entry.awaitingInspection) : "—"], ["Accepted by Manufacturing", s.entry ? num(s.entry.acceptedByManufacturing) : "—"],
          ...(final ? [["Received as finished goods", s.entry ? num(s.entry.received) : "—"] as [string, ReactNode]] : []), ["Scrapped", s.entry ? num(s.entry.scrapped) : "—"], ["On Manufacturing's quality hold", s.entry ? num(s.entry.held) : "—"], ["Corrected away", s.entry ? num(s.entry.corrected) : "—"]]} />
        {s.order && <Link className="text-sm text-brand hover:underline" href={`/manufacturing/orders/${s.order.id}`}>Open the production order</Link>}
      </Panel>
    </div>
  );
}
function ReworkTab({ d }: { d: Detail }) {
  const A = useApi();
  const reworks = d.dispositions.filter((x) => x.rework > 0);
  const c = d.productionStatus?.context;
  return (
    <div className="flex flex-col gap-4">
      {c?.reworkRequired && <Panel title="This reinspection follows a rework">
        <FactList items={[["Rework asked for", c.reworkInstruction ?? "—"], ["Carried out", c.reworkReference ?? "Not yet confirmed by production"], ["Confirmed", c.reworkCompletedAt ? formatDateTime(c.reworkCompletedAt) : "—"],
          ["Original inspection", d.reinspectionOf ? <Link key="o" className="text-brand hover:underline" href={`${A.base}/${d.reinspectionOf.id}`}>{d.reinspectionOf.number}</Link> : "—"]]} />
      </Panel>}
      <LinesTable columns={["Disposition", { label: "Rework", numeric: true }, "Instruction", "Reinspection", "Decided"]} empty={reworks.length ? undefined : "No rework decided on this inspection."}>
        {reworks.map((x) => <tr key={x.id}><Cell>{x.number}</Cell><Cell numeric>{num(x.rework)}</Cell><Cell>{x.reworkInstruction ?? "—"}</Cell>
          <Cell>{x.reinspection ? <Link className="text-brand hover:underline" href={`${A.base}/${x.reinspection.id}`}>{x.reinspection.number}</Link> : "—"}</Cell><Cell>{formatDateTime(x.decidedAt)}</Cell></tr>)}
      </LinesTable>
      <p className="text-xs text-text-muted">Reworked units stay restricted until their reinspection clears them. Every attempt is kept: a failed reinspection never overwrites the original result.</p>
    </div>
  );
}
function NonconformanceTab({ d }: { d: Detail }) {
  return (
    <Panel title="Nonconformances" description="Opened from this inspection's findings (on the disposition), with the failed observations kept on them.">
      <LinesTable columns={["Nonconformance", "Severity", "Status", "Description"]} empty={d.nonconformances.length ? undefined : "None linked."}>
        {d.nonconformances.map((x) => <tr key={x.id}><Cell><Link className="text-brand hover:underline" href={`/quality/nonconformances/${x.id}`}>{x.number}</Link></Cell><Cell>{x.severity}</Cell>
          <Cell>{x.status.replace(/_/g, " ")}</Cell><Cell>{x.description}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
function DocumentsTab({ d }: { d: Detail }) {
  const A = useApi();
  const refresh = useRefresh();
  const [error, setError] = useState<string | null>(null);
  const open = ["PENDING", "ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(d.status);
  const used = new Set(d.observations.flatMap((o) => o.evidence));
  return (
    <div className="flex flex-col gap-3">
      {d.actions.upload && d.status !== "CANCELLED" && <label className="text-sm">{d.production ? "Add a photo, drawing or measurement record" : "Add a photo, certificate or laboratory report"}
        <input className="mt-1 block text-sm" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.txt,.xlsx,.docx" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError(null);
          try { await A.upload(d.id, file); await refresh(); } catch (failure) { setError(errorMessage(failure)); }
          e.target.value = "";
        }} /></label>}
      {error && <Notice tone="danger">{error}</Notice>}
      <LinesTable columns={["Document", "Added", "Used by a result", ""]} empty={d.files.length ? undefined : "No evidence yet."}>
        {d.files.map((f) => <tr key={f.id}><Cell><a className="text-brand hover:underline" href={A.evidenceHref(d.id, f.id)}>{f.fileName}</a></Cell><Cell>{formatDateTime(f.uploadedAt)}</Cell>
          <Cell>{used.has(f.id) ? "Yes" : "—"}</Cell>
          <Cell>{d.actions.record && open && !used.has(f.id) && <Button size="compact" variant="secondary" onPress={async () => { await A.remove(d.id, f.id).catch((x) => setError(errorMessage(x))); await refresh(); }}>Remove</Button>}</Cell></tr>)}
      </LinesTable>
      <p className="text-xs text-text-muted">Evidence stays once the results are submitted, so what the decision rested on stays with it.</p>
    </div>
  );
}
function ActivityTab({ d }: { d: Detail }) {
  const sample = (id: string) => d.samples.find((s) => s.id === id)?.code ?? "";
  const check = (id: string) => d.characteristics.find((c) => c.id === id)?.name ?? "";
  return (
    <div className="flex flex-col gap-4">
      <HistoryList entries={d.history.map((e) => ({ summary: e.label, at: e.at, actor: e.actor, detail: e.detail ? <span className="text-sm text-text-secondary">{e.detail}</span> : undefined }))} />
      {d.superseded.length > 0 && <Panel title="Earlier results" description="Results replaced by a later entry or a correction — never overwritten.">
        <LinesTable columns={["Sample", "Check", "Value", "Outcome", "Recorded", "By"]}>
          {d.superseded.map((o) => <tr key={o.id}><Cell>{sample(o.sampleId)}</Cell><Cell>{check(o.characteristicId)}</Cell><Cell>{`${o.value ?? o.judgement ?? "—"}${o.unit ? ` ${o.unit}` : ""}`}</Cell>
            <Cell>{o.outcomeLabel}</Cell><Cell>{formatDateTime(o.recordedAt)}</Cell><Cell>{o.recordedBy ?? "—"}</Cell></tr>)}
        </LinesTable>
      </Panel>}
    </div>
  );
}

// ------------------------------------------------------------------ the Quality home's panels
const tile = (label: string, value: string, href: string) => (
  <Link key={label} href={href} className="rounded-md border border-border bg-surface p-3 hover:border-brand"><span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{value}</span></Link>);
export function IncomingHomePanel() {
  const A = apiFor("incoming");
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<Dashboard>(), retry: false });
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  return (
    <Panel title="Incoming inspections" description="Supplier goods waiting for Quality." actions={<Link className="text-sm text-brand hover:underline" href={A.base}>Open</Link>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Pending", num(d.counts.awaiting), `${A.base}?view=awaiting`)}{tile("Goods held for QC", num(d.receiptsHeld), `${A.base}?view=overview`)}
        {tile("Awaiting review", num(d.counts.review), `${A.base}?view=review`)}{tile("Awaiting disposition", num(d.counts.disposition), `${A.base}?view=disposition`)}
        {tile("Overdue", num(d.counts.overdue), `${A.base}?view=overdue`)}{tile("Exceptions", num(d.counts.exceptions), `${A.base}?view=exceptions`)}
      </div>
    </Panel>
  );
}
export function InProcessHomePanel() {
  const A = apiFor("in_process");
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<InProcessDashboard>(), retry: false });
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  return (
    <Panel title="In-process inspections" description="Production output waiting for Quality." actions={<Link className="text-sm text-brand hover:underline" href={A.base}>Open</Link>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Pending", num(d.counts.awaiting), `${A.base}?view=awaiting`)}{tile("Production blocked", num(d.blockedOperations), `${A.base}?view=overview`)}
        {tile("WIP on hold", num(d.wipOnHold), `${A.base}?view=overview`)}{tile("Awaiting disposition", num(d.counts.disposition), `${A.base}?view=disposition`)}
        {tile("Rework required", num(d.reworkRequired), `${A.base}?view=reinspection`)}{tile("Exceptions", num(d.counts.exceptions), `${A.base}?view=exceptions`)}
      </div>
    </Panel>
  );
}

export function FinalHomePanel() {
  const A = apiFor("final");
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<FinalDashboard>(), retry: false });
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  return (
    <Panel title="Final inspections" description="Finished output waiting for Quality before it becomes finished goods." actions={<Link className="text-sm text-brand hover:underline" href={A.base}>Open</Link>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Pending", num(d.counts.awaiting), `${A.base}?view=awaiting`)}{tile("Lots on hold", num(d.lotsOnHold), `${A.base}?view=overview`)}
        {tile("Awaiting review", num(d.counts.review), `${A.base}?view=review`)}{tile("Awaiting disposition", num(d.counts.disposition), `${A.base}?view=disposition`)}
        {tile("Rework / reinspection", num(d.counts.reinspection), `${A.base}?view=reinspection`)}{tile("Exceptions", num(d.counts.exceptions), `${A.base}?view=exceptions`)}
      </div>
    </Panel>
  );
}

export function DispatchHomePanel() {
  const A = apiFor("pre_dispatch");
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "dashboard"), queryFn: () => A.dashboard<DispatchDashboard>(), retry: false });
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  return (
    <Panel title="Pre-dispatch inspections" description="Customer deliveries waiting for Quality before they leave." actions={<Link className="text-sm text-brand hover:underline" href={A.base}>Open</Link>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Pending", num(d.counts.awaiting), `${A.base}?view=awaiting`)}{tile("Deliveries held", num(d.deliveriesBlocked), `${A.base}?view=overview`)}
        {tile("Awaiting review", num(d.counts.review), `${A.base}?view=review`)}{tile("Awaiting disposition", num(d.counts.disposition), `${A.base}?view=disposition`)}
        {tile("Overdue", num(d.counts.overdue), `${A.base}?view=overdue`)}{tile("Exceptions", num(d.counts.exceptions), `${A.base}?view=exceptions`)}
      </div>
    </Panel>
  );
}
// On a Sales delivery: its pre-dispatch inspections and what each lets leave (nothing shown without the pre-dispatch view).
export function DeliveryQualityPanel({ deliveryId }: { deliveryId: string }) {
  const A = apiFor("pre_dispatch");
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "delivery", deliveryId), queryFn: () => A.list("", "", "", "", "", deliveryId), retry: false });
  if (q.isLoading || q.isError || !q.data!.rows.length) return null;
  return (
    <KindContext.Provider value="pre_dispatch">
      <Panel title="Quality before dispatch" description="Each line under a pre-dispatch check leaves only as far as Quality clears it." actions={<Link className="text-sm text-brand hover:underline" href={A.base}>{A.title}</Link>}>
        <InspectionTable rows={q.data!.rows} />
      </Panel>
    </KindContext.Provider>
  );
}

// ------------------------------------------------------------------ a Manufacturing Order's in-process and final inspections
// On the order's Quality tab: every in-process inspection of its output and what it restricts (nothing shown without the in-process view).
export function InProcessOrderPanel({ orderId, kind = "in_process" }: { orderId: string; kind?: "in_process" | "final" }) {
  const A = apiFor(kind);
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", A.key, "order", orderId), queryFn: () => A.list("", "", "", "", orderId), retry: false });
  if (q.isLoading || q.isError) return null;
  const rows = q.data!.rows;
  return (
    <KindContext.Provider value={kind}>
      <Panel title={kind === "final" ? "Final inspections" : "In-process inspections"} description={kind === "final"
        ? "Finished output waiting for Quality. It is accepted and received as finished goods only as far as Quality clears it."
        : "Quality checks of this order's output. Output waiting for a blocking check is accepted only as far as Quality clears it."}
        actions={<Link className="text-sm text-brand hover:underline" href={A.base}>{A.title}</Link>}>
        {rows.length ? <InspectionTable rows={rows} /> : <p className="text-sm text-text-muted">{`No ${A.noun} for this order.`}</p>}
      </Panel>
    </KindContext.Provider>
  );
}

// ------------------------------------------------------------------ Quality Settings: inspection policy
export function IncomingSettingsPanel() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "quality", "incoming", "settings");
  const q = useQuery({ queryKey: key, queryFn: () => readView<{ settings: { incoming_review_policy?: string; incoming_due_days?: number } }>("settings").then((r) => r.settings), retry: false });
  if (q.isLoading || q.isError) return null;
  const s = q.data!;
  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try { await act("settings-save", patch); await client.invalidateQueries({ queryKey: key }); } catch (failure) { setError(errorMessage(failure)); }
  };
  return (
    <Panel title="Inspection review and due dates" description="When submitted results (incoming and in-process) go to a reviewer, and how long an inspection may take before it is overdue.">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Review of submitted results" selectedKey={s.incoming_review_policy ?? "ON_FAILURE"} onSelectionChange={(k) => save({ incomingReviewPolicy: String(k) })}
          options={[{ value: "ON_FAILURE", label: "Only when a check fails or needs judgement" }, { value: "ALWAYS", label: "Every inspection is reviewed" }]} />
        <TextField label="Days to inspect" inputMode="numeric" defaultValue={String(s.incoming_due_days ?? 2)} onBlur={(e) => save({ incomingDueDays: (e.target as HTMLInputElement).value })} />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </Panel>
  );
}
