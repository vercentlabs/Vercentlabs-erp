"use client";

// One manufacturing order on one screen: target, accepted and remaining; the toolbar offers only what the order's state and the person's
// permissions allow. Tabs: Overview (plan, recipe, progress, linked orders), Materials (required, reserved, issued, used, short — with
// reserve, issue, return, usage, extra material, shortage hand-off and subassembly orders), Production (output reported), Quality (what
// waits and the decisions), Costs (estimate against actual, work in progress) and Documents & History.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { BOM_BASE } from "@/features/manufacturing/boms/screens/BomListScreen";
import {
  MO_BASE, STATUS_TONE, decideVariance, errorDetails, errorMessage, errorStatus, exportOrder, getOrder, inr, orderAction, qty, resolveException, type MoOrder,
} from "../api/mo-api";
import { MaterialAvailabilityPanel, reserveWithPreview } from "@/features/manufacturing/availability/components/MaterialAvailabilityPanel";
import { MaterialReconciliationPanel } from "@/features/manufacturing/consumption/components/MaterialReconciliationPanel";
import { ProductionProgressPanel } from "@/features/manufacturing/production/components/ProductionProgressPanel";
import { MC_BASE } from "@/features/manufacturing/consumption/api/mc-api";
import { MI_BASE } from "@/features/manufacturing/issues/api/mi-api";
import { holdAction } from "@/features/manufacturing/holds/api/hold-api";
import { holdAsk } from "@/features/manufacturing/holds/components/holdDialog";
import { OrderCostingPanel } from "@/features/manufacturing/costing/components/OrderCostingPanel";
import { OrderHoldBanner, OrderHoldHistoryPanel } from "@/features/manufacturing/holds/components/OrderHoldPanel";
import { OrderQualityPanel } from "@/features/manufacturing/quality/components/OrderQualityPanel";
import { OrderScrapPanel } from "@/features/manufacturing/scrap/components/OrderScrapPanel";
import { OrderVariancePanel } from "@/features/manufacturing/variance/components/OrderVariancePanel";
import { SCRAP_BASE } from "@/features/manufacturing/scrap/api/scrap-api";
import { OrderReceiptsPanel } from "@/features/manufacturing/receipts/components/OrderReceiptsPanel";
import { FGR_BASE } from "@/features/manufacturing/receipts/api/fgr-api";
import { AskDialog, MaterialLinesDialog, type Ask, type LinesMode } from "../components/MoDialogs";

const HOLD = [{ value: "MATERIAL_SHORTAGE", label: "Material shortage" }, { value: "QUALITY_ISSUE", label: "Quality issue" }, { value: "EQUIPMENT_DOWNTIME", label: "Equipment downtime" },
  { value: "PRIORITY_CHANGE", label: "Priority change" }, { value: "COST_VARIANCE", label: "Cost variance" }, { value: "QUANTITY_VARIANCE", label: "Quantity variance" }, { value: "OTHER", label: "Other" }];
const READINESS: Record<string, string> = { READY: "Materials ready", PARTIAL: "Materials partly ready", NOT_READY: "Materials not reserved", NO_MATERIALS: "No materials" };
const ACTION_LABEL: Record<string, string> = { CREATED: "Created", EDITED: "Draft edited", SUBMITTED: "Submitted for approval", RETURNED: "Returned to draft", APPROVED: "Approved", RELEASED: "Released",
  MATERIALS_RESERVED: "Materials reserved", RESERVATIONS_RELEASED: "Reservations released", MATERIAL_ISSUED: "Material issued", MATERIAL_RETURNED: "Material returned",
  CONSUMPTION_RECORDED: "Material use recorded", REMAINING_CONSUMED: "Remaining material declared used", EXTRA_MATERIAL_REQUESTED: "Extra material requested",
  EXTRA_MATERIAL_APPROVED: "Extra material approved", EXTRA_MATERIAL_REJECTED: "Extra material rejected", STARTED: "Production started", PRODUCTION_RECORDED: "Production recorded",
  QUALITY_DECIDED: "Quality decision", GOODS_RECEIVED: "Finished goods received", HELD: "Put on hold", RESUMED: "Resumed", SHORTAGES_HANDED_OFF: "Shortages handed to Procurement",
  EXCEPTION_RAISED: "Exception raised", EXCEPTION_RESOLVED: "Exception resolved", COMPLETED: "Completed", CLOSED_SHORT: "Closed short", CANCELLED: "Cancelled" };

export function MoDetailScreen({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const key = scopedQueryKey(workspace, "manufacturing", "order", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => getOrder(orderId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [lines, setLines] = useState<LinesMode | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string; blockers?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the order" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to manufacturing orders" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order" description={errorMessage(query.error)} />;
  }
  const order = query.data;
  const can = order.can;
  const refresh = async (next?: MoOrder) => {
    if (next) queryClient.setQueryData(key, next);
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  // Every action: the result (an order, or { order }) refreshes the page; a refusal shows its reason (and every blocker).
  const perform = async (work: () => Promise<unknown>, text: string) => {
    try {
      const result = await work() as { order?: MoOrder } | MoOrder;
      const next = result && "can" in result ? result as MoOrder : (result as { order?: MoOrder })?.order;
      await refresh(next);
      setMessage({ tone: "success", text });
    } catch (failure) {
      setMessage({ tone: "danger", text: errorMessage(failure), blockers: errorDetails(failure).blockers });
      throw failure;
    }
  };
  const quick = async (action: string, text: string, input: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await perform(() => orderAction(order.id, action, { expectedVersion: order.version, ...input }), text); } catch { /* shown */ } finally { setBusy(false); }
  };
  const dialog = (next: Omit<Ask, "run"> & { action: string; text: string; input?: (values: Record<string, string | boolean>, key: string) => Record<string, unknown> }) =>
    setAsk({ ...next, run: (values, requestKey) => perform(() => orderAction(order.id, next.action, next.input ? next.input(values, requestKey) : { ...values, idempotencyKey: requestKey }), next.text) });
  const short = Number(order.quantities.accepted) < Number(order.quantities.planned);
  const pendingEntries = order.production.filter((row) => Number(row.pendingRemaining) > 0);
  const exportCsv = async () => {
    try {
      const file = await exportOrder(order.id);
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url; link.download = file.fileName; link.click();
      URL.revokeObjectURL(url);
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" onPress={() => router.push(`${MO_BASE}/${order.id}/edit`)}>Edit draft</Button>}
      {can.submit && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quick("submit", "Submitted for approval.")}>Submit for approval</Button>}
      {can.approve && <Button size="compact" variant="primary" onPress={() => dialog({ action: "approve", text: "Approved.", title: "Approve and release", confirm: "Approve",
        description: "Approving releases the order if you may release: the recipe is frozen and production is authorised. Reserving holds what is in stock now; anything short stays short (the company setup decides whether a short order may be released).",
        fields: [{ name: "note", label: "Note (optional)", kind: "textarea" }, { name: "reserveMaterials", label: "Reserve materials now", kind: "checkbox", initial: true }] })}>Approve</Button>}
      {can.returnToDraft && <Button size="compact" variant="secondary" onPress={() => dialog({ action: "return", text: "Returned to draft.", title: "Send back for changes", confirm: "Send back",
        fields: [{ name: "reason", label: "What needs to change", kind: "textarea", required: true }] })}>Send back</Button>}
      {can.release && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quick("release", "Released.", { reserveMaterials: true })}>Release</Button>}
      {can.reserve && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => { setBusy(true); reserveWithPreview(order.id, setAsk, perform).catch(() => undefined).finally(() => setBusy(false)); }}>Reserve materials</Button>}
      {can.issue && <Button size="compact" variant="secondary" onPress={() => router.push(`${MI_BASE}/new?orderId=${order.id}`)}>Issue materials</Button>}
      {can.start && <Button size="compact" variant="primary" onPress={() => order.progress.materials === "READY" ? void quick("start", "Production started.")
        : dialog({ action: "start", text: "Production started.", title: "Start with materials short", confirm: "Start",
          description: "Not every material is reserved or issued in full. Only someone who may approve variances starts it, with a reason.",
          fields: [{ name: "reason", label: "Why production starts now", kind: "textarea", required: true }], input: (values) => ({ allowPartial: true, reason: values.reason }) })}>Start production</Button>}
      {can.record && <Button size="compact" variant="primary" onPress={() => dialog({ action: "production-entries", text: "Production recorded.", title: "Record production", confirm: "Record",
        description: order.settings.requireInspection ? "Every unit waits for a quality decision before it is accepted." : "Leave the split empty to accept everything reported.",
        fields: [{ name: "reportedQuantity", label: `Quantity produced (${order.finishedItem.baseUom ?? ""})`, kind: "quantity", required: true },
          ...(order.settings.requireInspection ? [] : [{ name: "acceptedQuantity", label: "Accepted", kind: "quantity" as const }]),
          { name: "rejectedQuantity", label: "Rejected", kind: "quantity" }, { name: "pendingQuantity", label: "Awaiting inspection", kind: "quantity" },
          { name: "rejectionReason", label: "Rejection reason", kind: "text" }, { name: "batchReference", label: "Production batch reference", kind: "text" }, { name: "notes", label: "Notes", kind: "textarea" }],
        input: (values, requestKey) => {
          const out: Record<string, unknown> = { idempotencyKey: requestKey };
          for (const [field, value] of Object.entries(values)) if (String(value).trim()) out[field] = String(value).trim();
          return out;
        } })}>Record production</Button>}
      {can.decideQuality && <Button size="compact" variant="secondary" onPress={() => dialog({ action: "quality-decisions", text: "Quality decision recorded.", title: "Quality decision", confirm: "Record decision",
        fields: [{ name: "entryId", label: "Production entry", kind: "select", required: true, initial: pendingEntries[0]?.id ?? "",
          options: pendingEntries.map((row) => ({ value: row.id, label: `${row.number} · ${qty(row.pendingRemaining)} awaiting` })) },
          { name: "acceptedQuantity", label: "Accepted", kind: "quantity" }, { name: "rejectedQuantity", label: "Rejected", kind: "quantity" },
          { name: "rejectionReason", label: "Rejection reason", kind: "text" }, { name: "disposition", label: "Rejected output goes to", kind: "select", options: [{ value: "QUARANTINE", label: "Quarantine (decide later)" }, { value: "SCRAP", label: "Scrap" }, { value: "REWORK", label: "Rework" }] },
          { name: "reasonCode", label: "Reason code (e.g. ASSEMBLY_DEFECT)", kind: "text" },
          { name: "inspectionReference", label: "Inspection reference", kind: "text" }],
        input: (values, requestKey) => ({ idempotencyKey: requestKey, ...Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim())) }) })}>Quality decision</Button>}
      {can.receive && <Button size="compact" variant="secondary" onPress={() => router.push(`${FGR_BASE}/new?orderId=${order.id}`)}>Receive finished goods</Button>}
      {can.hold && <Button size="compact" variant="ghost" onPress={() => setAsk(holdAsk(order.id, { onDone: async () => { await refresh(); setMessage({ tone: "success", text: "Order on hold." }); } }))}>Hold</Button>}
      {order.status === "ON_HOLD" && can.resume && <Button size="compact" variant="ghost" onPress={() => setAsk(holdAsk(order.id, { adding: true, onDone: async () => { await refresh(); setMessage({ tone: "success", text: "Reason added to the hold." }); } }))}>Add hold reason</Button>}
      {can.resume && <Button size="compact" variant="primary" isLoading={busy} onPress={() => setAsk({ title: `Resume ${order.number}`, confirm: "Resume production", tone: "danger",
        description: "Every hold reason must be cleared by its own authority; materials and pending postings are checked again on the server. Open the hold for its readiness checks.",
        fields: [{ name: "note", label: "How the hold was resolved", kind: "textarea", required: true }],
        run: (values, requestKey) => perform(() => holdAction(order.id, "resume", { resolutionNotes: values.note, expectedMoVersion: order.version, idempotencyKey: requestKey }), "Production resumed.") })}>Resume</Button>}
      {can.complete && <Button size="compact" variant="primary" onPress={() => dialog({ action: "complete", text: short ? "Closed short." : "Order completed.", title: short ? "Close the order short" : "Complete the order", confirm: "Complete",
        description: short ? `Only ${qty(order.quantities.accepted)} of ${qty(order.quantities.planned)} accepted. The target stays ${qty(order.quantities.planned)}; give the reason (someone who may approve variances).`
          : "Everything is reconciled first: inspection, receipts, material in production and open requests.",
        fields: [...(short ? [{ name: "shortCloseReason", label: "Why the order closes short", kind: "textarea" as const, required: true }] : []),
          { name: "consumeRemaining", label: "Declare material still in production as used", kind: "checkbox" }],
        input: (values) => ({ expectedVersion: order.version, shortCloseReason: values.shortCloseReason || undefined, consumeRemaining: Boolean(values.consumeRemaining) }) })}>Complete</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => dialog({ action: "cancel", text: "Order cancelled.", title: "Cancel the order", confirm: "Cancel order", tone: "danger",
        description: "Reservations are given back. An order with material in production or output cannot be cancelled — return the material or close it short.",
        fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }], input: (values) => ({ reason: values.reason }) })}>Cancel</Button>}
      {can.export && <Button size="compact" variant="ghost" onPress={exportCsv}>Export CSV</Button>}
      <Button size="compact" variant="ghost" onPress={() => window.print()}>Print</Button>
    </div>
  );

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={MO_BASE}>Manufacturing Orders</Link>,
        title: `${order.number} · ${order.finishedItem.name}`,
        status: <StatusBadge tone={STATUS_TONE[order.status] ?? "neutral"}>{order.statusLabel}</StatusBadge>,
        fields: [
          { label: "Target", value: `${qty(order.quantities.planned)} ${order.finishedItem.baseUom ?? ""}` },
          { label: "Accepted", value: `${qty(order.quantities.accepted)} (${order.quantities.progressPct ?? "0"}%)` },
          { label: "Remaining", value: qty(order.quantities.remaining) },
          { label: "BOM", value: order.bom ? `${order.bom.number} rev ${order.bom.revisionNumber}` : "—" },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && (
          <Notice tone={message.tone}>
            {message.text}
            {message.blockers && message.blockers.length > 1 && <ul className="mt-1 list-disc pl-4">{message.blockers.map((row) => <li key={row}>{row}</li>)}</ul>}
          </Notice>
        )}
        {order.status === "ON_HOLD" && <Notice tone="warning">On hold ({order.reasons.holdCategory?.toLowerCase().replace(/_/g, " ")}): {order.reasons.hold}</Notice>}
        {order.reasons.returned && order.status === "DRAFT" && <Notice tone="warning">Sent back: {order.reasons.returned}</Notice>}
        {order.reasons.cancel && <Notice tone="neutral">Cancelled: {order.reasons.cancel}</Notice>}
        {order.reasons.shortClose && <Notice tone="neutral">Closed short: {order.reasons.shortClose}</Notice>}
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Order sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="materials">Materials</Tab>
            <Tab id="production">Production</Tab>
            <Tab id="quality">Quality</Tab>
            <Tab id="costs">Costs</Tab>
            <Tab id="history">Documents &amp; History</Tab>
          </TabList>
          <TabPanel id="overview"><div className="pt-4"><Overview order={order} /></div></TabPanel>
          <TabPanel id="materials"><div className="pt-4">
            <MaterialsPanel order={order} onLines={setLines} onAsk={setAsk} perform={perform} />
          </div></TabPanel>
          <TabPanel id="production"><div className="pt-4"><ProductionPanel order={order} onAsk={setAsk} perform={perform} /></div></TabPanel>
          <TabPanel id="quality"><div className="pt-4"><QualityPanel order={order} /></div></TabPanel>
          <TabPanel id="costs"><div className="pt-4"><CostsPanel order={order} /></div></TabPanel>
          <TabPanel id="history"><div className="pt-4"><HistoryPanel order={order} onAsk={setAsk} perform={perform} /></div></TabPanel>
        </Tabs>
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {lines && <MaterialLinesDialog mode={lines} materials={order.materials} onClose={() => setLines(null)}
        run={(rows, requestKey) => perform(() => orderAction(order.id, lines === "issue" ? "material-issues" : lines === "return" ? "material-returns" : "material-consumption",
          { lines: rows, idempotencyKey: requestKey }), lines === "issue" ? "Materials issued." : lines === "return" ? "Material returned." : "Material use recorded.")} />}
    </RecordDetailsPage>
  );
}

function Overview({ order }: { order: MoOrder }) {
  const q = order.quantities;
  return (
    <div className="flex flex-col gap-4">
      {order.status === "ON_HOLD" && <OrderHoldBanner orderId={order.id} />}
      <FactList items={[
        ["Planned", `${qty(q.planned)} ${order.finishedItem.baseUom ?? ""}${order.outputUom !== order.finishedItem.baseUom ? ` (${qty(order.plannedQuantity)} ${order.outputUom})` : ""}`],
        ["Reported", qty(q.reported)], ["Accepted", qty(q.accepted)], ["Rejected", qty(q.rejected)], ["Awaiting inspection", qty(q.pendingInspection)], ["Received into stock", qty(q.received)],
        ["Yield", q.yieldPct ? `${q.yieldPct}%` : "—"], ["Accepted limit", `${qty(q.outputLimit)}${Number(order.settings.overproductionTolerancePct) ? ` (+${order.settings.overproductionTolerancePct}%)` : ""}`],
        ["Materials", READINESS[order.progress.materials] ?? order.progress.materials],
      ]} />
      <FactList items={[
        ["Recipe", order.bom ? <Link className="text-brand underline" href={`${BOM_BASE}/${order.bom.id}?revision=${order.bom.revisionId}`}>{order.bom.number} rev {order.bom.revisionNumber}</Link> : "—"],
        ["Frozen", order.bom?.frozenAt ? `${formatDateTime(order.bom.frozenAt)} · ${order.bom.snapshotHash?.slice(0, 12)}…` : "At release"],
        ["Manufacturing location", order.warehouses.manufacturing.code], ["Materials from", order.warehouses.material.code], ["Finished goods to", order.warehouses.finishedGoods.code],
        ["Planned", `${formatDateTime(order.plannedStartAt)} → ${formatDateTime(order.plannedEndAt)}`], ["Started", order.actualStartAt ? formatDateTime(order.actualStartAt) : "—"],
        ["Completed", order.completedAt ? formatDateTime(order.completedAt) : "—"], ["Priority", order.priority.toLowerCase()],
        ["Demand", order.source.reference ?? order.source.type.toLowerCase().replace("_", " ")], ["Owner", order.owner ?? "—"],
        ["Parent order", order.parent ? <Link className="text-brand underline" href={`${MO_BASE}/${order.parent.id}`}>{order.parent.number}</Link> : "—"],
      ]} />
      {order.reasons.partialStart && <Notice tone="warning">Started with materials short: {order.reasons.partialStart}</Notice>}
      {order.notes && <Panel title="Production notes"><p className="whitespace-pre-wrap text-sm">{order.notes}</p></Panel>}
      {order.customerDemand.length > 0 && (
        <Panel title="Customer demand" description="Sales Order lines this order supplies. Output received is reserved for them; extra output stays unassigned stock.">
          <LinesTable columns={["Sales order", "Customer", "Required", { label: "Assigned", numeric: true }, { label: "Received", numeric: true }, { label: "Reserved", numeric: true }, "Status"]}>
            {order.customerDemand.map((row) => <tr key={row.allocationId}><Cell><Link className="text-brand underline" href={`/manufacturing/sales-demand/${row.demandId}`}>{row.salesOrder}</Link></Cell>
              <Cell>{row.customer}</Cell><Cell>{row.requiredDate ? formatDateTime(row.requiredDate) : "—"}</Cell><Cell numeric>{qty(row.assigned)}</Cell><Cell numeric>{qty(row.received)}</Cell>
              <Cell numeric>{qty(row.reserved)}</Cell><Cell>{row.status.toLowerCase().replace(/_/g, " ")}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
      {order.children.length > 0 && (
        <Panel title="Subassembly orders" description="Orders making what this one consumes.">
          <LinesTable columns={["Order", "Item", { label: "Planned", numeric: true }, { label: "Received", numeric: true }, "Status"]}>
            {order.children.map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.item}</Cell>
              <Cell numeric>{qty(row.planned)}</Cell><Cell numeric>{qty(row.received)}</Cell><Cell>{row.statusLabel}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

function MaterialsPanel({ order, onLines, onAsk, perform }: { order: MoOrder; onLines: (mode: LinesMode) => void; onAsk: (ask: Ask) => void; perform: (work: () => Promise<unknown>, text: string) => Promise<void> }) {
  const can = order.can;
  return (
    <div className="flex flex-col gap-4">
      <MaterialAvailabilityPanel orderId={order.id} onAsk={onAsk} perform={perform} />
      <div className="flex flex-wrap gap-2">
        {can.issue && <LinkButton size="compact" variant="secondary" href={`${MI_BASE}/new?orderId=${order.id}`}>New issue note</LinkButton>}
        {can.return && <Button size="compact" variant="secondary" onPress={() => onLines("return")}>Return unused</Button>}
        {can.recordConsumption && <LinkButton size="compact" variant="secondary" href={`${MC_BASE}/new?orderId=${order.id}`}>Record consumption</LinkButton>}
        {can.scrap && <LinkButton size="compact" variant="ghost" href={`${SCRAP_BASE}/new?orderId=${order.id}&type=ISSUED_MATERIAL`}>Scrap material</LinkButton>}
        {can.requestExtra && <Button size="compact" variant="ghost" onPress={() => onAsk({ title: "Request extra material", confirm: "Request",
          description: "Changes this order's plan once someone else approves it — never the BOM. For a lasting change, revise the BOM.",
          fields: [{ name: "materialId", label: "Material", kind: "select", required: true, options: order.materials.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` })) },
            { name: "quantity", label: "Extra quantity", kind: "quantity", required: true }, { name: "reason", label: "Why", kind: "textarea", required: true }],
          run: (values) => perform(() => orderAction(order.id, "material-variances", values), "Extra material requested.") })}>Request extra</Button>}
      </div>
      <LinesTable columns={["#", "Material", { label: "Required", numeric: true }, { label: "Reserved", numeric: true }, { label: "Net issued", numeric: true }, { label: "Used", numeric: true },
        { label: "Scrapped", numeric: true }, { label: "In production", numeric: true }, { label: "To issue", numeric: true }, { label: "Free", numeric: true }, { label: "Short", numeric: true }, ""]}>
        {order.materials.map((row) => (
          <tr key={row.id}>
            <Cell>{row.lineNumber}</Cell>
            <Cell><span className="flex flex-col"><span>{row.code} · {row.name}</span>
              <span className="text-xs text-text-muted">{row.uom}{row.kind === "SUBASSEMBLY" ? " · subassembly" : ""}{row.origin === "EXTRA" ? " · extra" : ""}{Number(row.extra) ? ` · +${qty(row.extra)} approved` : ""}
                {row.openDemand.length ? ` · demand ${row.openDemand.map((demand) => demand.number).join(", ")}` : ""}</span></span></Cell>
            <Cell numeric>{qty(row.required)}</Cell><Cell numeric>{qty(row.reserved)}</Cell><Cell numeric>{qty(row.netIssued)}</Cell><Cell numeric>{qty(row.consumed)}</Cell>
            <Cell numeric>{Number(row.scrapped) ? qty(row.scrapped) : ""}</Cell><Cell numeric>{qty(row.inCustody)}</Cell><Cell numeric>{qty(row.remainingToIssue)}</Cell><Cell numeric>{qty(row.availableToReserve)}</Cell>
            <Cell numeric>{Number(row.shortage) ? <StatusBadge tone="danger">{qty(row.shortage)}</StatusBadge> : ""}</Cell>
            <Cell>{row.kind === "SUBASSEMBLY" && can.createSubassemblyOrder && Number(row.remainingToIssue) > 0 && (
              <Button size="compact" variant="ghost" onPress={() => perform(() => orderAction(order.id, "subassembly-order", { materialId: row.id }), "Subassembly order created as a draft.").catch(() => undefined)}>Make it</Button>
            )}</Cell>
          </tr>
        ))}
      </LinesTable>
      <p className="text-xs text-text-muted">Reserved and free stock are Inventory’s (usable stock only: nothing held, quarantined, damaged or expired). Issued is what left the warehouse for production; used is what production says it used.</p>
      {order.variances.length > 0 && (
        <Panel title="Extra material">
          <LinesTable columns={["Material", { label: "Quantity", numeric: true }, "Reason", "Requested", "Status", ""]}>
            {order.variances.map((row) => (
              <tr key={row.id}><Cell>{row.code}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell><Cell>{row.requestedBy}, {formatDateTime(row.requestedAt)}</Cell>
                <Cell>{row.status.toLowerCase()}{row.decidedBy ? ` by ${row.decidedBy}` : ""}{row.note ? `: ${row.note}` : ""}</Cell>
                <Cell>{row.mayDecide && (
                  <span className="flex gap-2">
                    <Button size="compact" variant="primary" onPress={() => perform(() => decideVariance(order.id, row.id, "APPROVE"), "Extra material approved.").catch(() => undefined)}>Approve</Button>
                    <Button size="compact" variant="ghost" onPress={() => onAsk({ title: "Reject the request", confirm: "Reject", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
                      run: (values) => perform(() => decideVariance(order.id, row.id, "REJECT", String(values.note)), "Request rejected.") })}>Reject</Button>
                  </span>
                )}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {order.can.viewConsumption && <MaterialReconciliationPanel orderId={order.id} />}
      {order.can.viewConsumption && order.consumptionNotes.length > 0 && (
        <Panel title="Consumption notes" description="What production used, note by note, against the BOM.">
          <LinesTable columns={["Note", "Status", "Batch", { label: "Lines", numeric: true }, "Posted", ...(order.can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
            {order.consumptionNotes.map((row) => (
              <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MC_BASE}/${row.id}`}>{row.number}</Link>{row.kind === "CLOSING" ? " · closing" : ""}</Cell>
                <Cell>{row.status.toLowerCase().replace(/_/g, " ")}</Cell><Cell>{row.batchReference ?? ""}</Cell><Cell numeric>{row.lines}</Cell>
                <Cell>{row.postedAt ? `${formatDateTime(row.postedAt)}${row.postedBy ? ` · ${row.postedBy}` : ""}` : "—"}</Cell>
                {order.can.viewCost && <Cell numeric>{row.totalCost ? inr(row.totalCost) : ""}</Cell>}</tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {order.can.viewIssues && (
        <Panel title="Issue notes" description="Each issue to production as its own note: drafts, approvals and posted notes.">
          {order.issues.length ? (
            <LinesTable columns={["Note", "Status", { label: "Lines", numeric: true }, "Issued", ...(order.can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
              {order.issues.map((row) => (
                <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MI_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.status.toLowerCase().replace(/_/g, " ")}</Cell>
                  <Cell numeric>{row.lines}</Cell><Cell>{row.postedAt ? `${formatDateTime(row.postedAt)}${row.postedBy ? ` · ${row.postedBy}` : ""}` : "—"}</Cell>
                  {order.can.viewCost && <Cell numeric>{row.totalCost ? inr(row.totalCost) : ""}</Cell>}</tr>
              ))}
            </LinesTable>
          ) : <p className="text-sm text-text-muted">No issue notes yet.</p>}
        </Panel>
      )}
      <OrderScrapPanel orderId={order.id} type="ISSUED_MATERIAL" canRecord={can.scrap} />
      <OrderVariancePanel orderId={order.id} />
      <Panel title="Issues and returns">
        {order.movements.length ? (
          <LinesTable columns={["Document", "Material", { label: "Quantity", numeric: true }, "Batch", ...(order.can.viewCost ? [{ label: "Cost", numeric: true }] : []), "By", "When"]}>
            {order.movements.map((row) => (
              <tr key={row.id}><Cell>{row.number} · {row.direction === "ISSUE" ? "issue" : "return"}</Cell><Cell>{row.code}{row.reason ? ` · ${row.reason}` : ""}</Cell>
                <Cell numeric>{row.direction === "RETURN" ? "−" : ""}{qty(row.quantity)}</Cell><Cell>{row.allocations.map((part) => part.batch).filter(Boolean).join(", ")}</Cell>
                {order.can.viewCost && <Cell numeric>{inr(row.totalCost)}</Cell>}<Cell>{row.actor}</Cell><Cell>{formatDateTime(row.at)}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">Nothing issued yet.</p>}
      </Panel>
      {order.consumption.length > 0 && (
        <Panel title="Material use">
          <LinesTable columns={["Material", { label: "Used", numeric: true }, "Note", "By", "When"]}>
            {order.consumption.map((row) => <tr key={row.id}><Cell>{row.code}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.automatic ? "Declared used at completion" : row.note}</Cell>
              <Cell>{row.actor}</Cell><Cell>{formatDateTime(row.at)}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

function ProductionPanel({ order, onAsk, perform }: { order: MoOrder; onAsk: (ask: Ask) => void; perform: (work: () => Promise<unknown>, text: string) => Promise<void> }) {
  return (
    <div className="flex flex-col gap-4">
      <ProductionProgressPanel orderId={order.id} onAsk={onAsk} perform={perform} />
      <OrderReceiptsPanel order={order} />
      <OrderScrapPanel orderId={order.id} type="REJECTED_OUTPUT" canRecord={Number(order.quantities.rejected) > 0} />
    </div>
  );
}

function QualityPanel({ order }: { order: MoOrder }) {
  return <OrderQualityPanel orderId={order.id} />;
}

function CostsPanel({ order }: { order: MoOrder }) {
  return (
    <div className="flex flex-col gap-4">
      <OrderCostingPanel orderId={order.id} />
      <MaterialCostsPanel order={order} />
    </div>
  );
}

function MaterialCostsPanel({ order }: { order: MoOrder }) {
  const costs = order.costs;
  if (!costs) return <p className="text-sm text-text-muted">You may not see manufacturing cost.</p>;
  return (
    <div className="flex flex-col gap-4">
      <FactList items={[["Estimated material", inr(costs.estimatedMaterialCost)], ["Actual material (net issued)", inr(costs.actualMaterialCost)],
        ["Material cost variance", costs.materialCostVariance === null ? "—" : `${Number(costs.materialCostVariance) > 0 ? "+" : ""}${inr(costs.materialCostVariance)}`],
        ["Capitalised to finished goods", inr(costs.capitalisedToFinishedGoods)], ["Work in progress", inr(costs.workInProgress)], ["Variance closed at completion", inr(costs.varianceClosed)],
        ["Material cost per unit now", costs.currentUnitMaterialCost ? inr(costs.currentUnitMaterialCost) : `Unknown (${costs.unitCostMissing.join(", ")})`]]} />
      {!costs.estimateComplete && <Notice tone="warning">No estimate for {costs.estimateMissing.join(", ")}: the estimated total is incomplete.</Notice>}
      <p className="text-xs text-text-muted">{costs.note} Finished goods are valued at the recipe’s planned material per unit, priced at each material’s actual average issue cost; what remains in work in progress at completion goes to manufacturing variance.</p>
      <LinesTable columns={["Material", { label: "Planned", numeric: true }, { label: "Extra", numeric: true }, { label: "Net issued", numeric: true }, { label: "Used", numeric: true },
        { label: "Standard for accepted", numeric: true }, { label: "Usage variance", numeric: true }, { label: "Estimate", numeric: true }, { label: "Actual", numeric: true }, { label: "Cost variance", numeric: true }]}>
        {costs.lines.map((row) => (
          <tr key={row.id}><Cell>{row.code} · {row.name}</Cell><Cell numeric>{qty(row.planned)}</Cell><Cell numeric>{qty(row.extra)}</Cell><Cell numeric>{qty(row.netIssued)}</Cell><Cell numeric>{qty(row.consumed)}</Cell>
            <Cell numeric>{qty(row.standardForAccepted)}</Cell><Cell numeric>{qty(row.usageVariance)}</Cell><Cell numeric>{inr(row.estimatedCost)}</Cell><Cell numeric>{inr(row.actualCost)}</Cell>
            <Cell numeric>{inr(row.costVariance)}</Cell></tr>
        ))}
      </LinesTable>
    </div>
  );
}

function HistoryPanel({ order, onAsk, perform }: { order: MoOrder; onAsk: (ask: Ask) => void; perform: (work: () => Promise<unknown>, text: string) => Promise<void> }) {
  return (
    <div className="flex flex-col gap-4">
      <OrderHoldHistoryPanel orderId={order.id} />
      <Panel title="Exceptions" description="Open exceptions block completion until resolved.">
        {order.can.raiseException && <div><Button size="compact" variant="secondary" onPress={() => onAsk({ title: "Raise an exception", confirm: "Raise",
          fields: [{ name: "category", label: "Kind", kind: "select", required: true, initial: "OTHER", options: HOLD }, { name: "reason", label: "What happened", kind: "textarea", required: true }],
          run: (values) => perform(() => orderAction(order.id, "exceptions", values), "Exception raised.") })}>Raise exception</Button></div>}
        {order.exceptions.length ? (
          <LinesTable columns={["Kind", "Reason", "Raised", "Status", ""]}>
            {order.exceptions.map((row) => (
              <tr key={row.id}><Cell>{row.category.toLowerCase().replace(/_/g, " ")}</Cell><Cell>{row.reason}</Cell><Cell>{row.raisedBy}, {formatDateTime(row.raisedAt)}</Cell>
                <Cell>{row.status === "OPEN" ? <StatusBadge tone="warning">Open</StatusBadge> : `Resolved by ${row.resolvedBy}: ${row.resolution}`}</Cell>
                <Cell>{row.status === "OPEN" && order.can.raiseException && order.status !== "ON_HOLD" && (
                  <Button size="compact" variant="ghost" onPress={() => onAsk({ title: "Resolve the exception", confirm: "Resolve", fields: [{ name: "resolution", label: "How it was resolved", kind: "textarea", required: true }],
                    run: (values) => perform(() => resolveException(order.id, row.id, String(values.resolution)), "Exception resolved.") })}>Resolve</Button>
                )}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No exceptions.</p>}
      </Panel>
      <FactList items={[["Created", order.people.createdBy ? `${order.people.createdBy}, ${formatDateTime(order.people.createdAt)}` : "—"],
        ["Submitted", order.people.submittedBy ? `${order.people.submittedBy}, ${formatDateTime(order.people.submittedAt)}` : "—"],
        ["Approved", order.people.approvedBy ? `${order.people.approvedBy}, ${formatDateTime(order.people.approvedAt)}${order.people.approvalNote ? ` — ${order.people.approvalNote}` : ""}` : "—"],
        ["Released", order.people.releasedBy ? `${order.people.releasedBy}, ${formatDateTime(order.people.releasedAt)}` : "—"], ["Completed by", order.people.completedBy ?? "—"]]} />
      <HistoryList title="Timeline" entries={order.history.map((row) => ({ summary: ACTION_LABEL[row.action] ?? row.action, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
    </div>
  );
}
