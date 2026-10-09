"use client";

// One posting in full: what it was, its legs (from, to, disposition, units as entered and in base, the balance of the exact position after
// it), the document chain, the other postings of the same document (dispatch ↔ receipts, hold ↔ release, original ↔ reversal), the
// reservation it consumed, and — for those who may see cost — its valuation and journals. No edit: corrections are reversals.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, ErrorState, LinkButton, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MOVEMENTS_BASE, errorMessage, getAsOf, getEvent, type EventRow, type MovementRow } from "../api/movement-history-api";
import { Flags } from "./MovementHistoryScreen";

const Th = ({ children }: { children: React.ReactNode }) => <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>;

function EventLink({ event }: { event: EventRow }) {
  return <Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${event.id}`}>{event.label}</Link>;
}

export function MovementEventScreen({ groupId }: { groupId: string }) {
  const workspace = useWorkspaceContext();
  const params = useSearchParams();
  const focus = params.get("movement");
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "movement-history", "event", groupId), queryFn: () => getEvent(groupId) });
  if (detail.isLoading) return <LoadingState label="Loading the movement" rows={4} />;
  if (!detail.data) return <ErrorState title="Could not load the movement" description={errorMessage(detail.error)} />;
  const { event, legs, origin, related, reversalOf, reversedBy, transfer, reservations, finance, links, hiddenLegs } = detail.data;
  const cost = legs.some((leg) => leg.value !== undefined);
  return (
    <RecordDetailsPage
      header={{
        title: <>{event?.label ?? "Movement"}{event?.source.number && <span className="text-base font-normal whitespace-nowrap text-text-muted"> {event.source.number}</span>}</>,
        status: event ? (event.flags.length ? <Flags flags={event.flags} /> : <StatusBadge tone="success">Posted</StatusBadge>) : undefined,
        fields: event ? [
          { label: "Path", value: `${event.from} → ${event.to}` },
          { label: "Effective", value: formatDateTime(event.effectiveAt) },
          { label: "Posted", value: formatDateTime(event.postedAt) },
          { label: "Posted by", value: event.postedBy ?? "System" },
          ...(event.reason || origin?.reason ? [{ label: "Reason", value: event.reason ?? origin?.reason ?? "" }] : []),
          ...(origin?.party ? [{ label: "Party", value: origin.party }] : []),
          ...(origin?.reference ? [{ label: "Reference", value: origin.reference }] : []),
        ] : undefined,
        primaryAction: links.source ? <LinkButton variant="secondary" href={links.source}>Open {event?.source.label ?? "document"}</LinkButton> : undefined,
        secondaryActions: <LinkButton variant="outline" href={links.stockLedger}>Stock ledger</LinkButton>,
      }}
    >
    <div className="flex flex-col gap-4">

      {origin && origin.chain.length > 0 && <Panel title={<>Document chain</>}>
        <ol className="flex flex-wrap items-center gap-2 text-sm">{origin.chain.map((step, index) => (
          <li key={`${step.label}-${index}`} className="flex items-center gap-2">{index > 0 && <span aria-hidden className="text-text-muted">→</span>}
            <span className="text-text-muted">{step.label}</span><Link className="text-brand hover:underline" href={step.href}>{step.number ?? "open"}</Link></li>))}
          <li className="flex items-center gap-2"><span aria-hidden className="text-text-muted">→</span><span className="font-medium">this movement</span></li>
        </ol>
      </Panel>}

      <Panel title="Stock ledger legs">
        {hiddenLegs > 0 && <p className="text-sm text-text-muted">{hiddenLegs} leg{hiddenLegs === 1 ? "" : "s"} in warehouses you cannot see {hiddenLegs === 1 ? "is" : "are"} not shown.</p>}
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr><Th>Movement</Th><Th>Type</Th><Th>Item</Th><Th>From</Th><Th>To</Th><Th>Qty (base)</Th><Th>As entered</Th><Th>Batch / Serial</Th>
              <Th>Position after</Th><Th>Warehouse after</Th>{cost && <><Th>Unit cost</Th><Th>Value</Th></>}<Th>Stock as of</Th></tr></thead>
            <tbody className="divide-y divide-border">{legs.map((leg) => <Leg key={leg.id} leg={leg} cost={cost} focused={leg.id === focus} />)}</tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted">Quantities are signed in the item&apos;s base unit. Internal moves net to zero: on hand does not change, only where the stock is or whether it is available.</p>
      </Panel>

      {transfer && <Panel title={<>Transfer {transfer.number} · {transfer.from} → {transfer.to}</>}>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Fact label="Requested" value={quantity(transfer.requested)} /><Fact label="Dispatched" value={quantity(transfer.dispatched)} />
          <Fact label="Received" value={quantity(transfer.received)} /><Fact label="Lost" value={quantity(transfer.lost)} /><Fact label="In transit" value={quantity(transfer.inTransit)} />
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-sm">{transfer.events.map((entry) => (
          <li key={entry.id}>{formatDateTime(entry.postedAt)} · <EventLink event={entry} /> · {quantity(entry.quantity, entry.uom)}{entry.id === groupId && <span className="text-text-muted"> (this)</span>}</li>))}</ul>
      </Panel>}

      {(reversalOf || reversedBy || related.length > 0) && <Panel title={<>Related movements</>}>
        <ul className="flex flex-col gap-1 text-sm">
          {reversalOf && <li>Reverses <EventLink event={reversalOf} /> of {formatDate(reversalOf.effectiveAt)}</li>}
          {reversedBy && <li>Reversed by <EventLink event={reversedBy} /> on {formatDate(reversedBy.postedAt)}</li>}
          {!transfer && related.filter((entry) => entry.id !== reversalOf?.id && entry.id !== reversedBy?.id).map((entry) => (
            <li key={entry.id}>{formatDateTime(entry.postedAt)} · <EventLink event={entry} /> · {entry.from} → {entry.to}{entry.quantity !== null ? ` · ${quantity(entry.quantity, entry.uom)}` : ""}</li>))}
        </ul>
      </Panel>}

      {reservations.length > 0 && <Panel title={<>Reservation consumed</>}>
        <p className="mb-1 text-xs text-text-muted">A reservation is not a movement: it committed stock earlier, and this posting used it.</p>
        <ul className="text-sm">{reservations.map((entry) => <li key={entry.id}><Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link> · {quantity(entry.quantity)}</li>)}</ul>
      </Panel>}

      {finance && <Panel title={<>Valuation and finance</>}>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {finance.value !== null && <Fact label="Value" value={money(finance.value)} />}
          <Fact label="Valuation" value={finance.valuationStatus === "valued" ? "Valued" : <Badge tone="warning">Exception: no valuation</Badge>} />
          <Fact label="Finance" value={finance.financeStatus === "posted" ? "Journal posted" : finance.financeStatus === "not_posted" ? <Badge tone="warning">Journal not posted</Badge> : "No journal for this movement"} />
          {finance.value !== null && <Fact label="Valuation detail" value={<Link className="text-brand hover:underline" href={finance.valuationHref}>Open valuation</Link>} />}
        </div>
        {finance.journals && finance.journals.length > 0 && <ul className="mt-3 text-sm">{finance.journals.map((journal) => (
          <li key={journal.id}><Link className="text-brand hover:underline" href={journal.href}>{journal.number}</Link> · {formatDate(journal.date)} · {journal.status}</li>))}</ul>}
      </Panel>}
    </div>
    </RecordDetailsPage>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-xs text-text-muted">{label}</p><div>{value}</div></div>;
}

function Leg({ leg, cost, focused }: { leg: MovementRow; cost: boolean; focused: boolean }) {
  const workspace = useWorkspaceContext();
  const asOf = useQuery({ queryKey: scopedQueryKey(workspace, "movement-history", "as-of", leg.id), queryFn: () => getAsOf({ movementId: leg.id, warehouseId: leg.warehouseId }), enabled: false });
  return (
    <tr className={focused ? "bg-brand-soft/40" : undefined}>
      <Cell className="whitespace-nowrap">{leg.number}<Flags flags={leg.flags} /></Cell>
      <Cell>{leg.typeLabel}</Cell>
      <Cell>{leg.sku}<span className="block text-xs text-text-muted">{leg.itemName}</span></Cell>
      <Cell>{leg.from}</Cell>
      <Cell>{leg.to}</Cell>
      <Cell className={`whitespace-nowrap tabular-nums ${leg.quantity > 0 ? "text-success" : "text-danger"}`}>{leg.quantity > 0 ? "+" : ""}{quantity(leg.quantity, leg.baseUom)}</Cell>
      <Cell className="whitespace-nowrap">{leg.entered ? `${quantity(leg.entered.quantity, leg.entered.uom)}${leg.entered.uom !== leg.baseUom ? ` (1 ${leg.entered.uom} = ${leg.entered.conversion} ${leg.baseUom})` : ""}` : "—"}</Cell>
      <Cell>{leg.serial ?? leg.batch ?? "—"}</Cell>
      <Cell className="tabular-nums">{quantity(leg.positionAfter)}</Cell>
      <Cell className="tabular-nums">{quantity(leg.warehouseAfter)}</Cell>
      {cost && <><Cell className="tabular-nums">{leg.unitCost === null || leg.unitCost === undefined ? "—" : money(leg.unitCost)}</Cell><Cell className="tabular-nums">{money(leg.value)}</Cell></>}
      <Cell className="whitespace-nowrap">{asOf.data
        ? <span className="text-xs">{quantity(asOf.data.onHand)} on hand · {quantity(asOf.data.available)} available{asOf.data.qualityHold ? ` · ${quantity(asOf.data.qualityHold)} on hold` : ""}{asOf.data.quarantined ? ` · ${quantity(asOf.data.quarantined)} quarantined` : ""}{asOf.data.damaged ? ` · ${quantity(asOf.data.damaged)} damaged` : ""}</span>
        : <Button size="compact" variant="ghost" isLoading={asOf.isFetching} onPress={() => void asOf.refetch()}>Show</Button>}</Cell>
    </tr>
  );
}
