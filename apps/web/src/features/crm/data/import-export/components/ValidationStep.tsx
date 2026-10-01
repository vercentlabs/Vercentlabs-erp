"use client";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { csvEscape, download } from "./csv-download";
import type { LeadImportWizard } from "../hooks/useLeadImportWizard";

// Validation step: the server's check of every row, the rows that will be
// left out, and the import action.
export function ValidationStep({
  preview,
  invalidRows,
  validCount,
  setStep,
  commitMutation,
}: {
  preview: NonNullable<LeadImportWizard["preview"]>;
  invalidRows: LeadImportWizard["invalidRows"];
  validCount: number;
  setStep: LeadImportWizard["setStep"];
  commitMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--radius-control)] border border-border p-3">
          <dt className="text-xs text-text-muted">Rows in file</dt>
          <dd className="text-xl font-semibold tabular-nums text-text">
            {preview.batch.total_rows}
          </dd>
        </div>
        <div className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft p-3">
          <dt className="text-xs text-success">Ready to import</dt>
          <dd className="text-xl font-semibold tabular-nums text-success">
            {preview.batch.valid_rows}
          </dd>
        </div>
        <div
          className={`rounded-[var(--radius-control)] border p-3 ${preview.batch.invalid_rows ? "border-danger-emphasis/30 bg-danger-soft" : "border-border"}`}
        >
          <dt
            className={`text-xs ${preview.batch.invalid_rows ? "text-danger" : "text-text-muted"}`}
          >
            Need fixing
          </dt>
          <dd
            className={`text-xl font-semibold tabular-nums ${preview.batch.invalid_rows ? "text-danger" : "text-text"}`}
          >
            {preview.batch.invalid_rows}
          </dd>
        </div>
      </dl>
      {preview.idempotent && (
        <p className="text-xs text-text-muted">
          This file matches a check you already ran, so the earlier result is
          shown.
        </p>
      )}
      {invalidRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text">
              Rows that will be left out
            </p>
            <Button
              variant="ghost"
              size="compact"
              onPress={() =>
                download(
                  "rows-to-fix.csv",
                  [
                    "Row,Problem",
                    ...invalidRows.map(
                      (r) =>
                        `${r.rowNumber},${csvEscape(r.errors.map((e) => e.message).join("; "))}`,
                    ),
                  ].join("\n"),
                )
              }
            >
              Download this list
            </Button>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-border">
            <Table className="w-full text-xs">
              <TableHead>
                <TableRow className="border-b border-border text-left text-text-muted">
                  <TableHeaderCell className="px-2 py-1 font-medium">
                    Row
                  </TableHeaderCell>
                  <TableHeaderCell className="px-2 py-1 font-medium">
                    What is wrong
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invalidRows.map((row) => (
                  <TableRow
                    key={row.rowNumber}
                    className="border-b border-border last:border-0"
                  >
                    <TableCell className="px-2 py-1 tabular-nums">
                      {row.rowNumber}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-danger">
                      {row.errors.map((e) => e.message).join("; ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onPress={() => setStep("duplicates")}>
          Back
        </Button>
        <Button
          variant="primary"
          isDisabled={validCount === 0}
          isLoading={commitMutation.isPending}
          onPress={() => commitMutation.mutate()}
        >{`Import ${validCount} lead${validCount === 1 ? "" : "s"}`}</Button>
      </div>
    </div>
  );
}
