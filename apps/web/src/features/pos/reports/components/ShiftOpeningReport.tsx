"use client";

// Shift openings this month: openings, cash versus card / UPI shifts, opening floats, variances against handovers and supervisor-approved
// openings, open shifts and active counters by outlet, shifts open too long, refused openings and handovers still waiting. Shift duration is
// not working time: nothing here feeds payroll.
import { useQuery } from "@tanstack/react-query";

import { openingSummary } from "@/features/pos/shift-opening/api/shift-opening-api";
import { SOURCE_LABEL } from "@/features/pos/cash-sessions/api/cash-sessions-api";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function ShiftOpeningReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shift-openings-summary"), queryFn: openingSummary, retry: false });
  const data = query.data;
  if (!data || data.totals.openings === 0) return null;
  const t = data.totals;
  return (
    <PosPanel title="Shift openings" description={`${data.from} to ${data.to}.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Openings", String(t.openings)], ["Cash shifts", String(t.cashShifts)], ["Card / UPI shifts", String(t.digitalShifts)], ["Opening floats", money(currency, t.openingFloats)],
          ["Opening differences", String(t.variances)], ["Net difference", money(currency, t.varianceTotal)], ["Supervisor-approved", String(t.approvedOpenings)],
          ["Handovers waiting", String(t.handoversWaiting)], ["Opening corrections", String(t.openingCorrections ?? 0)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Outlet</th><th className="pb-1 text-right">Open shifts</th><th className="pb-1 text-right">Active counters</th></tr></thead>
          <tbody>{data.openByOutlet.map((row) => (
            <tr key={row.outlet} className="border-t border-border"><td className="py-1.5">{row.outlet}</td><td className="text-right tabular-nums">{row.openShifts}</td>
              <td className="text-right tabular-nums">{row.activeCounters}</td></tr>
          ))}</tbody>
        </table>
        <div className="text-sm">
          {data.longOpen.length > 0 && <p className="font-medium text-warning-emphasis">Open more than {data.longOpenHours} hours</p>}
          <ul>{data.longOpen.map((row) => <li key={row.shiftId}>{row.shiftNumber} · {row.terminal} · {row.cashier ?? "—"} · since {dateTime(row.openedAt)}</li>)}</ul>
          {(data.floatsBySource ?? []).length > 0 && <p className="font-medium">Opening floats by source</p>}
          <ul>{(data.floatsBySource ?? []).map((row) => <li key={row.source}>{SOURCE_LABEL[row.source] ?? row.source}: {row.openings} · {money(currency, row.amount)}</li>)}</ul>
          {data.refusals.length > 0 && <p className="mt-2 font-medium">Refused openings</p>}
          <ul>{data.refusals.map((row) => <li key={row.code}>{row.code.replace(/^POS_SHIFT_/, "").replace(/_/g, " ").toLowerCase()}: {row.attempts}</li>)}</ul>
        </div>
      </div>
    </PosPanel>
  );
}
