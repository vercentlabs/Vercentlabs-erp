"use client";

// Win / loss for a period, over the opportunities the user can see: win
// rate, the share of each won and lost reason, and a breakdown by owner,
// team, source, product, account, industry, final stage or close month.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MetricCard, Select } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatMoney } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { WIN_LOSS_GROUPS, errorMessage, getWinLossReport, type WinLossReasonShare } from "../api/close-reasons-api";

const monthStart = () => { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10); };

export function WinLossReportPanel({ currency }: { currency: string }) {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState("owner");
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", "win-loss", from, to, groupBy), queryFn: () => getWinLossReport({ from, to, groupBy }) });
  const data = report.data;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold">Won and lost</h2>
        <div className="flex flex-wrap items-end gap-3">
          <DateInput label="Closed from" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <Select label="Break down by" selectedKey={groupBy} onSelectionChange={(key) => setGroupBy(String(key))} options={WIN_LOSS_GROUPS.filter((group) => group.value !== "reason")} />
        </div>
      </div>
      {report.isError && <p role="alert" className="text-sm text-danger">{errorMessage(report.error, "The report could not be loaded.")}</p>}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <MetricCard label="Won" value={data.totals.won} />
            <MetricCard label="Won value" value={formatMoney(currency, data.totals.wonValue)} />
            <MetricCard label="Lost" value={data.totals.lost} />
            <MetricCard label="Lost pipeline value" value={formatMoney(currency, data.totals.lostValue)} />
            <MetricCard label="Win rate" value={data.totals.winRate === null ? "–" : `${data.totals.winRate}%`} />
            <MetricCard label="Top lost reason" value={data.totals.topLostReason ?? "–"} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ReasonShares title="Lost reasons" rows={data.lostReasons} empty="No lost opportunities in this period." />
            <ReasonShares title="Won reasons" rows={data.wonReasons} empty="No won opportunities in this period." />
          </div>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-secondary">
                <tr>{[data.groupLabel, "Won", "Lost", "Win rate", "Won value", "Lost value", "Top lost reason"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.groups.length === 0 ? <tr><td colSpan={7} className="px-3 py-4 text-text-muted">No closed opportunities in this period.</td></tr> : data.groups.map((group) => (
                  <tr key={group.key}>
                    <th scope="row" className="px-3 py-2 font-medium">{group.label}</th>
                    <td className="px-3 py-2 tabular-nums">{group.won}</td>
                    <td className="px-3 py-2 tabular-nums">{group.lost}</td>
                    <td className="px-3 py-2 tabular-nums">{group.winRate === null ? "–" : `${group.winRate}%`}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(currency, group.wonValue)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(currency, group.lostValue)}</td>
                    <td className="px-3 py-2">{group.topLostReason ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ReasonShares({ title, rows, empty }: { title: string; rows: WinLossReasonShare[]; empty: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-text-muted">{empty}</p> : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <li key={row.reasonId ?? row.name} className="flex flex-col gap-1">
              <span className="flex justify-between gap-3"><span>{row.name}</span><span className="tabular-nums text-text-secondary">{row.count} · {row.share}%</span></span>
              <span className="h-1.5 w-full overflow-hidden rounded-pill bg-canvas-strong"><span className="block h-full rounded-pill bg-brand" style={{ width: `${row.share}%` }} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
