"use client";

// An order's material reconciliation: per material, issued = used + scrapped + returned + still in production (one exclusive split), and,
// for the accepted output, what the BOM expected against what was used. Custody balance and usage efficiency are separate questions.
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { reconciliation } from "../api/mc-api";

export function MaterialReconciliationPanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-reconciliation", orderId), queryFn: () => reconciliation(orderId), retry: false });
  if (query.isLoading) return <LoadingState label="Reconciling material" rows={3} />;
  if (!query.data) return null;
  const data = query.data;
  const costed = data.lines.some((row) => row.cost);
  return (
    <Panel title="Material reconciliation" description={`Issued = used + scrapped + returned + in production. Usage against the BOM is for the ${qty(data.acceptedOutput)} accepted.`}>
      <div className="flex flex-wrap gap-2">
        {data.reconciled ? <StatusBadge tone="success">Every issued unit is accounted for</StatusBadge> : <StatusBadge tone="warning">Material is still in production</StatusBadge>}
        {data.unpostedNotes > 0 && <StatusBadge tone="warning">{`${data.unpostedNotes} consumption note(s) not posted`}</StatusBadge>}
        {data.recoveryNotes > 0 && <StatusBadge tone="danger">{`${data.recoveryNotes} note(s) need recovery`}</StatusBadge>}
      </div>
      <LinesTable columns={["Material", { label: "Planned", numeric: true }, { label: "Extra", numeric: true }, { label: "Issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped", numeric: true },
        { label: "Returned", numeric: true }, { label: "In production", numeric: true }, { label: "BOM expects", numeric: true }, { label: "Usage variance", numeric: true }, ...(costed ? [{ label: "Value used", numeric: true }] : [])]}>
        {data.lines.map((row) => (
          <tr key={row.materialId}>
            <Cell><span className="flex flex-col"><span>{row.code} · {row.name}</span>
              {row.identities.length > 1 && <span className="text-xs text-text-muted">{row.identities.filter((identity) => Number(identity.inCustody) > 0).map((identity) => `${identity.batch ?? identity.serial ?? ""} ${qty(identity.inCustody)}`).join(", ")}</span>}</span></Cell>
            <Cell numeric>{qty(row.planned)}</Cell><Cell numeric>{Number(row.extra) ? qty(row.extra) : ""}</Cell><Cell numeric>{qty(row.issued)}</Cell><Cell numeric>{qty(row.consumed)}</Cell>
            <Cell numeric>{Number(row.scrapped) ? qty(row.scrapped) : ""}</Cell><Cell numeric>{Number(row.returned) ? qty(row.returned) : ""}</Cell>
            <Cell numeric>{Number(row.inCustody) ? <StatusBadge tone="warning">{qty(row.inCustody)}</StatusBadge> : "0"}</Cell>
            <Cell numeric>{row.expectedForAccepted === null ? "—" : qty(row.expectedForAccepted)}</Cell>
            <Cell numeric>{row.usageVariance === null ? "" : `${Number(row.usageVariance) > 0 ? "+" : ""}${qty(row.usageVariance)}${row.usageVariancePct ? ` (${row.usageVariancePct}%)` : ""}`}</Cell>
            {costed && <Cell numeric>{row.cost ? inr(row.cost.consumed) : ""}</Cell>}
          </tr>
        ))}
      </LinesTable>
    </Panel>
  );
}
