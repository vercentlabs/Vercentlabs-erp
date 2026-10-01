"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  ErrorState,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, formatMoney, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { getMetricDrilldown, type PipelineFilters } from "../api/analytics-api";

// F024 drill-down: the exact records behind a figure. The summary line is
// computed by the same query shape as the KPI, so it always matches the tile
// the user clicked; deals without an exchange rate are listed and flagged,
// never silently added at face value.
export function MetricDrilldownDialog({
  metric,
  title,
  filters,
  reportingCurrency,
  isOpen,
  onOpenChange,
}: {
  metric: string | null;
  title: string;
  filters: PipelineFilters;
  reportingCurrency: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useWorkspaceContext();
  const query = useInfiniteQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "analytics",
      "drilldown",
      metric ?? "",
      JSON.stringify(filters),
    ),
    queryFn: ({ pageParam }) => getMetricDrilldown(metric!, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: isOpen && Boolean(metric),
  });
  const first = query.data?.pages[0];
  const records = query.data?.pages.flatMap((page) => page.records) ?? [];
  const isMoney =
    first?.definition?.unit === "money" ||
    first?.definition?.unit === "percent";
  const measureField =
    first?.definition?.measure === "weighted"
      ? "weightedReporting"
      : "amountReporting";
  const summaryValue = first
    ? first.definition?.unit === "count" || first.definition?.unit === "percent"
      ? `${first.summary.count.toLocaleString("en-IN")} deal${first.summary.count === 1 ? "" : "s"}`
      : formatMoney(reportingCurrency, first.summary.value)
    : "";

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={title}
      size="xl"
      description={
        first?.definition
          ? `${first.definition.populationLabel}. ${first.definition.timeBasis}.`
          : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState
          label="Loading records"
          rows={4}
          onRetry={() => query.refetch()}
        />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the records"
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      ) : first ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text" role="status">
            <span className="font-semibold tabular-nums">{summaryValue}</span>
            {first.definition?.unit !== "count" &&
            first.definition?.unit !== "percent"
              ? ` across ${first.summary.count.toLocaleString("en-IN")} deal${first.summary.count === 1 ? "" : "s"}`
              : ""}
            {first.summary.unconvertedCount > 0
              ? ` · ${first.summary.unconvertedCount} without an exchange rate, listed but not added`
              : ""}
          </p>
          {records.length === 0 ? (
            <p className="text-sm text-text-muted">
              No records match this figure.
            </p>
          ) : (
            <Table caption={`Records behind ${title}`}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="text-left">
                    Opportunity
                  </TableHeaderCell>
                  <TableHeaderCell className="text-left">Stage</TableHeaderCell>
                  <TableHeaderCell className="text-left">Owner</TableHeaderCell>
                  <TableHeaderCell className="text-left">Close</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Amount
                  </TableHeaderCell>
                  {isMoney && (
                    <TableHeaderCell className="text-right">{`In ${reportingCurrency ?? "reporting currency"}`}</TableHeaderCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id} className="border-t border-border">
                    <TableCell className="py-2 pr-3">
                      <Link
                        href={`/crm/opportunities/${record.id}`}
                        className="font-medium text-text hover:underline"
                      >
                        {record.name}
                      </Link>
                      <span className="block text-xs text-text-muted">
                        {record.code} · {humanize(record.status)}
                        {record.stalled ? " · stalled" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 pr-3">
                      {record.stageName ?? "—"}
                    </TableCell>
                    <TableCell className="py-2 pr-3">
                      {record.ownerName ?? "Unassigned"}
                      {record.teamName ? (
                        <span className="block text-xs text-text-muted">
                          {record.teamName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2 pr-3">
                      {formatDate(
                        record.actualCloseDate ?? record.expectedCloseDate,
                      ) || "—"}
                    </TableCell>
                    <TableCell className="py-2 pr-3 text-right tabular-nums">
                      {formatMoney(record.currencyCode, record.amount)}
                    </TableCell>
                    {isMoney && (
                      <TableCell className="py-2 text-right tabular-nums">
                        {record[measureField] === null ? (
                          <StatusBadge tone="warning">No rate</StatusBadge>
                        ) : (
                          formatMoney(reportingCurrency, record[measureField])
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {query.hasNextPage && (
            <div>
              <Button
                variant="secondary"
                onPress={() => query.fetchNextPage()}
                isLoading={query.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
