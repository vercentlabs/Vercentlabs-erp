"use client";

// One stock movement as evidence: what moved, where, in which unit, from which document and posting, what it reversed or what reversed it,
// its valuation and the journals of its document. There is no Edit: a movement is corrected by its document.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyState, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { PropertyList } from "@/shared/ui/PropertyList";
import { Cell, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, getMovement, type LedgerRow } from "../api/stock-ledger-api";
import { LEDGER_BASE } from "./StockLedgerScreen";

const OPERATION_LABEL: Record<string, string> = {
  transfer: "Warehouse transfer", dispatch: "Transfer dispatch", receive: "Transfer receipt", location_move: "Location move", disposition_move: "Disposition change", reversal: "Reversal",
};


function MovementLink({ row }: { row: LedgerRow }) {
  return <Link className="text-brand hover:underline" href={`${LEDGER_BASE}/${row.id}`}>{row.number}</Link>;
}

export function MovementDetailScreen({ movementId }: { movementId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "stock-ledger", "movement", movementId), queryFn: () => getMovement(movementId) });
  if (detail.isLoading) return <LoadingState label="Loading the movement" rows={6} />;
  if (detail.isError) {
    if (errorCode(detail.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to the stock ledger" description="Ask an administrator for the View stock ledger permission." />;
    if (errorCode(detail.error) === "STOCK_MOVEMENT_NOT_FOUND") return <EmptyState title="Movement not found" description="It does not exist, or it is in a warehouse you cannot see." />;
    return <ErrorState title="Could not load the movement" description={errorMessage(detail.error)} action={{ label: "Try again", onPress: () => void detail.refetch() }} />;
  }
  const data = detail.data!;
  const row = data.movement;
  const links = [
    data.links.source && { label: `View ${row.source.label}`, href: data.links.source },
    { label: "View item", href: data.links.item }, { label: "Item stock", href: data.links.itemStock }, { label: "View warehouse", href: data.links.warehouse },
    data.links.serialHistory && { label: "Serial history", href: data.links.serialHistory }, data.links.batchLedger && { label: "Batch ledger", href: data.links.batchLedger },
    { label: "Item ledger", href: `/inventory/transactions?tab=ledger&itemId=${row.itemId}&warehouseId=${row.warehouseId}` },
  ].filter((entry): entry is { label: string; href: string } => Boolean(entry));

  return (
    <RecordDetailsPage
      header={{
        title: <>{row.typeLabel} <span className="text-base font-normal whitespace-nowrap text-text-muted">{row.number}</span></>,
        status: row.reversedById ? <StatusBadge tone="neutral">Reversed</StatusBadge> : data.reverses ? <StatusBadge tone="info">Reversal</StatusBadge> : <StatusBadge tone="success">Posted</StatusBadge>,
        fields: [
          { label: "Item", value: `${row.sku} · ${row.itemName}` },
          { label: "Quantity", value: `${row.quantity > 0 ? "+" : ""}${quantity(row.quantity, row.baseUom)}` },
          { label: "Where", value: `${row.warehouse} / ${row.location}` },
          { label: "Effective", value: formatDate(row.effectiveAt) },
        ],
        primaryAction: data.links.source ? <LinkButton variant="secondary" href={data.links.source}>View {row.source.label}</LinkButton> : undefined,
        secondaryActions: <MoreActions actions={[
          ...links.filter((entry) => entry.href !== data.links.source).map((entry) => ({ id: entry.label, label: entry.label, run: () => router.push(entry.href) })),
          ...(data.journals && data.journals.length > 0 ? [{ id: "accounting", label: "View accounting", run: () => router.push("/accounting/journals") }] : []),
        ]} />,
      }}
      tabs={(row.reversedById && data.reversedBy) || data.reverses ? (
        <div className="flex flex-col gap-3">
          {row.reversedById && data.reversedBy && <Notice tone="neutral">
            Reversed by <MovementLink row={data.reversedBy} /> on {formatDateTime(data.reversedBy.postedAt)}. Both stay in the ledger; together they net to zero.</Notice>}
          {data.reverses && <Notice tone="neutral">
            This movement reverses <MovementLink row={data.reverses} /> ({data.reverses.typeLabel}, {quantity(data.reverses.quantity, data.reverses.baseUom)}).</Notice>}
        </div>
      ) : undefined}
    >
      <div className="flex flex-col gap-4">
        <PropertyList title="Movement" columns={3} items={[
          { label: "Movement ID", value: <span className="break-all font-mono text-xs">{row.id}</span> },
          { label: "Movement type", value: row.typeLabel },
          { label: "Item / SKU", value: `${row.sku} · ${row.itemName}` },
          { label: "Base quantity", value: `${row.quantity > 0 ? "+" : ""}${quantity(row.quantity, row.baseUom)}` },
          { label: "Transaction quantity", value: row.entered ? `${quantity(row.entered.quantity, row.entered.uom)} (1 ${row.entered.uom} = ${row.entered.conversion} ${row.baseUom})` : "Entered in the base unit" },
          { label: "Warehouse", value: `${row.warehouse} · ${row.warehouseName}` },
          { label: "Location", value: row.location },
          { label: "Batch / Serial", value: row.serial ? `Serial ${row.serial}` : row.batch ? `Batch ${row.batch}` : null },
          { label: "Disposition", value: row.disposition === "available" ? "Available" : <Badge tone="warning">{row.dispositionLabel}</Badge> },
          { label: "Effective", value: formatDate(row.effectiveAt) },
          { label: "Posted", value: `${formatDateTime(row.postedAt)}${row.postedBy ? ` · ${row.postedBy}` : ""}` },
          { label: "Source document", value: <>{data.links.source ? <Link className="text-brand hover:underline" href={data.links.source}>{row.source.number ?? row.number}</Link> : row.source.number ?? row.number} ({row.source.label})</> },
          { label: "Source line", value: row.source.lineId ? <span className="font-mono text-xs">{row.source.lineId}</span> : null },
          { label: "Ledger sequence", value: String(row.sequence) },
          { label: "Posting", value: <>{OPERATION_LABEL[data.group.operation] ?? row.typeLabel} · <span className="font-mono text-xs">{data.group.postingKey}</span></> },
          { label: "Reason", value: row.reason },
        ]} />
        <Panel title={`This posting (${data.legs.length} movement${data.legs.length === 1 ? "" : "s"}, net ${quantity(data.group.net)})`}>
          <LinesTable columns={["Movement", "Type", "Warehouse", "Location", "Batch / Serial", "Disposition", { label: "Quantity", numeric: true }]}>
            {data.legs.map((leg) => (
              <tr key={leg.id} className={leg.id === row.id ? "bg-surface-muted" : undefined}>
                <Cell><MovementLink row={leg} /></Cell><Cell>{leg.typeLabel}</Cell><Cell>{leg.warehouse}</Cell><Cell>{leg.location}</Cell><Cell>{leg.serial ?? leg.batch}</Cell>
                <Cell>{leg.dispositionLabel}</Cell><Cell numeric>{leg.quantity > 0 ? "+" : ""}{quantity(leg.quantity, leg.baseUom)}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {data.valuation && (
          <Panel title="Valuation" actions={<Link className="text-sm text-brand hover:underline" href={data.valuation.href}>Valuation detail</Link>}>
            <p className="text-sm">Value {money(data.valuation.value)} · rate {money(data.valuation.unitCost)} ({data.valuation.method === "fifo" ? "FIFO" : "Moving Average"}) · {data.valuation.costSource.replace(/_/g, " ")}</p>
          </Panel>
        )}
        {data.journals && (
          <Panel title="Accounting">
            {data.journals.length === 0 ? <p className="text-sm text-text-muted">No journal for this document.</p> : (
              <LinesTable columns={["Journal", "Date", "Status"]}>
                {data.journals.map((entry) => <tr key={entry.id}><Cell><Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link></Cell><Cell>{formatDate(entry.date)}</Cell><Cell>{entry.status}</Cell></tr>)}
              </LinesTable>
            )}
          </Panel>
        )}
      </div>
    </RecordDetailsPage>
  );
}
