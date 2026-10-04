"use client";

import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getConversionMetrics } from "../api/conversion-api";

// Lead → opportunity conversions in the period, over the leads the user can see.
export function ConversionMetricsPanel({ from, to }: { from: string; to: string }) {
  const workspace = useWorkspaceContext();
  const metrics = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "leads", "conversion-metrics", from, to), queryFn: () => getConversionMetrics({ from, to }) });
  if (!metrics.data) return null;
  const data = metrics.data;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Conversions</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Leads converted" value={data.converted} />
        <MetricCard label="Lead → opportunity rate" value={`${data.conversionRate}%`} />
        <MetricCard label="Average days to convert" value={data.averageDaysToConvert === null ? "–" : data.averageDaysToConvert} />
        <MetricCard label="Converted with an override" value={data.convertedWithOverride} />
      </div>
      <p className="text-xs text-text-muted">The rate is the share of leads created in the period that have been converted ({data.leadsCreatedAndConverted} of {data.leadsCreated}).</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Ranking title="Conversions by owner" rows={data.byOwner.map((row) => ({ key: row.userId ?? "none", label: row.name, total: row.converted }))} />
        <Ranking title="Conversions by source" rows={data.bySource.map((row) => ({ key: row.sourceId ?? "none", label: row.name, total: row.converted }))} />
      </div>
    </section>
  );
}

function Ranking({ title, rows }: { title: string; rows: Array<{ key: string; label: string; total: number }> }) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-text-muted">No conversions in this period.</p> : (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((row) => <li key={row.key} className="flex justify-between gap-3"><span>{row.label}</span><span className="font-medium tabular-nums">{row.total}</span></li>)}
        </ul>
      )}
    </section>
  );
}
