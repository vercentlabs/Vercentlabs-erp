"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  MetricStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";

import { MetricDrilldownDialog } from "@/features/crm/home/dashboard/components/MetricDrilldownDialog";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate, formatMoney } from "@/shared/format/human";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

import { getCrmForecast } from "../api/forecast-api";

// Any dates, not only a forecast period: open deals by expected close date,
// won deals by the date they were won, per owner. The figures come from the
// canonical metric layer (the "forecast" CRM report), and each opens the
// exact deals behind it.
const COLUMNS = [
  { key: "pipeline", metric: "forecast_pipeline", label: "Open pipeline" },
  { key: "bestCase", metric: "best_case", label: "Best case" },
  { key: "commitAmount", metric: "commit", label: "Commit" },
  { key: "weighted", metric: "weighted_closing", label: "Weighted" },
  { key: "won", metric: "won_amount", label: "Won" },
] as const;

type Drill = {
  metric: string;
  title: string;
  ownerId: string;
};

export function DateRangeForecast({
  currency: periodCurrency,
}: {
  currency: string | null;
}) {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});
  const [drill, setDrill] = useState<Drill | null>(null);
  const rangeInvalid = Boolean(from && to && to < from);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast", "range", applied),
    queryFn: () => getCrmForecast(applied),
  });
  const rows = useMemo(() => query.data?.report.rows ?? [], [query.data]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          pipeline: sum.pipeline + Number(row.pipeline ?? 0),
          weighted: sum.weighted + Number(row.weighted ?? 0),
          won: sum.won + Number(row.won ?? 0),
        }),
        { pipeline: 0, weighted: 0, won: 0 },
      ),
    [rows],
  );
  // The report resolves an empty range to its own default; drill-downs use
  // the same resolved dates so they list exactly the rows behind a figure.
  const resolved = query.data?.report.filters;
  const reportCurrency = query.data?.report.currency;
  const currency = periodCurrency ?? reportCurrency?.reportingCurrency ?? null;
  const unconverted = reportCurrency?.unconvertedCount ?? 0;
  const hasRange = Boolean(applied.from || applied.to);

  return (
    <section
      aria-label="Forecast for any dates"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-text">Any dates</h2>
        <p className="text-xs text-text-muted">
          Open deals count by their expected close date; won deals by the date
          they were won.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <DateInput
          label="Expected to close from"
          value={from}
          onChange={setFrom}
        />
        <DateInput
          label="Expected to close until"
          value={to}
          onChange={setTo}
          errorMessage={
            rangeInvalid ? "The end date is before the start date." : undefined
          }
        />
        <Button
          variant="secondary"
          isDisabled={rangeInvalid}
          onPress={() =>
            setApplied({ from: from || undefined, to: to || undefined })
          }
        >
          Show these dates
        </Button>
        {hasRange && (
          <Button
            variant="ghost"
            onPress={() => {
              setFrom("");
              setTo("");
              setApplied({});
            }}
          >
            Clear dates
          </Button>
        )}
      </div>
      {resolved?.from && resolved?.to && (
        <p role="status" className="text-sm text-text-secondary">
          {`Showing ${formatDate(resolved.from)} to ${formatDate(resolved.to)}.`}
        </p>
      )}

      {unconverted > 0 && (
        <p className="text-xs text-text-muted">
          {`${unconverted} deal${unconverted === 1 ? "" : "s"} in ${reportCurrency?.unconvertedCurrencies.join(", ")} ha${unconverted === 1 ? "s" : "ve"} no exchange rate and ${unconverted === 1 ? "is" : "are"} not included in these totals.`}
        </p>
      )}

      <MetricStrip
        metrics={[
          {
            label: "Open pipeline",
            value: formatMoney(currency, totals.pipeline, { compact: true }),
          },
          {
            label: "Weighted by probability",
            value: formatMoney(currency, totals.weighted, { compact: true }),
          },
          {
            label: "Won",
            value: formatMoney(currency, totals.won, { compact: true }),
          },
        ]}
      />

      {query.isError ? (
        <p role="alert" className="text-sm text-danger">
          The figures for these dates could not be loaded.
        </p>
      ) : rows.length === 0 && !query.isLoading ? (
        <p className="text-sm text-text-secondary">
          {hasRange
            ? "No open or won deals in these dates. Try a wider range."
            : "There are no open or won deals you can see in this period yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Forecast amounts by deal owner for these dates">
            <TableHead>
              <TableRow>
                <TableHeaderCell className="pr-3 text-left">
                  Owner
                </TableHeaderCell>
                {COLUMNS.map((column) => (
                  <TableHeaderCell
                    key={column.key}
                    className="pr-3 text-right last:pr-0"
                  >
                    {column.label}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.ownerUserId ?? "unassigned"}>
                  <TableCell className="py-2 pr-3">{row.owner}</TableCell>
                  {COLUMNS.map((column) => {
                    const amount = formatMoney(
                      currency,
                      Number(row[column.key] ?? 0),
                    );
                    return (
                      <TableCell
                        key={column.key}
                        className="py-2 pr-3 text-right tabular-nums last:pr-0"
                      >
                        {row.ownerUserId ? (
                          <button
                            type="button"
                            className="tabular-nums text-text-secondary underline-offset-2 hover:text-brand hover:underline"
                            aria-label={`${row.owner} ${column.label.toLowerCase()}: ${amount}. Open the deals behind this figure`}
                            onClick={() =>
                              setDrill({
                                metric: column.metric,
                                title: `${column.label} — ${row.owner}`,
                                ownerId: String(row.ownerUserId),
                              })
                            }
                          >
                            {amount}
                          </button>
                        ) : (
                          amount
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MetricDrilldownDialog
        metric={drill?.metric ?? null}
        title={drill?.title ?? ""}
        filters={{
          from: resolved?.from ?? undefined,
          to: resolved?.to ?? undefined,
          ownerId: drill?.ownerId,
        }}
        reportingCurrency={currency}
        isOpen={drill !== null}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </section>
  );
}
