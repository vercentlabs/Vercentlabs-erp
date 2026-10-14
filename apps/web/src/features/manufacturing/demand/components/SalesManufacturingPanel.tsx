"use client";

// What Sales sees of production for its order: per manufactured line, delivered, reserved stock, in production, planned in drafts and still
// uncovered, with the manufacturing orders behind it and their status. No cost. Planners get a link to the demand review.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { qty } from "@/features/manufacturing/orders/api/mo-api";
import { DEMAND_BASE, DEMAND_TONE, salesManufacturingStatus } from "../api/demand-api";

export function SalesManufacturingPanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "manufacturing-status", orderId), queryFn: () => salesManufacturingStatus(orderId) });
  if (query.isLoading) return <LoadingState label="Loading production status" rows={3} />;
  if (query.isError) return <Notice tone="danger">{query.error instanceof Error ? query.error.message : "Could not load production status."}</Notice>;
  const progress = query.data!;
  if (!progress.lines.length) return <p className="pt-4 text-sm text-text-muted">No manufactured products on this order.</p>;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="text-sm text-text-secondary">Production follows the order; it does not deliver or invoice anything. Finished goods made for this order are reserved for it once received.</p>
      {progress.lines.map((line) => (
        <Panel key={line.demandId} title={`${line.item.code} · ${line.item.name}`}
          actions={<span className="flex items-center gap-2"><StatusBadge tone={DEMAND_TONE[line.status] ?? "neutral"}>{line.statusLabel}</StatusBadge>
            {progress.canPlan && <Link className="text-sm text-brand underline" href={`${DEMAND_BASE}/${line.demandId}`}>Plan</Link>}</span>}>
          <LinesTable columns={[{ label: "Ordered", numeric: true }, { label: "Delivered", numeric: true }, { label: "Stock reserved", numeric: true }, { label: "In production", numeric: true },
            { label: "Planned (draft)", numeric: true }, { label: "Not yet covered", numeric: true }, "Required"]}>
            <tr><Cell numeric>{qty(line.ordered)}</Cell><Cell numeric>{qty(line.delivered)}</Cell><Cell numeric>{qty(line.reservedStock)}</Cell><Cell numeric>{qty(line.inProduction)}</Cell>
              <Cell numeric>{qty(line.planned)}</Cell><Cell numeric>{qty(line.uncovered)}</Cell><Cell>{line.requiredDate ? formatDate(line.requiredDate) : "—"}</Cell></tr>
          </LinesTable>
          {line.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
          {line.orders.length > 0 && (
            <ul className="text-sm">{line.orders.map((row) => <li key={row.id}>{row.number}: {row.status.toLowerCase().replace(/_/g, " ")} · {qty(row.received)} of {qty(row.assigned)} received · due {formatDate(row.plannedEndAt)}</li>)}</ul>
          )}
        </Panel>
      ))}
    </div>
  );
}
