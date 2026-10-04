"use client";

// The pipeline in figures: the strip above the board, and the manager's
// breakdowns below it (by owner, by stage, by source). All of it is the open
// pipeline the caller can see, for the filters currently applied.
import { MetricCard } from "@vercentlabs/design-system";

import { days } from "@/features/crm/opportunities/opportunity-format";
import { formatMoney } from "@/shared/format/human";

import type { Pipeline, PipelineSummary } from "../api/pipeline-api";

export type SummaryPreset = "open" | "closing_this_month" | "overdue" | "stale" | "no_next_activity";

function Metric({ label, value, onPress }: { label: string; value: string | number; onPress?: () => void }) {
  if (!onPress) return <MetricCard label={label} value={value} />;
  return (
    <button type="button" onClick={onPress} className="rounded-[var(--radius-card)] text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
      <MetricCard label={label} value={value} />
    </button>
  );
}

export function PipelineSummaryStrip({ summary, currency, onSelect }: { summary: PipelineSummary; currency: string; onSelect: (preset: SummaryPreset) => void }) {
  const totals = summary.totals;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Metric label="Open deals" value={totals.open} onPress={() => onSelect("open")} />
      <Metric label="Pipeline" value={formatMoney(currency, totals.value)} />
      <Metric label="Weighted" value={formatMoney(currency, totals.weightedValue)} />
      <Metric label={`Closing this month (${totals.closingThisMonth})`} value={formatMoney(currency, totals.closingThisMonthValue)} onPress={() => onSelect("closing_this_month")} />
      <Metric label="Overdue" value={totals.overdue} onPress={() => onSelect("overdue")} />
      <Metric label={`Stale (${totals.staleDays}+ days)`} value={totals.stale} onPress={() => onSelect("stale")} />
      <Metric label="No next activity" value={totals.noNextActivity} onPress={() => onSelect("no_next_activity")} />
    </div>
  );
}

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
        {summary.byOwner.length === 0 ? <p className="text-sm text-text-secondary">No open opportunities.</p> : (
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
        {summary.bySource.length === 0 ? <p className="text-sm text-text-secondary">No open opportunities.</p> : (
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
