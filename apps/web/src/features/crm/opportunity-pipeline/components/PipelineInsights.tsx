"use client";

// The pipeline in figures: four above the board (open value, closing this month, overdue, no next activity), and the manager's breakdowns
// (by owner, by stage, by source) on the deal dashboard. All of it is the open pipeline the caller can see, for the filters applied.

import { days } from "@/features/crm/opportunities/opportunity-format";
import { formatMoney } from "@/shared/format/human";

import type { Pipeline, PipelineSummary } from "../api/pipeline-api";

const panel = "flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4";
const numeric = "py-1.5 text-right tabular-nums";

export function PipelineBreakdowns({ summary, pipeline, currency, onSelectOwner }: {
  summary: PipelineSummary; pipeline: Pipeline | undefined; currency: string; onSelectOwner: (ownerId: string | null) => void;
}) {
  const money = (amount: number) => formatMoney(currency, amount);
  const stages = (pipeline?.stages ?? []).filter((stage) => !stage.isInactive);
  const aging = new Map(summary.stageAging.map((row) => [row.stageId, row]));
  const largest = Math.max(1, ...stages.map((stage) => stage.count));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className={panel}>
        <div>
          <h2 className="text-base font-semibold">Pipeline by owner</h2>
          <p className="text-sm text-text-secondary">Open deals each person owns. Choose a name to see their pipeline.</p>
        </div>
        {summary.byOwner.length === 0 ? <p className="text-sm text-text-secondary">No open deals.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-secondary">
                <tr>
                  <th className="py-1 font-medium">Owner</th>
                  <th className="py-1 text-right font-medium">Deals</th>
                  <th className="py-1 text-right font-medium">Open pipeline</th>
                  <th className="py-1 text-right font-medium">Weighted</th>
                  {stages.map((stage) => <th key={stage.id} className="py-1 pl-3 text-right font-medium whitespace-nowrap">{stage.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.byOwner.map((row) => (
                  <tr key={row.id ?? "unassigned"}>
                    <td className="py-1.5"><button type="button" className="text-left font-medium text-brand underline-offset-2 hover:underline" onClick={() => onSelectOwner(row.id)}>{row.label}</button></td>
                    <td className={numeric}>{row.total}</td>
                    <td className={numeric}>{money(row.value)}</td>
                    <td className={numeric}>{money(row.weightedValue)}</td>
                    {stages.map((stage) => <td key={stage.id} className={`${numeric} pl-3`}>{row.stages.find((entry) => entry.stageId === stage.id)?.total ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={panel}>
        <div>
          <h2 className="text-base font-semibold">Pipeline by stage</h2>
          <p className="text-sm text-text-secondary">Time in stage is for the deals there now. Time to move on and moved forward come from the last 12 months of stage history.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-secondary">
              <tr>
                <th className="py-1 font-medium">Stage</th>
                {["Deals", "Value", "Weighted", "Time in stage", "Time to move on", "Moved forward"].map((heading) => <th key={heading} className="py-1 pl-3 text-right font-medium whitespace-nowrap">{heading}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stages.map((stage) => {
                const history = aging.get(stage.id);
                return (
                  <tr key={stage.id}>
                    <td className="py-1.5">
                      <span className="flex flex-col gap-1">
                        <span className="font-medium">{stage.name}</span>
                        <span className="h-1.5 overflow-hidden rounded-pill bg-canvas-strong" aria-hidden="true"><span className="block h-full rounded-pill bg-brand" style={{ width: `${(stage.count / largest) * 100}%` }} /></span>
                      </span>
                    </td>
                    <td className={`${numeric} pl-3`}>{stage.count}</td>
                    <td className={`${numeric} pl-3`}>{money(stage.value)}</td>
                    <td className={`${numeric} pl-3`}>{money(stage.weightedValue)}</td>
                    <td className={`${numeric} pl-3`}>{stage.averageDaysInStage === null ? "–" : days(Math.round(stage.averageDaysInStage))}</td>
                    <td className={`${numeric} pl-3`}>{history?.averageDays == null ? "–" : days(Math.round(history.averageDays))}</td>
                    <td className={`${numeric} pl-3`}>{history?.conversionRate == null ? "–" : `${history.conversionRate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={panel}>
        <h2 className="text-base font-semibold">Pipeline by source</h2>
        {summary.bySource.length === 0 ? <p className="text-sm text-text-secondary">No open deals.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-text-secondary">
              <tr><th className="py-1 font-medium">Source</th>{["Deals", "Pipeline", "Weighted"].map((heading) => <th key={heading} className="py-1 text-right font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.bySource.map((row) => (
                <tr key={row.id ?? "none"}>
                  <td className="py-1.5">{row.label}</td>
                  <td className={numeric}>{row.total}</td>
                  <td className={numeric}>{money(row.value)}</td>
                  <td className={numeric}>{money(row.weightedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
