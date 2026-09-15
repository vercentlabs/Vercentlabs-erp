"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, MetricStrip, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { money } from "@/features/crm/shared/format";
import { CrmForecastApiError, getCrmForecast } from "../api/forecast-api";

function toNumber(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function CrmForecastScreen() {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<{ from?: string; to?: string }>({});

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast", appliedFilters),
    queryFn: () => getCrmForecast(appliedFilters),
  });

  const rows = useMemo(() => query.data?.report.rows ?? [], [query.data]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          pipeline: acc.pipeline + toNumber(row.pipeline),
          weighted: acc.weighted + toNumber(row.weighted),
          won: acc.won + toNumber(row.won),
        }),
        { pipeline: 0, weighted: 0, won: 0 },
      ),
    [rows],
  );

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading forecast…</p>;
  if (query.isError) {
    if (query.error instanceof CrmForecastApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to the CRM forecast" />;
    }
    return <ErrorState title="Could not load the forecast" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Forecast"
        description="Open pipeline, weighted pipeline and won revenue by owner. A sales manager sees their own deals plus their active team's — not the whole organization, unless they hold the broader records permission."
      />

      <div className="flex flex-wrap items-end gap-2">
        <TextField aria-label="From date" label="From" placeholder="YYYY-MM-DD" value={from} onChange={setFrom} />
        <TextField aria-label="To date" label="To" placeholder="YYYY-MM-DD" value={to} onChange={setTo} />
        <Button variant="secondary" onPress={() => setAppliedFilters({ from: from || undefined, to: to || undefined })}>
          Apply
        </Button>
      </div>

      <MetricStrip
        metrics={[
          { label: "Total pipeline", value: money(null, totals.pipeline) },
          { label: "Total weighted pipeline", value: money(null, totals.weighted) },
          { label: "Total won", value: money(null, totals.won) },
        ]}
      />

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">By owner</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted">No open or won opportunities in scope.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-1.5 font-medium">Owner</th>
                <th className="py-1.5 font-medium">Pipeline</th>
                <th className="py-1.5 font-medium">Weighted</th>
                <th className="py-1.5 font-medium">Won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.owner} className="border-b border-border last:border-0">
                  <td className="py-1.5 text-text">{row.owner}</td>
                  <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.pipeline)}</td>
                  <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.weighted)}</td>
                  <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.won)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
