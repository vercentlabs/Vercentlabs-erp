"use client";

// One low-stock alert: what it is (condition, severity, since when), the live figures that explain it — eligible on hand − firm demand =
// current, + firm incoming = projected, against the reorder level and target (shortfall to reorder and suggestion to target, with the order
// multiple) — what was detected when it opened, the demand and incoming behind it, other warehouses' stock, and its history. Acknowledge it
// or act on it (a draft purchase order or transfer); it resolves by itself when the stock condition clears.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorState, LinkButton, RecordDetailsPage } from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { ALERTS_BASE, REPLENISHMENT_BASE, acknowledgeAlert, errorMessage, getAlert, type AlertDetail, type RuleDetail } from "../api/replenishment-api";
import { AlertBadges, age } from "./AlertsPanel";
import { PurchaseDialog, TransferDialog } from "./ReorderRuleScreen";


export function LowStockAlertScreen({ alertId }: { alertId: string }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "alert", alertId), queryFn: () => getAlert(alertId) });
  const [dialog, setDialog] = useState<null | "purchase" | "transfer">(null);
  const acknowledge = useMutation({ mutationFn: () => acknowledgeAlert(alertId), onSuccess: () => void client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "replenishment") }) });
  if (detail.isLoading) return <LoadingState label="Loading the alert" rows={4} />;
  if (!detail.data) return <ErrorState title="Could not load the alert" description={errorMessage(detail.error)} />;
  const { alert, rule, demand, incoming, otherWarehouses, history, occurrences, capabilities: can } = detail.data;
  const uom = alert.baseUom ?? undefined;
  const live = alert.live;
  const resolved = alert.status === "resolved";
  const ruleDetail = rule ? ({ rule, demand, incoming, otherWarehouses, supplier: detail.data.supplier, history: [], capabilities: {} } as unknown as RuleDetail) : null;
  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{alert.sku} <span className="text-base font-normal whitespace-nowrap text-text-muted">{alert.warehouse}</span></>,
        status: <AlertBadges alert={alert} />,
        fields: [
          { label: "Item", value: alert.itemName },
          { label: "Warehouse", value: alert.warehouseName },
          { label: "Since", value: `${formatDateTime(alert.conditionSince)} (${age(alert.firstDetectedAt)})` },
          ...(live ? [{ label: "Suggested", value: live.suggested > 0 ? quantity(live.suggested, uom) : "Nothing" }] : []),
        ],
        primaryAction: !resolved && can.purchaseDraft && ruleDetail && live && live.suggested > 0 ? <Button variant="primary" onPress={() => setDialog("purchase")}>Create purchase order</Button> : undefined,
        secondaryActions: (
          <>
            {!resolved && can.acknowledge && alert.status === "open" && <Button variant="secondary" isLoading={acknowledge.isPending} onPress={() => acknowledge.mutate()}>Acknowledge</Button>}
            {!resolved && can.transferDraft && ruleDetail && <Button variant="secondary" onPress={() => setDialog("transfer")}>Create transfer</Button>}
            {rule && <LinkButton variant="outline" href={`${REPLENISHMENT_BASE}/${rule.id}`}>{can.editRule ? "Edit reorder rule" : "Reorder rule"}</LinkButton>}
          </>
        ),
      }}
      tabs={acknowledge.isError ? <Notice>{errorMessage(acknowledge.error)}</Notice> : undefined}
    >
    <div className="flex flex-col gap-4">

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <AlertBadges alert={alert} />
          <span className="text-text-muted">Occurrence {alert.occurrence} · first detected {formatDateTime(alert.firstDetectedAt)} ({age(alert.firstDetectedAt)} ago) · this condition since {formatDateTime(alert.conditionSince)}</span>
          {alert.acknowledgedAt && <span className="text-text-muted">Acknowledged by {alert.acknowledgedBy ?? "someone"} {formatDateTime(alert.acknowledgedAt)} — the stock condition is unchanged.</span>}
          {resolved && <span>Resolved {alert.resolvedAt ? formatDateTime(alert.resolvedAt) : ""}: {alert.resolutionLabel}</span>}
        </div>
        {alert.negativeStock && <p className="mb-2 text-sm text-danger">Negative stock: the warehouse has issued more than it holds. Repair it through <Link className="underline" href="/inventory/negative-stock">Negative Stock</Link> — the suggestion already includes the deficit.</p>}
        {alert.overdueIncoming && <p className="mb-2 text-sm text-warning">Coverage relies on incoming stock that is overdue — check the documents below.</p>}
        {live ? <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Figure label="Eligible on hand" value={quantity(live.eligibleOnHand, uom)} />
            <Figure label="− Firm demand" value={quantity(live.firmDemand, uom)} />
            <Figure label="= Current position" value={quantity(live.currentPosition, uom)} strong />
            <Figure label="+ Firm incoming" value={quantity(live.firmIncoming, uom)} hint={live.nextIncoming ? `Next expected ${formatDate(live.nextIncoming)}` : undefined} />
            <Figure label="= Projected position" value={quantity(live.projectedPosition, uom)} strong />
            <Figure label="Reorder level" value={quantity(live.reorderLevel, uom)} />
            <Figure label="Target stock level" value={quantity(live.targetLevel, uom)} />
            <Figure label="Shortfall to reorder level" value={quantity(live.shortfallToReorder, uom)} />
          </dl>
          <p className="mt-3 text-sm">{live.suggested > 0
            ? <>Suggested replenishment: <strong>{quantity(live.suggested, uom)}</strong> (target {quantity(live.targetLevel)} − projected {quantity(live.projectedPosition)} = {quantity(live.rawSuggested)}{live.orderMultiple ? `, rounded up to a multiple of ${quantity(live.orderMultiple)}` : ""}).</>
            : alert.condition === "out_of_stock" ? <>No eligible stock now, but confirmed incoming already covers the requirement: additional suggested quantity 0. Monitor the incoming documents.</>
            : <>Low, but confirmed incoming lifts the projected position above the reorder level: no additional replenishment. Monitor the incoming documents.</>}</p>
          <p className="mt-1 text-xs text-text-muted">Live figures from the reorder calculation (recalculated now). Reservations are part of their orders&apos; demand, never counted twice.</p>
        </> : <p className="text-sm text-text-muted">This occurrence has resolved; below are the figures it was detected with.</p>}
        <details className="mt-3 text-sm" open={!live}>
          <summary className="cursor-pointer text-text-muted">At detection ({formatDateTime(alert.firstDetectedAt)})</summary>
          <p className="mt-1">Eligible {quantity(alert.detected.eligibleOnHand)} · demand {quantity(alert.detected.firmDemand)} · current {quantity(alert.detected.currentPosition)} · incoming {quantity(alert.detected.firmIncoming)}
            {" "}· projected {quantity(alert.detected.projectedPosition)} · reorder {quantity(alert.detected.reorderLevel)} · target {quantity(alert.detected.targetLevel)} · suggested {quantity(alert.detected.suggested, uom)}</p>
        </details>
      </Panel>

      {demand && <Breakdown title="Demand sources" empty="No confirmed sales orders or transfers out are waiting on this warehouse."
        rows={demand.map((row) => ({ key: `${row.kind}-${row.id}`, href: row.href, number: row.number, what: row.kind === "sales_order" ? "Sales order" : `Transfer to ${row.destination}`,
          quantity: quantity(row.quantity, uom), when: row.date ? formatDate(row.date) : "—" }))} />}
      {incoming && <Breakdown title="Incoming sources" empty="Nothing confirmed is on its way. Draft purchase orders and transfers never count."
        rows={incoming.map((row) => ({ key: `${row.kind}-${row.id}`, href: row.href, number: row.number, what: row.kind === "purchase_order" ? row.supplier ?? "Purchase order" : `From ${row.source}`,
          quantity: quantity(row.quantity, uom), when: row.expected ? formatDate(row.expected) : "—", overdue: row.overdue }))} />}
      {otherWarehouses && <Panel title={<>Other warehouse stock</>}>
        <p className="text-xs text-text-muted">Advisory: it never resolves this alert; move it with a transfer.</p>
        {otherWarehouses.length === 0 ? <p className="text-sm text-text-muted">No other warehouse has this item available.</p>
          : <ul className="text-sm">{otherWarehouses.map((row) => <li key={row.warehouseId}>{row.warehouse} · {row.warehouseName}: {quantity(row.available, uom)} available</li>)}</ul>}
      </Panel>}

      {history && <Panel title={<>History</>}>
        <ul className="flex flex-col gap-1 text-sm">{history.map((entry, index) => (
          <li key={`${entry.at}-${index}`}><span className="text-text-muted">{formatDateTime(entry.at)}</span> · {describe(entry)}{entry.by ? ` · ${entry.by}` : ""}</li>))}</ul>
      </Panel>}
      {occurrences.length > 1 && <Panel title={<>Occurrences</>}>
        <ul className="text-sm">{occurrences.map((entry) => (
          <li key={entry.id}>{entry.id === alert.id ? <strong>#{entry.occurrence}</strong> : <Link className="text-brand hover:underline" href={`${ALERTS_BASE}/${entry.id}`}>#{entry.occurrence}</Link>}
            {" "}· {formatDate(entry.from)}–{entry.to ? formatDate(entry.to) : "now"}{entry.resolution ? ` · ${entry.resolution}` : ""}</li>))}</ul>
      </Panel>}
    </div>
    </RecordDetailsPage>
      {dialog === "purchase" && ruleDetail && <PurchaseDialog detail={ruleDetail} onClose={() => setDialog(null)} />}
      {dialog === "transfer" && ruleDetail && <TransferDialog detail={ruleDetail} onClose={() => setDialog(null)} />}
    </>
  );
}

function describe(entry: AlertDetail["history"] extends Array<infer T> | null ? T : never) {
  if (entry.kind === "action") {
    if (entry.type === "acknowledged") return `Acknowledged${entry.notes ? `: ${entry.notes}` : ""}`;
    if (entry.type === "rule_updated") return "Reorder rule changed";
    const label = entry.type === "purchase_draft_created" ? "Draft purchase order" : "Draft transfer";
    return <>{label} {entry.document ? <Link className="text-brand hover:underline" href={entry.document.href}>{entry.document.number ?? "opened"}</Link> : null}{entry.quantity ? ` for ${quantity(entry.quantity)}` : ""}</>;
  }
  switch (entry.type) {
    case "opened": return `Opened: ${entry.to}`;
    case "reopened": return `Opened again: ${entry.to}`;
    case "escalated": return `Escalated: ${entry.from} → ${entry.to}`;
    case "deescalated": return `De-escalated: ${entry.from} → ${entry.to}`;
    case "acknowledged": return null;
    case "resolved": return `Resolved: ${entry.reason ?? "the condition cleared"}`;
    default: return entry.type;
  }
}

function Figure({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return <div><dt className="text-xs text-text-muted">{label}</dt><dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>{hint && <dd className="text-xs text-text-muted">{hint}</dd>}</div>;
}

function Breakdown({ title, empty, rows }: { title: string; empty: string; rows: Array<{ key: string; href: string; number: string; what: string; quantity: string; when: string; overdue?: boolean }> }) {
  return (
    <Panel title={<>{title}</>}>
      {rows.length === 0 ? <p className="text-sm text-text-muted">{empty}</p> : (
        <ul className="text-sm">{rows.map((row) => (
          <li key={row.key}><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link> · {row.what} · {row.quantity} · {row.when}{row.overdue && <> <Badge tone="warning">Overdue</Badge></>}</li>))}</ul>)}
    </Panel>
  );
}
