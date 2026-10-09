"use client";

// One item's stock: the summary (on hand, reserved, available, restricted, in transit, incoming, outgoing), then where it is and why: warehouses,
// locations and batches, the reservations, incoming and outgoing documents behind each figure, serial numbers and the recent movements that
// explain the balance. Nothing here changes stock; transfers and adjustments are their own workflows.
import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyState, ErrorState, LinkButton, MetricCard, RecordDetailsPage } from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getSummary, listAlerts } from "@/features/replenishment/api/replenishment-api";
import { AlertBadges } from "@/features/replenishment/screens/AlertsPanel";
import { ReorderStatusBadge } from "@/features/replenishment/screens/ReplenishmentScreen";

import { errorCode, errorMessage, getAvailability, getItemStock, type AvailabilityWarehouse } from "../api/stock-balance-api";
import { STOCK_BASE } from "./StockBalanceScreen";

const KIND_LABEL: Record<string, string> = {
  purchase_order: "Purchase order", transfer_in: "Transfer in (draft)", in_transit: "Transfer in transit", reservation: "Reserved", sales_order: "Sales order (not reserved)",
  transfer_out: "Transfer out (draft)", purchase_return: "Purchase return (draft)",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Panel title={title}>{children}</Panel>;
}
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="text-sm text-text-muted">None.</p>;
  return (
    <LinesTable columns={headers}>{rows.map((cells, index) => <tr key={index}>{cells.map((value, column) => <Cell key={column}>{value}</Cell>)}</tr>)}</LinesTable>
  );
}
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <MetricCard label={hint ? `${label} · ${hint}` : label} value={value} />;
}

export function ItemStockScreen({ itemId }: { itemId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "item", itemId), queryFn: () => getItemStock(itemId) });
  const availability = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "availability", itemId), queryFn: () => getAvailability(itemId) });
  if (query.isLoading) return <LoadingState label="Loading stock" rows={6} />;
  if (query.isError) return errorCode(query.error) === "STOCK_ITEM_NOT_FOUND"
    ? <EmptyState title="Item not found" description="It may belong to another workspace." action={{ label: "Stock balance", onPress: () => router.push(STOCK_BASE) }} />
    : <ErrorState title="Could not load the item's stock" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const stock = query.data!;
  const unit = stock.item.baseUom ?? "";
  const summary = stock.summary;
  const q = (value: number | null | undefined) => quantity(value ?? 0, unit);

  return (
    <RecordDetailsPage
      header={{
        title: <>{stock.item.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{stock.item.sku}</span></>,
        fields: [
          { label: "Base unit", value: unit || "Not set" },
          { label: "Tracking", value: stock.item.trackingType === "none" ? "None" : `${stock.item.trackingType.charAt(0).toUpperCase()}${stock.item.trackingType.slice(1)}` },
          { label: "On hand", value: q(summary?.onHand) },
          { label: "Available", value: q(summary?.available) },
        ],
        primaryAction: <LinkButton variant="secondary" href={`/inventory/items/${stock.item.id}`}>Open item</LinkButton>,
        secondaryActions: <MoreActions actions={[
          { id: "movements", label: "Movement history", run: () => router.push(`/inventory/transactions?tab=movements&itemId=${stock.item.id}`) },
          { id: "ledger", label: "Stock ledger", run: () => router.push(`/inventory/transactions?tab=ledger&itemId=${stock.item.id}`) },
          { id: "transfer", label: "Transfer stock", run: () => router.push(`/inventory/transfers/new?itemId=${stock.item.id}`) },
          { id: "adjust", label: "Adjust stock", run: () => router.push(`/inventory/adjustments/new?itemId=${stock.item.id}`) },
        ]} />,
      }}
      tabs={<div className="flex flex-col gap-3">
      {!stock.integrity.consistent && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          This item&apos;s balance does not match its ledger (ledger {q(stock.integrity.ledger)}, balance {q(stock.integrity.projection)}; reserved {q(stock.integrity.reserved)} vs
          reservations {q(stock.integrity.reservations)}{stock.integrity.serials !== null ? `; ${stock.integrity.serials} serials in stock` : ""}). Use Check balances on the Stock Balance page.
        </p>
      )}
      {stock.negative && stock.negative.positions > 0 && (
        <div role="alert" className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="font-semibold">NEGATIVE STOCK · {stock.negative.positions} position{stock.negative.positions === 1 ? "" : "s"} below zero ({q(-stock.negative.quantity)} in total)</p>
          {stock.negative.exceptions.map((entry) => (
            <p key={entry.id}>{entry.warehouse} / {entry.location}: on hand {q(entry.onHand)} since {formatDateTime(entry.since)}
              {entry.source ? ` · ${entry.source.number}` : entry.cause ? ` · ${entry.cause}` : ""}{entry.reasonCode ? ` · ${entry.reasonCode.replace(/_/g, " ").toLowerCase()}` : entry.origin === "reconciliation" ? " · no override found" : ""}
              {entry.overriddenBy ? ` · by ${entry.overriddenBy}` : ""}</p>
          ))}
          <div className="flex flex-wrap gap-3">
            <Link className="underline" href={`/inventory/negative-stock?itemId=${stock.item.id}`}>View cause</Link>
            <Link className="underline" href={`/inventory/transactions?tab=ledger&itemId=${stock.item.id}`}>View stock ledger</Link>
            <Link className="underline" href="/inventory/negative-stock">View open negative exceptions</Link>
          </div>
          <p className="text-xs">Only Available is clamped to zero; on hand shows the real balance until a receipt, return or transfer brings it back.</p>
        </div>
      )}
      </div>}
    >
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 lg:grid-cols-10">
        <Figure label="On hand" value={q(summary?.onHand)} />
        <Figure label="Reserved" value={q(summary?.reserved)} />
        <Figure label="Available" value={q(summary?.available)} hint="Eligible on hand − reserved" />
        <Figure label="Restricted" value={q(summary?.restricted)} hint={summary?.expired ? `${quantity(summary.expired)} expired` : undefined} />
        <Figure label="Quality hold" value={q(summary?.qualityHold)} />
        <Figure label="Quarantined" value={q(summary?.quarantined)} />
        <Figure label="Damaged" value={q(summary?.damaged)} />
        <Figure label="In transit" value={q(summary?.inTransit)} />
        <Figure label="Incoming" value={q(summary?.incoming)} hint="Expected, not on hand" />
        <Figure label="Other outgoing" value={q(summary?.otherOutgoing)} hint="Planned beyond reservations" />
      </div>

      <Section title="Available stock">
        <p className="text-xs text-text-muted">Available is what can be committed now: eligible on hand (not held, expired or blocked) less what is reserved. Incoming and in-transit stock is never available.</p>
        {availability.isLoading ? <LoadingState label="Working out availability" rows={2} /> : availability.data && (availability.data.warehouses.length
          ? <div className="grid gap-3 lg:grid-cols-2">{availability.data.warehouses.map((entry) => <AvailabilityStatement key={entry.warehouseId} entry={entry} unit={unit} />)}</div>
          : <p className="text-sm text-text-muted">No stock in any warehouse you can see.</p>)}
      </Section>
      <Section title="Warehouses">
        <Table headers={["Warehouse", "On hand", "Reserved", "Available", "Quality hold", "Quarantined", "Damaged", "Restricted", "Incoming", "In transit"]}
          rows={stock.warehouses.map((row) => [`${row.warehouseCode} · ${row.warehouseName}`, q(row.onHand), q(row.reserved), q(row.available),
            row.qualityHold ? <Link key="qh" className="text-brand hover:underline" href={`/inventory/quality-holds?itemId=${stock.item.id}`}>{q(row.qualityHold)}</Link> : q(0),
            row.quarantined ? <Link key="q" className="text-brand hover:underline" href={`/inventory/quality-holds?itemId=${stock.item.id}`}>{q(row.quarantined)}</Link> : q(0),
            q(row.damaged), q(row.restricted), q(row.incoming), q(row.inTransit)])} />
      </Section>
      <ReorderSection itemId={stock.item.id} />
      <Section title="Locations and batches">
        <Table headers={["Warehouse", "Location", "Batch", "Expiry", "On hand", "Reserved", "Available", "Restricted"]}
          rows={stock.positions.map((row) => [row.warehouseCode, row.locationCode, row.batchNumber, row.expiresOn?.slice(0, 10), q(row.onHand), q(row.reserved), q(row.available),
            row.restricted ? <span className="text-warning">{q(row.restricted)}</span> : q(0)])} />
      </Section>
      <Section title="Reservations">
        <Table headers={["Reservation", "Source", "Document", "Warehouse", "Location", "Batch", "Quantity", "Since"]}
          rows={stock.reservations.map((row) => [row.number, row.source.replace(/_/g, " "), row.document, row.warehouse, row.location, row.batch, q(row.quantity), formatDateTime(row.since)])} />
      </Section>
      <Section title="Incoming">
        <Table headers={["Source", "Document", "Warehouse", "Quantity", "Expected / dispatched"]}
          rows={stock.incoming.map((row) => [KIND_LABEL[row.kind] ?? row.kind, row.reference, row.warehouse, q(row.quantity), row.expected ? String(row.expected).slice(0, 10) : null])} />
      </Section>
      <Section title="Outgoing">
        <Table headers={["Source", "Document", "Warehouse", "Quantity"]} rows={stock.outgoing.map((row) => [KIND_LABEL[row.kind] ?? row.kind, row.reference, row.warehouse, q(row.quantity)])} />
      </Section>
      {stock.batches.length > 0 && (
        <Section title="Batches">
          <Table headers={["Batch", "Warehouse", "Expiry", "Status", "On hand", "Reserved", "Available"]}
            rows={stock.batches.map((row) => [row.batch, row.warehouse, row.expiresOn?.slice(0, 10), row.expired ? <Badge tone="danger">Expired</Badge> : row.status, q(row.onHand), q(row.reserved), q(row.available)])} />
        </Section>
      )}
      {stock.item.trackingType === "serial" && (
        <Section title={`Serial numbers in stock (${stock.serials.length})`}>
          <Table headers={["Serial", "Warehouse", "Location", "Batch"]} rows={stock.serials.map((row) => [row.serial, row.warehouse, row.location, row.batch])} />
        </Section>
      )}
      <Section title="Recent movements">
        <Table headers={["Effective", "Posted", "Movement", "Type", "Reference", "Warehouse", "Location", "Batch / Serial", "Quantity", "Balance"]}
          rows={stock.movements.map((row) => [formatDateTime(row.effectiveAt), formatDateTime(row.postedAt),
            <Link key="m" className="text-brand hover:underline" href={`/inventory/stock-ledger/${row.id}`}>{row.number}</Link>, row.type,
            row.sourceHref ? <Link key="s" className="text-brand hover:underline" href={row.sourceHref}>{row.source ?? "—"}</Link> : row.source ?? "—",
            row.warehouse, row.location, row.batch ?? "—", <span key="q" className={row.quantity < 0 ? "text-danger" : ""}>{row.quantity > 0 ? "+" : ""}{quantity(row.quantity)}</span>, q(row.balance)])} />
        <div><Button size="compact" variant="ghost" onPress={() => router.push(`/inventory/transactions?tab=ledger&itemId=${stock.item.id}`)}>Open the stock ledger</Button></div>
      </Section>
    </div>
    </RecordDetailsPage>
  );
}

// The availability statement of one warehouse: physical on hand, less each restriction, = eligible, less reservations, = available.
function AvailabilityStatement({ entry, unit }: { entry: AvailabilityWarehouse; unit: string }) {
  const line = (label: ReactNode, value: number, strong = false, sign = "") => (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-border pt-1 font-semibold" : ""}`}><span>{label}</span><span className="tabular-nums">{sign}{quantity(value, unit)}</span></div>
  );
  return (
    <div id={`available-${entry.warehouseCode}`} className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm">
      <p className="font-medium">{entry.warehouseCode} · {entry.warehouseName}</p>
      {line("Physical on hand", entry.onHand)}
      {entry.restrictions.map((restriction) => <div key={restriction.reason}>{line(<span>Less {restriction.label.toLowerCase()} <span className="text-xs text-text-muted">({restriction.positions.map((position) =>
        [position.location, position.batch].filter(Boolean).join(" / ")).join(", ")})</span></span>, restriction.quantity, false, "−")}</div>)}
      {line("Eligible on hand", entry.eligibleOnHand, true)}
      {line(<span>Less active reservations{entry.reservations.length ? <span className="text-xs text-text-muted"> ({entry.reservations.map((reservation) => `${reservation.document ?? reservation.number} ${quantity(reservation.quantity)}`).join(", ")})</span> : null}</span>, entry.reserved, false, "−")}
      {line("Available", entry.available, true)}
      {entry.allocatableSerials !== null && <p className="text-xs text-text-muted">{entry.allocatableSerials} serial number{entry.allocatableSerials === 1 ? "" : "s"} can be allocated.</p>}
      {entry.reservedOnRestricted > 0 && <p className="text-xs text-danger">{quantity(entry.reservedOnRestricted, unit)} is reserved on stock that is no longer eligible: release or reallocate it.</p>}
    </div>
  );
}

// Reorder Level per warehouse (shown to those who may see reorder levels): the planning position and its status, each opening its rule.
function ReorderSection({ itemId }: { itemId: string }) {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "summary", "item", itemId), queryFn: () => getSummary({ itemId }) });
  const alerts = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "alerts", "item", itemId), queryFn: () => listAlerts({ itemId, view: "active" }), retry: false });
  const rules = summary.data?.rules ?? [];
  const alertOf = (ruleId: string) => alerts.data?.rows.find((row) => row.ruleId === ruleId);
  if (!summary.data || !rules.length) return null;
  return (
    <Section title="Replenishment">
      <Table headers={["Warehouse", "Eligible", "Demand", "Incoming", "Projected", "Reorder level", "Target", "Suggested", "Status", "Alert"]}
        rows={rules.map((rule) => [rule.warehouse, quantity(rule.eligibleOnHand), quantity(rule.firmDemand), quantity(rule.firmIncoming), quantity(rule.projectedPosition),
          quantity(rule.reorderLevel), quantity(rule.targetLevel), rule.suggested > 0 ? quantity(rule.suggested, rule.baseUom ?? undefined) : "—",
          <Link key="s" href={`/inventory/replenishment/${rule.id}`} className="hover:underline"><ReorderStatusBadge rule={rule} /></Link>,
          (() => { const alert = alertOf(rule.id); return alert ? <Link key="a" href={`/inventory/replenishment/alerts/${alert.id}`} className="hover:underline"><AlertBadges alert={alert} /></Link> : "—"; })()])} />
    </Section>
  );
}
