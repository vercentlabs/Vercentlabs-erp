"use client";

// One item's stock: the summary (on hand, reserved, available, restricted, in transit, incoming, outgoing), then where it is and why: warehouses,
// locations and batches, the reservations, incoming and outgoing documents behind each figure, serial numbers and the recent movements that
// explain the balance. Nothing here changes stock; transfers and adjustments are their own workflows.
import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyState, ErrorState, LinkButton, RecordDetailsPage } from "@vercentlabs/design-system";

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

import { errorCode, errorMessage, getAvailability, getItemStock, type AvailabilityWarehouse, type ItemStock } from "../api/stock-balance-api";
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
// The item's stock position, read as the availability sum: on hand, less what is restricted and what is reserved, is available. Restrictions
// and the pipeline (in transit, incoming, outgoing) are grouped beneath it; zero figures stay quiet so the ones that matter stand out.
type Summary = NonNullable<ItemStock["summary"]>;
function StockPosition({ summary, q }: { summary: Summary | null; q: (value: number | null | undefined) => string }) {
  const restricted = summary?.restricted ?? 0;
  const available = summary?.available ?? 0;
  const onHand = summary?.onHand ?? 0;
  const headline = (label: string, value: number, caption: string, tone: "default" | "brand" | "warning" = "default") => (
    <div className={`flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-card)] p-4 ${tone === "brand" ? "bg-brand-soft" : tone === "warning" ? "bg-warning-soft" : "bg-surface-muted"}`}>
      <span className="text-xs font-medium tracking-wide text-text-secondary uppercase">{label}</span>
      <span className={`text-3xl font-semibold tabular-nums ${tone === "brand" ? "text-brand" : tone === "warning" ? "text-warning-emphasis" : "text-text"}`}>{q(value)}</span>
      <span className="text-xs text-text-muted">{caption}</span>
    </div>
  );
  const operator = (symbol: string) => <span aria-hidden="true" className="hidden self-center text-xl font-light text-text-muted md:block">{symbol}</span>;
  const row = (label: string, value: number, caption?: string, warn = false) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="flex min-w-0 flex-col"><span className="text-sm text-text">{label}</span>{caption && <span className="text-xs text-text-muted">{caption}</span>}</span>
      <span className={`shrink-0 text-sm tabular-nums ${value === 0 ? "text-text-muted" : warn ? "font-semibold text-warning-emphasis" : "font-semibold text-text"}`}>{q(value)}</span>
    </div>
  );
  return (
    <section aria-label="Stock position" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        {headline("On hand", onHand, "Physical stock in every warehouse")}
        {operator("−")}
        {headline("Restricted", restricted, restricted ? "Held, quarantined, damaged or expired" : "Nothing held back", restricted ? "warning" : "default")}
        {operator("−")}
        {headline("Reserved", summary?.reserved ?? 0, "Committed to orders")}
        {operator("=")}
        {headline("Available", available, available > 0 ? "Can be committed now" : onHand > 0 ? "Nothing free to commit" : "No stock", available > 0 ? "brand" : "warning")}
      </div>
      <div className="grid gap-x-8 gap-y-2 border-t border-border pt-3 md:grid-cols-2">
        <div className="flex flex-col divide-y divide-border">
          <span className="pb-1 text-xs font-medium tracking-wide text-text-secondary uppercase">Restricted stock</span>
          {row("Quality hold", summary?.qualityHold ?? 0, undefined, true)}
          {row("Quarantined", summary?.quarantined ?? 0, undefined, true)}
          {row("Damaged", summary?.damaged ?? 0, undefined, true)}
          {(summary?.expired ?? 0) > 0 && row("Expired", summary?.expired ?? 0, "Past its batch expiry", true)}
        </div>
        <div className="flex flex-col divide-y divide-border">
          <span className="pb-1 text-xs font-medium tracking-wide text-text-secondary uppercase">Pipeline · not on hand</span>
          {row("In transit", summary?.inTransit ?? 0, "Dispatched between warehouses")}
          {row("Incoming", summary?.incoming ?? 0, "Expected from purchase orders and transfers")}
          {row("Other outgoing", summary?.otherOutgoing ?? 0, "Planned beyond reservations")}
        </div>
      </div>
    </section>
  );
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
      <StockPosition summary={summary} q={q} />

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
