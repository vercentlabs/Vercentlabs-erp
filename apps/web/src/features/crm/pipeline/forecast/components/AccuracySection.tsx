"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, formatMoney } from "@/shared/format/human";
import { getGovernedForecastAccuracy } from "../api/forecast-api";

export function AccuracySection({ currency }: { currency: string | null }) {
  const workspace = useWorkspaceContext();
  const [horizon, setHorizon] = useState("0");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-accuracy", horizon),
    queryFn: () => getGovernedForecastAccuracy(Number(horizon)),
  });
  const accuracy = query.data;
  return (
    <section
      aria-label="Forecast accuracy"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Accuracy</h2>
          <p className="text-xs text-text-muted">
            {accuracy?.scope.organization
              ? "Organisation forecast"
              : "Your forecast"}{" "}
            at the snapshot nearest the period start, against what actually
            closed won.
          </p>
        </div>
        <div className="w-56">
          <Select
            label="Forecast taken"
            options={[
              { value: "0", label: "At period start" },
              { value: "30", label: "Up to 30 days in" },
              { value: "60", label: "Up to 60 days in" },
            ]}
            selectedKey={horizon}
            onSelectionChange={(key) => setHorizon(String(key ?? "0"))}
          />
        </div>
      </div>
      {query.isLoading ? (
        <LoadingState label="Loading accuracy" rows={2} />
      ) : !accuracy || accuracy.periods.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Accuracy appears once a period with snapshots is closed.
        </p>
      ) : (
        <>
          <p className="text-sm text-text" role="status">
            {accuracy.calibration.meanAbsolutePercentError === null
              ? "No measurable periods yet."
              : `Over ${accuracy.calibration.periods} period(s): average miss ${accuracy.calibration.meanAbsolutePercentError}%, bias ${accuracy.calibration.meanBiasPercent}% (positive = under-forecast), ${accuracy.calibration.withinTenPercent} within 10%.`}
          </p>
          <Table caption="Forecast accuracy by period">
            <TableHead>
              <TableRow>
                <TableHeaderCell className="pr-3 text-left">
                  Period
                </TableHeaderCell>
                <TableHeaderCell className="pr-3 text-right">
                  Forecast commit
                </TableHeaderCell>
                <TableHeaderCell className="pr-3 text-right">
                  Actual won
                </TableHeaderCell>
                <TableHeaderCell className="pr-3 text-right">
                  Error
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Commit deals won
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accuracy.periods.map((row) => (
                <TableRow key={row.periodId} className="border-t border-border">
                  <TableCell className="py-2 pr-3">
                    {row.name}
                    <span className="block text-xs text-text-muted">
                      {row.capturedAsOf
                        ? `Snapshot of ${formatDate(row.capturedAsOf)}`
                        : "No snapshot"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {row.forecastCommit === null
                      ? "—"
                      : formatMoney(currency, row.forecastCommit)}
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {formatMoney(currency, row.actualWon)}
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {row.errorPercent === null
                      ? "—"
                      : `${formatMoney(currency, row.errorAmount)} (${row.errorPercent}%)`}
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {row.commitConversionPercent === null
                      ? "—"
                      : `${row.commitDealsWon}/${row.commitDeals} (${row.commitConversionPercent}%)`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}
