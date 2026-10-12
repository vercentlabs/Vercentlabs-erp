"use client";

// Shift closings, newest first: a cashier sees their own; those who may see expected cash see their outlets' with expected cash and
// differences. Filter to closings with a difference or with cash still waiting to be accepted.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Checkbox, StatusBadge, TextField } from "@vercentlabs/design-system";

import { closingHistory } from "@/features/pos/shift-closing/api/shift-closing-api";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function ShiftClosingReport() {
  const workspace = useWorkspaceContext();
  const [withVariance, setWithVariance] = useState(false);
  const [custodyPending, setCustodyPending] = useState(false);
  const [q, setQ] = useState("");
  const filters = { ...(withVariance ? { withVariance: "true" } : {}), ...(custodyPending ? { custodyPending: "true" } : {}), ...(q.trim() ? { q: q.trim() } : {}), limit: "25" };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shift-closings", JSON.stringify(filters)), queryFn: () => closingHistory(filters), retry: false });
  const data = query.data;
  if (!data || (data.total === 0 && !withVariance && !custodyPending && !q.trim())) return null;
  return (
    <PosPanel title="Shift closings" description={`${data.total} closing${data.total === 1 ? "" : "s"}.`}>
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Shift number" size="compact" value={q} onChange={setQ} className="sm:max-w-[12rem]" />
        <Checkbox isSelected={withVariance} onChange={setWithVariance}>With a cash difference</Checkbox>
        <Checkbox isSelected={custodyPending} onChange={setCustodyPending}>Cash waiting to be accepted</Checkbox>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted">
            <tr><th className="pb-1 text-left">Shift</th><th className="pb-1 text-left">Counter</th><th className="pb-1 text-left">Cashier</th><th className="pb-1 text-left">Closed</th>
              <th className="pb-1 text-right">Expected</th><th className="pb-1 text-right">Counted</th><th className="pb-1 text-right">Difference</th><th className="pb-1 text-left">Cash</th></tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.closingId} className="border-t border-border">
                <td className="py-1.5"><Link href={`/pos/shifts/${row.shiftId}`} className="font-medium text-brand hover:underline">{row.shiftNumber}</Link>
                  {row.status === "FORCE_CLOSED" && <span className="ml-1 text-xs text-danger">force-closed</span>}</td>
                <td>{row.outlet} · {row.terminal}</td>
                <td>{row.cashier ?? "—"}</td>
                <td>{dateTime(row.closedAt)}</td>
                <td className="text-right tabular-nums">{row.expectedCash === null ? "—" : money(row.currency, row.expectedCash)}</td>
                <td className="text-right tabular-nums">{row.cashEnabled ? money(row.currency, row.countedCash) : "Card / UPI"}</td>
                <td className="text-right tabular-nums">{row.variance === null ? "—" : money(row.currency, row.variance)}</td>
                <td>{row.cashEnabled ? <StatusBadge tone={row.custodyStatus === "PENDING_ACCEPTANCE" ? "warning" : "neutral"}>
                  {row.custodyStatus === "PENDING_ACCEPTANCE" ? "Pending" : row.custodyStatus === "NO_CASH" ? "No cash" : "Accepted"}</StatusBadge> : "—"}
                  {row.openExceptions > 0 && <span className="ml-1 text-xs text-warning-emphasis">{row.openExceptions} open</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PosPanel>
  );
}
