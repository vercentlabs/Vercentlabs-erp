"use client";

// An order's production costing (its Costs tab): the planned baseline against what was actually spent, where the money is now (in production
// custody, used and not yet in finished goods, capitalised, written off), the cost per accepted unit, variances, receipts with the labor and
// overhead they carried, the rates frozen for the order and what each has applied, the batches that earn batch overhead, applications (and
// approved reversals), adjustments, the check against Finance and the history. Every figure comes from posted records; none
// can be typed over.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { COSTING_STATUS_LABEL, COSTING_STATUS_TONE, applyPreview, confirmBatchSetup, costingAction, decideAdjustment, orderCosting, type RateLine, type RateView } from "../api/costing-api";

const money = (value: string | null | undefined) => (value === null || value === undefined ? "—" : inr(value));
const rateValue = (rate: { basis: string; rate: string }) => (rate.basis === "PCT_OF_MATERIAL" ? `${rate.rate}%` : inr(rate.rate));
const rateText = (rate: RateView, enabled: boolean) => (!enabled ? "Not enabled" : !rate || "missing" in rate ? "Enabled — no rate set" : `${rate.basisLabel} · ${rateValue(rate)} (v${rate.version})`);
const overheadText = (rates: RateLine[] | null, enabled: boolean) => (!enabled ? "Not enabled" : !rates?.length ? "Enabled — no rate set"
  : rates.map((rate) => `${rate.category ?? rate.name} ${rateValue(rate)}${rate.basis === "PER_BATCH" ? " a batch" : rate.basis === "PER_GOOD_UNIT" ? " a unit" : ""}`).join(" · "));

export function OrderCostingPanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-costing", orderId), queryFn: () => orderCosting(orderId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isError && errorStatus(query.error) === 403) return null;
  if (query.isLoading) return <p className="text-sm text-text-muted">Calculating production cost…</p>;
  if (query.isError || !query.data) return <Notice tone="danger">{errorMessage(query.error)}</Notice>;
  const view = query.data;
  const can = view.can;
  const refresh = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); setMessage({ tone: "success", text }); };
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try { await work(); await refresh(text); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const pendingTotal = view.pending.filter((row) => Number(row.amount) > 0);
  const overApplied = view.rates.filter((row) => Number(row.overApplied) > 0);
  // Applying shows what it would post first, then posts exactly that (refused if production changed meanwhile).
  const openApply = async () => {
    setBusy(true);
    try {
      const preview = await applyPreview(orderId);
      const lines = preview.lines.filter((row) => row.direction === "APPLY");
      setAsk({ title: "Apply labor and overhead", confirm: "Apply", description: `${lines.map((row) => `${row.category ?? (row.component === "LABOR" ? "Direct labor" : "Overhead")}: ${inr(row.amount)}${row.basis === "PER_BATCH" ? " (one batch)" : row.basis === "PER_GOOD_UNIT" ? ` (${qty(row.quantity)} unit(s))` : ""}`).join("; ")}. ${preview.effect}; the applied accounts are credited.`,
        fields: [], run: async () => { await costingAction(orderId, "apply-costs", { expectedMoVersion: preview.orderVersion }); await refresh("Labor and overhead applied."); } });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const d = view.dispositions;
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Panel title="Production cost" description={view.policy.modelLabel}
        actions={<span className="flex flex-wrap items-center gap-2"><StatusBadge tone={COSTING_STATUS_TONE[view.costingStatus]}>{COSTING_STATUS_LABEL[view.costingStatus]}</StatusBadge>
          {can.apply && <Button size="compact" variant="primary" isLoading={busy} onPress={openApply}>Apply costs</Button>}
          {can.reverse && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Take back over-applied cost", confirm: "Take back", tone: "danger",
            description: `Output was corrected below what was applied: ${overApplied.map((row) => `${row.category ?? row.name ?? "Labor"} ${inr(row.overApplied)}`).join(", ")}. A linked reversal posts each back out of work in progress; the original applications stay.`,
            fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
            run: async (values) => { await costingAction(orderId, "apply-costs", { includeReversals: true, reason: values.reason }); await refresh("Over-applied cost taken back."); } })}>Take back over-applied</Button>}
          {can.estimate && <Button size="compact" variant="ghost" isLoading={busy} onPress={() => run(() => costingAction(orderId, "estimate"), "Re-estimated (a new version; the baseline stays).")}>Re-estimate</Button>}
          {can.reconcile && <Button size="compact" variant="ghost" isLoading={busy} onPress={() => run(() => costingAction(orderId, "reconcile", {}), "Checked against Finance.")}>Reconcile</Button>}
          {can.adjust && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Request a cost adjustment", confirm: "Request", tone: "danger",
            description: "Moves value between this order's work in progress and manufacturing variance once someone else approves it. The original postings stay as they were.",
            fields: [{ name: "direction", label: "Direction", kind: "select", required: true, initial: "WIP_TO_VARIANCE", options: [{ value: "WIP_TO_VARIANCE", label: "Write off from work in progress to variance" },
              { value: "VARIANCE_TO_WIP", label: "Bring back into work in progress" }] }, { name: "amount", label: "Amount (₹)", kind: "quantity", required: true },
              { name: "reason", label: "Why", kind: "textarea", required: true }, { name: "evidence", label: "Evidence", kind: "text" }],
            run: async (values, requestKey) => { await costingAction(orderId, "adjustments", { direction: values.direction, amount: values.amount, reason: values.reason, evidence: values.evidence || undefined, idempotencyKey: requestKey }); await refresh("Adjustment requested."); } })}>Adjust</Button>}
          {can.finalize && view.finalization.problems.length === 0 && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => costingAction(orderId, "finalize", {}), "Costing finalized.")}>Finalize</Button>}</span>}>
        {view.reconciliation.status !== "BALANCED" && <Notice tone="danger">{view.reconciliation.status === "RECOVERY_REQUIRED" ? `${view.reconciliation.pendingRecovery} posting(s) need recovery before the cost can be trusted.`
          : `Finance holds ${inr(view.reconciliation.finance)} of work in progress for this order; the order says ${inr(view.reconciliation.book)} (difference ${inr(view.reconciliation.difference)}).`}</Notice>}
        {!view.actual.valuationComplete && <Notice tone="warning">Some consumption has no Inventory valuation: actual cost is incomplete, never taken as zero.</Notice>}
        {pendingTotal.length > 0 && <Notice tone="neutral">Due and not yet applied: {pendingTotal.map((row) => `${row.category ?? row.componentLabel} ${money(row.amount)}`).join(", ")}. A finished-goods receipt applies it first.</Notice>}
        {overApplied.length > 0 && <Notice tone="warning">Over-applied after an output correction: {overApplied.map((row) => `${row.category ?? row.name ?? "Labor"} ${inr(row.overApplied)}`).join(", ")}. It is taken back only by an approved reversal.</Notice>}
        {view.policy.frozenLate && <Notice tone="warning">This order&apos;s rates were frozen after release — the rates in force when its costs were first applied.</Notice>}
        {view.policy.invalidRates.length > 0 && <Notice tone="danger">Not applied (a different unit than the product&apos;s): {view.policy.invalidRates.join(", ")}.</Notice>}
        {view.pending.some((row) => row.missingRate) && <Notice tone="danger">A cost component is enabled without a rate: set it in Production Costing.</Notice>}
        <div className="grid gap-3 sm:grid-cols-4">
          {[["Planned", view.planned.total, view.planned.unit ? `${inr(view.planned.unit)} a unit` : null], ["Incurred", view.actual.incurred, view.unit.actualPerAccepted ? `${inr(view.unit.actualPerAccepted)} per accepted unit` : view.unit.note],
            ["In finished goods", d.capitalised, `${qty(view.quantities.received)} received`], ["Work in progress", d.wip, `${money(d.wipMaterialInCustody)} still in production custody`]].map(([label, value, note]) => (
            <div key={label} className="rounded-md border border-border p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold">{money(value)}</p>{note && <p className="text-xs text-text-muted">{note}</p>}</div>
          ))}
        </div>
        <LinesTable columns={["", { label: "Planned", numeric: true }, { label: "Actual", numeric: true }, { label: "Variance", numeric: true }]}>
          <tr><Cell>Material</Cell><Cell numeric>{money(view.planned.material)}</Cell><Cell numeric>{money(view.variances.material.actual)}</Cell><Cell numeric>{money(view.variances.material.total)}</Cell></tr>
          <tr><Cell>Labor <span className="text-xs text-text-muted">({rateText(view.policy.labor, view.policy.laborEnabled)})</span></Cell><Cell numeric>{view.policy.laborEnabled ? money(view.planned.labor) : "Not enabled"}</Cell>
            <Cell numeric>{view.actual.labor === null ? "Not enabled" : money(view.actual.labor)}</Cell><Cell numeric>{view.variances.labor ? money(view.variances.labor.variance) : ""}</Cell></tr>
          <tr><Cell>Overhead <span className="text-xs text-text-muted">({overheadText(view.policy.overhead, view.policy.overheadEnabled)})</span></Cell><Cell numeric>{view.policy.overheadEnabled ? money(view.planned.overhead) : "Not enabled"}</Cell>
            <Cell numeric>{view.actual.overhead === null ? "Not enabled" : money(view.actual.overhead)}</Cell><Cell numeric>{view.variances.overhead ? money(view.variances.overhead.variance) : ""}</Cell></tr>
          <tr><Cell><span className="font-medium">Total</span></Cell><Cell numeric>{money(view.planned.total)}</Cell><Cell numeric>{money(view.actual.incurred)}</Cell>
            <Cell numeric>{view.variances.againstPlan ? `${money(view.variances.againstPlan.variance)}${view.variances.againstPlan.pct ? ` (${view.variances.againstPlan.pct}%)` : ""}` : "—"}</Cell></tr>
        </LinesTable>
        <p className="text-xs text-text-muted">{view.planned.source}. {view.variances.againstPlan?.note ?? ""} {view.variances.againstEquivalent ? `Against the plan for the output actually produced: expected ${money(view.variances.againstEquivalent.expected)}, actual ${money(view.variances.againstEquivalent.actual)}, variance ${money(view.variances.againstEquivalent.variance)}.` : ""}
          {" "}Material variance: usage {money(view.variances.material.usage)}, price {money(view.variances.material.price)} — {view.variances.material.note}</p>
      </Panel>
      {view.rates.length > 0 && (
        <Panel title="Rates for this order" description="Frozen when the order was released: a later rate change does not touch it. Each eligible activity is charged once.">
          <LinesTable columns={["Rate", "Applied by", { label: "Rate", numeric: true }, { label: "Applied", numeric: true }, { label: "Due", numeric: true }, { label: "Over-applied", numeric: true }]}>
            {view.rates.map((row) => (
              <tr key={row.id}><Cell>{row.category ?? "Direct labor"} <span className="text-xs text-text-muted">{row.code} v{row.version}{row.productSpecific ? " · this product's own" : " · company default"}</span></Cell>
                <Cell>{row.basisLabel}{row.batchesCharged !== null ? ` · ${row.batchesCharged} batch(es)` : ""}</Cell><Cell numeric>{rateValue(row)}</Cell><Cell numeric>{inr(row.applied)}</Cell>
                <Cell numeric>{Number(row.due) ? inr(row.due) : ""}</Cell><Cell numeric>{Number(row.overApplied) ? inr(row.overApplied) : ""}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {view.batches.length > 0 && view.rates.some((row) => row.basis === "PER_BATCH") && (
        <Panel title="Batches" description="A batch earns its batch overhead once its setup is confirmed or output is reported in it. An empty draft batch earns nothing.">
          <LinesTable columns={["Batch", { label: "Reported entries", numeric: true }, "Setup", ""]}>
            {view.batches.map((row) => (
              <tr key={row.id}><Cell>{row.reference}</Cell><Cell numeric>{row.reported}</Cell><Cell>{row.setupConfirmedAt ? `Confirmed ${formatDateTime(row.setupConfirmedAt)}` : row.eligible ? "Output reported" : "Not confirmed"}</Cell>
                <Cell>{row.mayConfirm && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => confirmBatchSetup(orderId, row.id), `${row.reference}: setup confirmed.`)}>Confirm setup</Button>}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      <Panel title="Work in progress" description="Every movement of this order's work in progress, as Finance holds it.">
        <FactList items={[["Added (material issued, labor and overhead applied)", money(view.rollForward.added)], ["To finished goods", money(view.rollForward.toFinishedGoods)],
          ["Scrap and abnormal loss", money(view.rollForward.scrapAndLoss)], ["Closed to variance and adjustments", money(view.rollForward.toVariance)], ["Closing", money(view.rollForward.closing)],
          ["Finance", `${inr(view.reconciliation.finance)} · ${view.reconciliation.entries} journal(s) · ${view.reconciliation.status.toLowerCase().replace(/_/g, " ")}`]]} />
      </Panel>
      <Panel title="Material" description="Valued by Inventory at issue. Issued but unused material stays in production custody; it is returned, used or scrapped — never counted twice.">
        <LinesTable columns={["Material", { label: "Issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped", numeric: true }, { label: "In production", numeric: true },
          ...(can.viewDetail ? [{ label: "Average cost", numeric: true }] : []), { label: "Used cost", numeric: true }, { label: "In production value", numeric: true }]}>
          {view.materials.map((row) => (
            <tr key={row.materialId}><Cell>{row.code} · {row.name}</Cell><Cell numeric>{qty(row.issued)}</Cell><Cell numeric>{qty(row.consumed)}</Cell><Cell numeric>{Number(row.scrapped) ? qty(row.scrapped) : ""}</Cell>
              <Cell numeric>{qty(row.inCustody)} {row.uom}</Cell>{can.viewDetail && <Cell numeric>{row.averageCost ? inr(row.averageCost) : "—"}</Cell>}<Cell numeric>{money(row.usedCost)}</Cell><Cell numeric>{money(row.custodyCost)}</Cell></tr>
          ))}
        </LinesTable>
      </Panel>
      {view.receipts.length > 0 && (
        <Panel title="Finished goods" description={view.policy.receiptAllocation}>
          <LinesTable columns={["Receipt", { label: "Quantity", numeric: true }, { label: "Material", numeric: true }, { label: "Labor & overhead", numeric: true }, { label: "Total", numeric: true }, { label: "Per unit", numeric: true }, "Received"]}>
            {view.receipts.map((row) => (
              <tr key={row.id}><Cell>{row.number}{row.reversed ? <span className="text-xs text-text-muted"> · {money(row.reversed)} reversed</span> : null}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell numeric>{money(row.material)}</Cell>
                <Cell numeric>{money(row.conversion)}</Cell><Cell numeric>{money(row.total)}</Cell><Cell numeric>{inr(row.unitCost)}</Cell><Cell>{formatDateTime(row.at)}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {view.applications.length > 0 && (
        <Panel title="Labor and overhead applied">
          <LinesTable columns={["Component", "For", ...(can.viewDetail ? [{ label: "Rate", numeric: true }] : []), { label: "Amount", numeric: true }, "Applied"]}>
            {view.applications.map((row) => (
              <tr key={row.id}><Cell>{row.category ?? row.componentLabel}{row.direction === "REVERSE" ? <span className="text-xs text-text-muted"> · reversal: {row.reason}</span> : null}</Cell><Cell>{row.basis === "PER_BATCH" ? `Batch ${row.batch ?? ""}` : row.basis === "PER_GOOD_UNIT" ? `${qty(row.quantity)} accepted unit(s)` : `${inr(row.quantity)} consumed material`}</Cell>
                {can.viewDetail && <Cell numeric>{row.rate ? `${row.basis === "PCT_OF_MATERIAL" ? `${row.rate}%` : inr(row.rate)} v${row.rateVersion}` : ""}</Cell>}<Cell numeric>{row.direction === "REVERSE" ? `−${money(row.amount)}` : money(row.amount)}</Cell><Cell>{row.by}, {formatDateTime(row.at)}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {view.adjustments.length > 0 && (
        <Panel title="Cost adjustments">
          <LinesTable columns={["Adjustment", "Direction", { label: "Amount", numeric: true }, "Why", "Status", ""]}>
            {view.adjustments.map((row) => (
              <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.direction === "WIP_TO_VARIANCE" ? "To variance" : "Back to work in progress"}</Cell><Cell numeric>{money(row.amount)}</Cell><Cell>{row.reason}</Cell>
                <Cell>{row.status.toLowerCase()}{row.decidedBy ? ` · ${row.decidedBy}` : ""}</Cell>
                <Cell>{row.mayDecide && <span className="flex gap-1">
                  <Button size="compact" variant="primary" isDisabled={busy} onPress={() => run(() => decideAdjustment(row.id, "APPROVE"), "Adjustment posted.")}>Approve</Button>
                  <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reject the adjustment", confirm: "Reject", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
                    run: async (values) => { await decideAdjustment(row.id, "REJECT", String(values.note)); await refresh("Adjustment rejected."); } })}>Reject</Button></span>}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {!view.finalization.finalizedAt && view.finalization.problems.length > 0 && ["COMPLETED", "CANCELLED"].includes(view.orderStatus) && (
        <Notice tone="warning">The costing cannot be finalized yet: {view.finalization.problems.map((row) => row.message).join(" ")}</Notice>
      )}
      <HistoryList title="Cost history" entries={view.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: [row.amount ? inr(row.amount) : null, row.summary].filter(Boolean).join(" · ") || undefined }))} />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
