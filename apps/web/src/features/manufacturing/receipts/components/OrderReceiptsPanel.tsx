"use client";

// An order's finished-goods receipts on its Production tab: every receipt note (drafts, posted, reversed), each opening its page, and the
// way to receive more of what is accepted and not yet received.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LinkButton, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, inr, qty, type MoOrder } from "@/features/manufacturing/orders/api/mo-api";
import { FGR_BASE, RECEIPT_TONE, listReceipts } from "../api/fgr-api";

export function OrderReceiptsPanel({ order }: { order: MoOrder }) {
  const workspace = useWorkspaceContext();
  const filters = { orderId: order.id };
  const receipts = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "finished-goods-receipts", filters), queryFn: () => listReceipts(filters) });
  const waiting = Number(order.quantities.acceptedNotReceived);
  const rows = receipts.data ?? [];
  return (
    <Panel title="Finished-goods receipts"
      description={`Into ${order.warehouses.finishedGoods.code} unless approved otherwise. Only accepted output is received; rejected output never becomes sellable stock.${waiting ? ` ${qty(order.quantities.acceptedNotReceived)} accepted output waits.` : ""}`}
      actions={order.can.receive && waiting > 0 ? <LinkButton size="compact" variant="secondary" href={`${FGR_BASE}/new?orderId=${order.id}`}>Receive finished goods</LinkButton> : undefined}>
      {receipts.isError ? <p className="text-sm text-danger">{errorMessage(receipts.error)}</p> : rows.length ? (
        <LinesTable columns={["Receipt", "Status", { label: "Quantity", numeric: true }, "From entries", "Into", ...(rows.some((row) => row.totalCost !== null) ? [{ label: "Value", numeric: true }] : []), "Received"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell><Link className="text-brand underline" href={`${FGR_BASE}/${row.id}`}>{row.number}</Link></Cell>
              <Cell><span className="flex flex-wrap gap-1"><StatusBadge tone={RECEIPT_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge>
                {row.correctionStatus === "REVERSED" && <StatusBadge tone="neutral">Reversed</StatusBadge>}{row.correctionStatus === "REQUESTED" && <StatusBadge tone="warning">Correction requested</StatusBadge>}</span></Cell>
              <Cell numeric>{qty(row.quantity)} {row.uom}</Cell>
              <Cell>{row.entries ?? ""}{row.lots ? <span className="block text-xs text-text-muted">Lot {row.lots}</span> : null}</Cell>
              <Cell>{row.warehouse}{row.location ? ` / ${row.location}` : ""}</Cell>
              {rows.some((entry) => entry.totalCost !== null) && <Cell numeric>{row.totalCost ? inr(row.totalCost) : ""}</Cell>}
              <Cell>{row.postedAt ? `${formatDateTime(row.postedAt)}${row.receivedBy ? ` · ${row.receivedBy}` : ""}` : <span className="text-text-muted">Not posted</span>}</Cell>
            </tr>
          ))}
        </LinesTable>
      ) : <p className="text-sm text-text-muted">{receipts.isLoading ? "Loading…" : "Nothing received yet."}</p>}
    </Panel>
  );
}
