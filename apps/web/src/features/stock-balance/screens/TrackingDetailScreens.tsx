"use client";

// Batch and serial detail. A batch: its item, expiry and status, its stock wherever it is (by warehouse, location and disposition — on hand,
// reserved, available, quality hold, quarantined), the reservations and quality holds on it and its movement trail. A serial number,
// identity first: the item, its current state and position, its source receipt, reservation and holds, then its whole journey. Actions open
// their own workflows with the batch or serial chosen.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, ErrorState, MetricCard, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import type { MovementRow } from "@/features/movement-history/api/movement-history-api";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { PropertyList } from "@/shared/ui/PropertyList";
import { Cell, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Position = { warehouseId: string; warehouse: string; locationId: string | null; location: string; disposition: string; onHand: number; reserved: number; available: number; restricted: boolean };
type Reservation = { id: string; number: string; quantity: number; source: string; warehouse: string; href: string };
type Hold = { id: string; number: string; type: string; status: string; held: number; href: string };
type Actions = { transfer: boolean; hold: boolean; goodsIssue: boolean; purchaseReturn: boolean };
type BatchDetail = {
  batch: { id: string; batchNumber: string; itemId: string; sku: string; itemName: string; baseUom: string | null; status: string; manufacturedOn: string | null; expiresOn: string | null; expired: boolean; notes: string | null };
  totals: { onHand: number; reserved: number; available: number; qualityHold: number; quarantined: number; damaged: number };
  positions: Position[]; reservations: Reservation[] | null; holds: Hold[] | null; movements: MovementRow[] | null; actions: Actions;
};
type SerialDetail = {
  serial: { id: string; serialNumber: string; itemId: string; sku: string; itemName: string; batch: string | null; batchId: string | null; status: string; inStock: boolean;
    warehouseId: string | null; warehouse: string | null; location: string | null; disposition: string | null; missingSince: string | null };
  source: { type: string; number: string | null; href: string | null; at: string } | null;
  reservations: Reservation[] | null; holds: Hold[] | null; movements: MovementRow[] | null; actions: Actions;
};

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload.detail as T;
}
const DISPOSITION: Record<string, string> = { available: "Available", quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged" };
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");

// The workflows a batch or serial number starts (each opens with it chosen), as the record's More actions.
function useActionMenu(actions: Actions, scope: string) {
  const router = useRouter();
  return [
    { id: "transfer", label: "Transfer", show: actions.transfer, run: () => router.push(`/inventory/transfers/new?${scope}`) },
    { id: "hold", label: "Place on hold", show: actions.hold, run: () => router.push(`/inventory/quality-holds/new?${scope}`) },
    { id: "issue", label: "Goods issue", show: actions.goodsIssue, run: () => router.push(`/inventory/goods-issues/new?${scope}`) },
    { id: "return", label: "Purchase return", show: actions.purchaseReturn, run: () => router.push("/procurement/purchase-returns/new") },
  ];
}

export function BatchDetailScreen({ batchId }: { batchId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "batch", batchId), queryFn: () => read<BatchDetail>(`/api/inventory/tracking/batches/${batchId}`) });
  const menu = useActionMenu(query.data?.actions ?? { transfer: false, hold: false, goodsIssue: false, purchaseReturn: false },
    query.data ? `itemId=${query.data.batch.itemId}&batchId=${query.data.batch.id}` : "");
  if (query.isLoading) return <LoadingState label="Loading the batch" rows={6} />;
  if (!query.data) return <ErrorState title="Could not load the batch" description={query.error instanceof Error ? query.error.message : ""} />;
  const { batch, totals, positions, reservations, holds, movements } = query.data;
  const uom = batch.baseUom ?? undefined;
  const scope = `itemId=${batch.itemId}&batchId=${batch.id}`;
  return (
    <RecordDetailsPage
      header={{
        title: <>Batch {batch.batchNumber} <span className="text-base font-normal text-text-muted">{batch.sku} · {batch.itemName}</span></>,
        status: batch.expired ? <StatusBadge tone="danger">Expired</StatusBadge> : <StatusBadge tone={batch.status === "active" ? "success" : "warning"}>{capital(batch.status)}</StatusBadge>,
        fields: [
          { label: "Expires", value: batch.expiresOn ? formatDate(batch.expiresOn) : "No expiry" },
          { label: "Manufactured", value: batch.manufacturedOn ? formatDate(batch.manufacturedOn) : "Not recorded" },
          { label: "Item", value: <Link className="hover:underline" href={`/inventory/items/${batch.itemId}`}>{batch.sku}</Link> },
        ],
        secondaryActions: <MoreActions actions={menu} />,
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard label="On hand" value={quantity(totals.onHand, uom)} />
          <MetricCard label="Available" value={quantity(totals.available, uom)} />
          <MetricCard label="Reserved" value={quantity(totals.reserved, uom)} />
          <MetricCard label="Quality hold" value={quantity(totals.qualityHold, uom)} />
          <MetricCard label="Quarantined" value={quantity(totals.quarantined, uom)} />
        </div>
        <PositionsPanel positions={positions} uom={uom} />
        {reservations && <LinkPanel title="Reservations" empty="No active reservation holds this batch."
          rows={reservations.map((row) => ({ key: row.id, href: row.href, cells: [row.number, row.source, row.warehouse, quantity(row.quantity, uom)] }))} columns={["Reservation", "Source", "Warehouse", "Quantity"]} />}
        {holds && <LinkPanel title="Quality holds" empty="This batch has never been on hold."
          rows={holds.map((row) => ({ key: row.id, href: row.href, cells: [row.number, row.type === "quarantine" ? "Quarantine" : "Quality hold", capital(row.status), quantity(row.held, uom)] }))}
          columns={["Hold", "Type", "Status", "Held"]} />}
        {movements && <Journey movements={movements} title="Movement history" more={`/inventory/transactions?tab=movements&${scope}`} />}
        {batch.notes && <PropertyList title="Notes" columns={1} items={[{ label: "Notes", value: <span className="whitespace-pre-wrap">{batch.notes}</span> }]} />}
      </div>
    </RecordDetailsPage>
  );
}

export function SerialDetailScreen({ serialId }: { serialId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "serial", serialId), queryFn: () => read<SerialDetail>(`/api/inventory/tracking/serials/${serialId}`) });
  const data = query.data;
  const menu = useActionMenu(data?.actions ?? { transfer: false, hold: false, goodsIssue: false, purchaseReturn: false },
    data ? `itemId=${data.serial.itemId}&serialId=${data.serial.id}${data.serial.warehouseId ? `&warehouseId=${data.serial.warehouseId}` : ""}` : "");
  if (query.isLoading) return <LoadingState label="Loading the serial number" rows={6} />;
  if (!data) return <ErrorState title="Could not load the serial number" description={query.error instanceof Error ? query.error.message : ""} />;
  const { serial, source, reservations, holds, movements } = data;
  return (
    <RecordDetailsPage
      header={{
        title: <>Serial {serial.serialNumber} <span className="text-base font-normal text-text-muted">{serial.sku} · {serial.itemName}</span></>,
        status: serial.inStock ? <StatusBadge tone="success">In stock</StatusBadge> : <StatusBadge tone="neutral">{capital(serial.status)}</StatusBadge>,
        fields: [
          { label: "Where", value: serial.warehouse ? `${serial.warehouse} / ${serial.location}` : serial.inStock ? "A warehouse you cannot see" : "Not in stock" },
          { label: "Disposition", value: serial.disposition ? DISPOSITION[serial.disposition] ?? serial.disposition : "—" },
          { label: "Item", value: <Link className="hover:underline" href={`/inventory/items/${serial.itemId}`}>{serial.sku}</Link> },
        ],
        secondaryActions: serial.inStock ? <MoreActions actions={menu} /> : undefined,
      }}
    >
      <div className="flex flex-col gap-4">
        <PropertyList title="Serial number" columns={3} items={[
          { label: "Item", value: <Link className="text-brand hover:underline" href={`/inventory/items/${serial.itemId}`}>{serial.sku} · {serial.itemName}</Link> },
          { label: "Current state", value: serial.inStock ? "In stock" : capital(serial.status) },
          { label: "Warehouse / location", value: serial.warehouse ? `${serial.warehouse} / ${serial.location}` : serial.inStock ? "A warehouse you cannot see" : null },
          { label: "Disposition", value: serial.disposition ? DISPOSITION[serial.disposition] ?? serial.disposition : null },
          { label: "Batch", value: serial.batchId ? <Link className="text-brand hover:underline" href={`/inventory/stock/batches/${serial.batchId}`}>{serial.batch}</Link> : null },
          { label: "Source receipt", value: source ? (source.href ? <Link className="text-brand hover:underline" href={source.href}>{source.number ?? source.type}</Link> : source.number ?? source.type) : null },
          { label: "Reservation", value: reservations?.length ? <Link className="text-brand hover:underline" href={reservations[0].href}>{reservations[0].number}</Link> : null },
          { label: "Missing since", value: serial.missingSince ? formatDate(serial.missingSince) : null },
        ]} />
        {holds && <LinkPanel title="Quality" empty="This serial number has never been on hold."
          rows={holds.map((row) => ({ key: row.id, href: row.href, cells: [row.number, row.type === "quarantine" ? "Quarantine" : "Quality hold", capital(row.status)] }))} columns={["Hold", "Type", "Status"]} />}
        {movements && <Journey movements={movements} title="Journey" more={`/inventory/transactions?tab=movements&serialId=${serial.id}`} />}
      </div>
    </RecordDetailsPage>
  );
}

function PositionsPanel({ positions, uom }: { positions: Position[]; uom?: string }) {
  return (
    <Panel title="Where it is">
      {positions.length === 0 ? <p className="text-sm text-text-muted">None of it is on hand in a warehouse you can see.</p> : (
        <LinesTable columns={["Warehouse", "Location", "Disposition", { label: "On hand", numeric: true }, { label: "Reserved", numeric: true }, { label: "Available", numeric: true }]}>
          {positions.map((row) => (
            <tr key={`${row.warehouseId}-${row.locationId}`}>
              <Cell><Link className="text-brand hover:underline" href={`/inventory/warehouses/${row.warehouseId}`}>{row.warehouse}</Link></Cell>
              <Cell>{row.location}</Cell>
              <Cell>{row.disposition === "available" && !row.restricted ? "Available" : <Badge tone="warning">{DISPOSITION[row.disposition] ?? "Restricted"}</Badge>}</Cell>
              <Cell numeric>{quantity(row.onHand, uom)}</Cell><Cell numeric>{quantity(row.reserved)}</Cell><Cell numeric>{quantity(row.available)}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}

function Journey({ movements, title, more }: { movements: MovementRow[]; title: string; more: string }) {
  return (
    <Panel title={title} actions={<Link className="text-sm text-brand hover:underline" href={more}>Open in Movement History</Link>}>
      {movements.length === 0 ? <p className="text-sm text-text-muted">No movements.</p> : (
        <LinesTable columns={["Effective", "Document", "Movement", "From → To", { label: "Quantity", numeric: true }]}>
          {movements.map((row) => (
            <tr key={row.id}>
              <Cell className="whitespace-nowrap text-text-muted">{formatDateTime(row.effectiveAt)}</Cell>
              <Cell><Link className="text-brand hover:underline" href={`/inventory/movements/${row.groupId}?movement=${row.id}`}>{row.source.number ?? row.number}</Link></Cell>
              <Cell>{row.typeLabel}</Cell><Cell>{row.from} → {row.to}</Cell>
              <Cell numeric>{row.quantity > 0 ? "+" : ""}{quantity(row.quantity)}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}

function LinkPanel({ title, empty, columns, rows }: { title: string; empty: string; columns: string[]; rows: Array<{ key: string; href: string; cells: string[] }> }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? <p className="text-sm text-text-muted">{empty}</p> : (
        <LinesTable columns={columns}>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => <Cell key={index}>{index === 0 ? <Link className="text-brand hover:underline" href={row.href}>{cell}</Link> : cell}</Cell>)}
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}
