"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { RefreshCw } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { toNumber } from "@/features/crm/shared/format";
import { formatMoney } from "@/shared/format/human";
import {
  capturePredictiveSnapshot,
  CrmForecastApiError,
  getForecastCalibration,
} from "../api/forecast-api";
import type { PredictiveForecastResult } from "../types";

// F025 — every forecast amount opens the exact deals behind it: open
// pipeline/weighted by expected close date, best case and commit by
// forecast category, won by the date it was won. The list's total always
// equals the figure (same owner, dates and category predicates).

export function PredictiveCalibration({
  canView,
  currency,
}: {
  canView: boolean;
  currency: string | null;
}) {
  const workspace = useWorkspaceContext();
  const [error, setError] = useState<string | null>(null);
  const [latestPrediction, setLatestPrediction] =
    useState<PredictiveForecastResult | null>(null);

  const calibrationQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-calibration"),
    queryFn: () => getForecastCalibration(),
    enabled: canView,
  });
  const rows = calibrationQuery.data?.rows ?? [];

  const captureMutation = useMutation({
    mutationFn: () => capturePredictiveSnapshot(),
    onSuccess: (result) => {
      setError(null);
      setLatestPrediction(result);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof CrmForecastApiError
          ? err.message
          : "The predictive forecast could not be captured.",
      ),
  });

  if (!canView) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">
          How accurate past forecasts were
        </h2>
        <IconButton
          aria-label="Refresh the predicted forecast now"
          size="compact"
          variant="outline"
          onPress={() => captureMutation.mutate()}
          isDisabled={captureMutation.isPending}
        >
          <RefreshCw
            className={`size-4 ${captureMutation.isPending ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </IconButton>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {latestPrediction && (
        <div className="rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm text-text">
          <p>
            {"Predicted to close: "}
            <strong>
              {formatMoney(currency, latestPrediction.forecast.predictedAmount)}
            </strong>
            {" out of " +
              formatMoney(currency, latestPrediction.forecast.pipelineAmount) +
              " open pipeline, across " +
              latestPrediction.forecast.opportunityCount +
              " open deals. Confidence " +
              latestPrediction.forecast.confidence +
              "%."}
          </p>
        </div>
      )}
      <p className="text-xs text-text-muted">
        For each closed period, what was predicted compared with what was
        actually won.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Nothing to compare yet. A period needs to close, with a prediction
          saved during it, before its accuracy shows here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHead>
              <TableRow className="border-b border-border text-left text-xs text-text-muted">
                <TableHeaderCell scope="col" className="py-1.5 font-medium">
                  Period
                </TableHeaderCell>
                <TableHeaderCell
                  scope="col"
                  className="py-1.5 text-right font-medium"
                >
                  Predicted
                </TableHeaderCell>
                <TableHeaderCell
                  scope="col"
                  className="py-1.5 text-right font-medium"
                >
                  Actually won
                </TableHeaderCell>
                <TableHeaderCell
                  scope="col"
                  className="py-1.5 text-right font-medium"
                >
                  Difference
                </TableHeaderCell>
                <TableHeaderCell
                  scope="col"
                  className="py-1.5 text-right font-medium"
                >
                  Confidence
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.periodId}
                  className="border-b border-border last:border-0"
                >
                  <TableCell className="py-1.5 text-text">
                    {row.periodName}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-text-secondary">
                    {formatMoney(
                      currency,
                      Math.round(toNumber(row.predictedAmount)),
                    )}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-text-secondary">
                    {formatMoney(
                      currency,
                      Math.round(toNumber(row.actualWonAmount)),
                    )}
                  </TableCell>
                  <TableCell
                    className={`py-1.5 text-right tabular-nums ${toNumber(row.errorAmount) < 0 ? "text-danger" : "text-success"}`}
                  >
                    {/* errorAmount = won − predicted: negative means the forecast was too high. */}
                    {(toNumber(row.errorAmount) < 0
                      ? "Forecast too high by "
                      : "Forecast too low by ") +
                      formatMoney(
                        currency,
                        Math.round(Math.abs(toNumber(row.errorAmount))),
                      )}{" "}
                    {row.errorPercent != null
                      ? "(" + Math.abs(toNumber(row.errorPercent)) + "%)"
                      : ""}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-text-secondary">
                    {toNumber(row.confidencePercent)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
