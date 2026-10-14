"use client";

// One customer demand: what the Sales Order line needs, what covers it (each unit once: stock reserved, production in progress, drafts
// proposed, output received and waiting to be reserved), what is still uncovered, and the warnings. From here a planner creates a draft
// manufacturing order (reviewing quantity, dates, BOM and materials first), assigns an existing order's free output, releases or reassigns
// supply, reserves received goods for the order, and sets the product's manufacturing policy.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { MO_BASE, errorMessage, errorStatus, newKey, qty } from "@/features/manufacturing/orders/api/mo-api";
import {
  DEMAND_BASE, DEMAND_TONE, allocateSupply, createFromDemand, getDemand, listDemand, previewDemand, reassignAllocation, releaseAllocation, reserveForSales, setItemPolicy, type DemandDetail, type DemandPreview,
} from "../api/demand-api";

const local = (iso: string) => { const date = new Date(iso); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
const ACTION_LABEL: Record<string, string> = { DETECTED: "Demand detected", SOURCE_AMENDED: "Sales Order amended", STATUS_CHANGED: "Status changed", ALLOCATED: "Supply assigned",
  ALLOCATION_STATUS: "Supply status", ALLOCATION_RELEASED: "Supply released", REASSIGNED_IN: "Supply reassigned here", OUTPUT_RECEIVED: "Output received", RESERVED_FOR_SALES: "Reserved for the order",
  RESERVATION_FAILED: "Reservation failed", CANCELLED: "Demand cancelled" };

export function SalesDemandDetailScreen({ demandId }: { demandId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "sales-demand", demandId);
  const query = useQuery({ queryKey: key, queryFn: () => getDemand(demandId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [planning, setPlanning] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the demand" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to manufacturing demand" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the demand" description={errorMessage(query.error)} />;
  }
  const demand = query.data;
  const qt = demand.quantities;
  const unit = demand.item.baseUom ?? "";
  const perform = async (work: () => Promise<unknown>, text: string) => {
    try {
      const result = await work() as DemandDetail | { demand?: DemandDetail } | undefined;
      if (result && "quantities" in result) queryClient.setQueryData(key, result);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      setMessage({ tone: "success", text });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); throw failure; }
  };
  const reservable = Number(qt.readyToAllocate) > 0 || (demand.policy.supplyPolicy === "MAKE_TO_STOCK" && Number(qt.freeStock) > 0);
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {demand.can.createOrder && Number(qt.plannable) > 0 && <Button size="compact" variant="primary" onPress={() => setPlanning(true)}>Create manufacturing order</Button>}
      {demand.can.reserve && reservable && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reserve stock for the order", confirm: "Reserve",
        description: "Reserved through Sales and Inventory — received output for this demand first. Nothing is claimed until Inventory confirms it.",
        fields: [{ name: "quantity", label: `Quantity (${unit})`, kind: "quantity", initial: Number(qt.readyToAllocate) > 0 ? qt.readyToAllocate : String(Math.min(Number(qt.freeStock), Number(qt.outstanding) - Number(qt.reservedStock))) }],
        run: (values, requestKey) => perform(() => reserveForSales(demand.id, { quantity: values.quantity || undefined, idempotencyKey: requestKey }), "Reserved for the order.") })}>Reserve for the order</Button>}
      {demand.can.setPolicy && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Manufacturing policy · ${demand.item.code}`, confirm: "Save",
        fields: [{ name: "supplyPolicy", label: "Supply policy", kind: "select", required: true, initial: demand.policy.supplyPolicy,
          options: [{ value: "MAKE_TO_ORDER", label: "Make to order (produce for each customer demand)" }, { value: "MAKE_TO_STOCK", label: "Make to stock (use free stock first)" }] },
          { name: "leadTimeDays", label: "Production lead time (days)", kind: "quantity", initial: demand.policy.leadTimeDays === null ? "" : String(demand.policy.leadTimeDays) },
          { name: "minimumBatchQuantity", label: "Minimum batch", kind: "quantity", initial: demand.policy.minimumBatch ?? "" },
          { name: "quantityIncrement", label: "Quantity increment", kind: "quantity", initial: demand.policy.increment ?? "" }],
        run: (values) => perform(async () => { await setItemPolicy(demand.item.id, { supplyPolicy: values.supplyPolicy, leadTimeDays: values.leadTimeDays === "" ? null : Number(values.leadTimeDays),
          minimumBatchQuantity: values.minimumBatchQuantity || null, quantityIncrement: values.quantityIncrement || null }); return getDemand(demand.id); }, "Policy saved.") })}>Product policy</Button>}
    </div>
  );
  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={DEMAND_BASE}>Sales Demand</Link>,
        title: `${demand.salesOrder.number} · ${demand.item.name}`,
        status: <StatusBadge tone={DEMAND_TONE[demand.status] ?? "neutral"}>{demand.statusLabel}</StatusBadge>,
        fields: [
          { label: "Customer", value: demand.salesOrder.customer ?? "—" }, { label: "Outstanding", value: `${qty(qt.outstanding)} ${unit}` },
          { label: "Uncovered", value: `${qty(qt.uncovered)} ${unit}` }, { label: "Required", value: demand.requiredDate ? formatDate(demand.requiredDate) : "—" },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {demand.exception && <Notice tone="warning">{demand.exception}</Notice>}
        {demand.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
        <Panel title="Coverage" description="Each unit is counted once: stock reserved for the order, production in progress, then drafts. Drafts are proposals, not committed supply.">
          <FactList items={[["Ordered", qty(qt.ordered)], ["Cancelled", qty(qt.cancelled)], ["Delivered", qty(qt.delivered)], ["Outstanding", qty(qt.outstanding)],
            ["Stock reserved for the order", qty(qt.reservedStock)], ["In production (released orders, not yet received)", qty(qt.inProduction)], ["Proposed in drafts", qty(qt.proposed)],
            ["Received, waiting to be reserved", qty(qt.readyToAllocate)], ["Uncovered", qty(qt.uncovered)], ["Free stock in the warehouse", qty(qt.freeStock)],
            ["Recommended to make", qty(qt.recommended)], ["Still plannable", qty(qt.plannable)]]} />
          <p className="text-xs text-text-muted">
            Policy: {demand.policy.supplyPolicy === "MAKE_TO_STOCK" ? "make to stock (free stock counts before new production)" : "make to order"}
            {demand.policy.leadTimeDays !== null ? ` · lead time ${demand.policy.leadTimeDays} day(s)` : ""}{demand.policy.minimumBatch ? ` · minimum batch ${qty(demand.policy.minimumBatch)}` : ""}
            {demand.policy.increment ? ` · in steps of ${qty(demand.policy.increment)}` : ""}. Sales Order version {demand.salesOrder.versionNumber}, line {demand.line.sequence}.
          </p>
        </Panel>
        {planning && <PlanPanel demand={demand} onClose={() => setPlanning(false)} />}
        <Panel title="Manufacturing orders assigned">
          {demand.allocations.length ? (
            <LinesTable columns={["Order", "Status", { label: "Assigned", numeric: true }, { label: "Received", numeric: true }, { label: "Reserved", numeric: true }, { label: "Still to come", numeric: true }, "Due", ""]}>
              {demand.allocations.map((row) => (
                <tr key={row.id}>
                  <Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}`}>{row.orderNumber}</Link><span className="block text-xs text-text-muted">{row.orderStatus.toLowerCase().replace(/_/g, " ")}</span></Cell>
                  <Cell><StatusBadge tone={row.status === "EXCEPTION" ? "danger" : row.status === "RELEASED" ? "neutral" : "info"}>{row.status.toLowerCase().replace(/_/g, " ")}</StatusBadge>
                    {row.releaseReason && <span className="block text-xs text-text-muted">{row.releaseReason}</span>}{row.exception && <span className="block text-xs text-danger">{row.exception}</span>}</Cell>
                  <Cell numeric>{qty(row.allocated)}</Cell><Cell numeric>{qty(row.received)}</Cell><Cell numeric>{qty(row.reserved)}</Cell><Cell numeric>{qty(row.open)}</Cell>
                  <Cell>{formatDate(row.plannedEndAt)}</Cell>
                  <Cell>{row.status !== "RELEASED" && Number(row.allocated) > Number(row.received) && (
                    <span className="flex gap-2">
                      {demand.can.release && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Release ${row.orderNumber}'s supply`, confirm: "Release",
                        description: "Gives back output not yet received; received goods stay where they are.",
                        fields: [{ name: "quantity", label: "Quantity (empty for all not received)", kind: "quantity" }, { name: "reason", label: "Why", kind: "textarea", required: true }],
                        run: (values) => perform(() => releaseAllocation(row.id, String(values.reason), values.quantity ? String(values.quantity) : undefined), "Supply released.") })}>Release</Button>}
                      {demand.can.reallocate && <ReassignButton allocationId={row.id} demand={demand} onAsk={setAsk} perform={perform} max={String(Number(row.allocated) - Number(row.received))} />}
                    </span>
                  )}</Cell>
                </tr>
              ))}
            </LinesTable>
          ) : <p className="text-sm text-text-muted">No manufacturing order covers this demand yet.</p>}
        </Panel>
        {demand.can.allocate && demand.candidateOrders.length > 0 && Number(qt.plannable) > 0 && (
          <Panel title="Existing orders with unassigned output" description="Same product, into the same warehouse. Assign what this demand still needs.">
            <LinesTable columns={["Order", "Status", { label: "Unassigned", numeric: true }, "Due", ""]}>
              {demand.candidateOrders.map((row) => (
                <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.status.toLowerCase().replace(/_/g, " ")}</Cell>
                  <Cell numeric>{qty(row.unassigned)}</Cell><Cell>{formatDate(row.plannedEndAt)}</Cell>
                  <Cell><Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Assign ${row.number}`, confirm: "Assign",
                    fields: [{ name: "quantity", label: `Quantity (${unit})`, kind: "quantity", required: true, initial: String(Math.min(Number(row.unassigned), Number(qt.plannable))) }],
                    run: (values, requestKey) => perform(() => allocateSupply({ demandId: demand.id, manufacturingOrderId: row.id, quantity: values.quantity, idempotencyKey: requestKey }), "Supply assigned.") })}>Assign</Button></Cell></tr>
              ))}
            </LinesTable>
          </Panel>
        )}
        <HistoryList title="History" entries={demand.history.map((row) => ({ summary: `${ACTION_LABEL[row.action] ?? row.action}${row.order ? ` · ${row.order}` : ""}`, at: row.at, actor: row.actor,
          detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

function ReassignButton({ allocationId, demand, onAsk, perform, max }: { allocationId: string; demand: DemandDetail; onAsk: (ask: Ask) => void; perform: (work: () => Promise<unknown>, text: string) => Promise<void>; max: string }) {
  const workspace = useWorkspaceContext();
  const others = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "sales-demand", "reassign", demand.item.id), queryFn: () => listDemand({ status: "OPEN", itemId: demand.item.id }) });
  const targets = (others.data?.demands ?? []).filter((row) => row.id !== demand.id && row.warehouseId === demand.warehouseId && Number(row.quantities.plannable) > 0);
  return (
    <Button size="compact" variant="ghost" isDisabled={!targets.length} onPress={() => onAsk({ title: "Reassign to another order", confirm: "Reassign",
      description: "Moves output not yet received to another customer line of the same product and warehouse.",
      fields: [{ name: "toDemandId", label: "To", kind: "select", required: true, options: targets.map((row) => ({ value: row.id, label: `${row.salesOrder.number} · ${row.salesOrder.customer ?? ""} · plannable ${qty(row.quantities.plannable)}` })) },
        { name: "quantity", label: "Quantity", kind: "quantity", required: true, initial: max }, { name: "reason", label: "Why", kind: "textarea", required: true }],
      run: (values) => perform(async () => (await reassignAllocation(allocationId, values)).from, "Supply reassigned.") })}>Reassign</Button>
  );
}

// The guided creation: review the recommendation, choose quantity and dates, check BOM and materials, then create the draft.
function PlanPanel({ demand, onClose }: { demand: DemandDetail; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(Number(demand.quantities.recommended) > 0 ? demand.quantities.recommended : demand.quantities.plannable);
  const [start, setStart] = useState(() => local(new Date(Date.now() + 3_600_000).toISOString()));
  const [end, setEnd] = useState(() => local(new Date(Date.now() + Math.max(demand.policy.leadTimeDays ?? 1, 1) * 86_400_000).toISOString()));
  const [preview, setPreview] = useState<DemandPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const assigned = String(Math.min(Number(quantity) || 0, Number(demand.quantities.plannable)));
  const check = async () => {
    setBusy(true); setError(null);
    try { setPreview(await previewDemand({ demandIds: [demand.id], quantity, plannedStartAt: new Date(start).toISOString(), plannedEndAt: new Date(end).toISOString() })); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const made = await createFromDemand({ lines: [{ demandId: demand.id, quantity: assigned }], plannedQuantity: quantity, plannedStartAt: new Date(start).toISOString(), plannedEndAt: new Date(end).toISOString(),
        expectedVersions: { [demand.id]: demand.salesOrder.versionNumber }, expectedPlannable: { [demand.id]: demand.quantities.plannable }, idempotencyKey: key });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.push(`${MO_BASE}/${made.order.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <Panel title="Create a manufacturing order" description="1 Review demand · 2 existing supply · 3 quantity and dates · 4 materials and BOM · 5 create the draft. The draft reserves nothing; it is approved and released like any order."
      actions={<Button size="compact" variant="ghost" onPress={onClose}>Close</Button>}>
      <FactList items={[["Outstanding", qty(demand.quantities.outstanding)], ["Covered by stock and production", qty(String(Number(demand.quantities.reservedStock) + Number(demand.quantities.inProduction)))],
        ["Already proposed in drafts", qty(demand.quantities.proposed)], ["Recommended", qty(demand.quantities.recommended)], ["May be assigned", qty(demand.quantities.plannable)]]} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={`Quantity to make (${demand.item.baseUom ?? ""})`} inputMode="decimal" className="w-40" value={quantity} onChange={(value) => { setQuantity(value); setPreview(null); }}
          description={Number(quantity) > Number(demand.quantities.plannable) ? `${qty(demand.quantities.plannable)} is assigned to this order line; the rest is made for stock.` : undefined} />
        <TextField label="Planned start" type="datetime-local" value={start} onChange={(value) => { setStart(value); setPreview(null); }} />
        <TextField label="Planned completion" type="datetime-local" value={end} onChange={(value) => { setEnd(value); setPreview(null); }} />
        <Button variant="secondary" isLoading={busy} onPress={check}>Check materials</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!(Number(quantity) > 0)} onPress={create}>Create draft</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {preview && (
        <div className="flex flex-col gap-2">
          {preview.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
          {preview.materialError && <Notice tone="danger">{preview.materialError}</Notice>}
          {preview.materials && (
            <>
              <p className="text-sm">{preview.materials.bom.number} rev {preview.materials.bom.revisionNumber}{preview.materials.estimatedMaterialCost ? ` · estimated material ₹${Number(preview.materials.estimatedMaterialCost).toLocaleString("en-IN")}` : ""}</p>
              <LinesTable columns={["Material", { label: "Required", numeric: true }, { label: "Free", numeric: true }, { label: "Short", numeric: true }]}>
                {preview.materials.materials.map((row) => <tr key={row.id}><Cell>{row.code} · {row.name}</Cell><Cell numeric>{qty(row.required)} {row.uom}</Cell><Cell numeric>{qty(row.availableToReserve)}</Cell>
                  <Cell numeric>{Number(row.shortage) ? <StatusBadge tone="danger">{qty(row.shortage)}</StatusBadge> : ""}</Cell></tr>)}
              </LinesTable>
            </>
          )}
          <p className="text-xs text-text-muted">Checked {formatDateTime(new Date().toISOString())}. A completion date is a plan, not a delivery promise.</p>
        </div>
      )}
    </Panel>
  );
}
