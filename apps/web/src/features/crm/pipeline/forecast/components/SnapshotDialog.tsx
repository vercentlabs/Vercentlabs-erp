"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  ErrorState,
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
import {
  formatDate,
  formatDateTime,
  formatMoney,
  humanize,
} from "@/shared/format/human";
import { getForecastSnapshot } from "../api/forecast-api";

export function SnapshotDialog({
  captureId,
  onClose,
}: {
  captureId: string | null;
  onClose: () => void;
}) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "forecast-snapshot",
      captureId ?? "",
    ),
    queryFn: () => getForecastSnapshot(captureId!),
    enabled: Boolean(captureId),
  });
  const snapshot = query.data?.snapshot;
  const currency = snapshot?.capture.reportingCurrency ?? null;
  return (
    <Dialog
      isOpen={captureId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="xl"
      title={
        snapshot
          ? `Snapshot · ${formatDateTime(snapshot.capture.capturedAt)}`
          : "Snapshot"
      }
      description={
        snapshot
          ? `${humanize(snapshot.capture.source)} capture as of ${formatDate(snapshot.capture.asOf)}. Figures are exactly as captured.`
          : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState label="Loading snapshot" rows={3} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the snapshot"
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      ) : (
        <Table caption="Snapshot rows">
          <TableHead>
            <TableRow>
              <TableHeaderCell className="pr-3 text-left">
                Scope
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Commit
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Adjusted commit
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Best case
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Pipeline
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">Won</TableHeaderCell>
              <TableHeaderCell className="text-right">Deals</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(snapshot?.rows ?? []).map((row, index) => (
              <TableRow
                key={`${row.scopeType}-${row.scopeId ?? index}`}
                className="border-t border-border"
              >
                <TableCell className="py-2 pr-3">
                  {row.scopeType === "organization"
                    ? "Organisation"
                    : `${row.scopeType === "team" ? "Team" : "Seller"}: ${row.totals?.label ?? "Unassigned"}`}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.commitAmount)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.totals?.adjustedCommit)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.bestCaseAmount)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.pipelineAmount)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.wonAmount)}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums">
                  {row.dealCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Dialog>
  );
}
