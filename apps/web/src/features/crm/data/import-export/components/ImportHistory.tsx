"use client";

import { RotateCcw } from "lucide-react";
import {
  IconButton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import { formatDateTime, humanize } from "@/shared/format/human";
import type { listLeadImportBatchesRequest } from "../api/import-export-api";
import type { LeadImportBatch } from "../types";

const ROLLBACKABLE_STATUSES = new Set(["completed", "completed_with_errors"]);

// Import history: every past batch, with undo while it can still be rolled
// back.
export function ImportHistory({
  historyQuery,
  setHistoryRollbackTarget,
}: {
  historyQuery: {
    isLoading: boolean;
    data?: Awaited<ReturnType<typeof listLeadImportBatchesRequest>>;
  };
  setHistoryRollbackTarget: Dispatch<SetStateAction<LeadImportBatch | null>>;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-text">Import history</h3>
      {historyQuery.isLoading ? (
        <p className="text-sm text-text-secondary">Loading past imports…</p>
      ) : (historyQuery.data?.batches.length ?? 0) === 0 ? (
        <p className="text-sm text-text-muted">
          No imports yet. Once you import a file, it appears here so you can
          find and undo it later.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
          <Table className="w-full text-sm">
            <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-secondary">
              <TableRow>
                <TableHeaderCell className="px-3 py-2">File</TableHeaderCell>
                <TableHeaderCell className="px-3 py-2">When</TableHeaderCell>
                <TableHeaderCell className="px-3 py-2">Status</TableHeaderCell>
                <TableHeaderCell className="px-3 py-2">Created</TableHeaderCell>
                <TableHeaderCell className="px-3 py-2" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(historyQuery.data?.batches ?? []).map((batch) => (
                <TableRow key={batch.id} className="border-t border-border">
                  <TableCell className="px-3 py-2 text-text">
                    {batch.file_name}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-text-secondary">
                    {formatDateTime(batch.created_at)}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <StatusBadge
                      tone={
                        batch.status === "completed"
                          ? "success"
                          : batch.status === "rolled_back"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {humanize(batch.status)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="px-3 py-2 tabular-nums text-text-secondary">
                    {batch.created_rows ?? 0}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    {ROLLBACKABLE_STATUSES.has(batch.status) && (
                      <IconButton
                        aria-label={`Undo import of ${batch.file_name}`}
                        size="compact"
                        variant="outline"
                        onPress={() => setHistoryRollbackTarget(batch)}
                      >
                        <RotateCcw className="size-4" aria-hidden="true" />
                      </IconButton>
                    )}
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
