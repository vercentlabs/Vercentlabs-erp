"use client";

import { Button, ProgressBar, StatusBadge } from "@vercentlabs/design-system";
import { humanize } from "@/shared/format/human";
import { leadImportErrorsUrl } from "../api/import-export-api";
import type { LeadImportWizard } from "../hooks/useLeadImportWizard";

// Results step: background progress, the outcome counts, rejected-row
// download and undo.
export function ResultsStep({
  resultBatch,
  running,
  progressQuery,
  rollbackResult,
  reset,
  setConfirmRollback,
}: {
  resultBatch: LeadImportWizard["resultBatch"];
  running: boolean;
  progressQuery: LeadImportWizard["progressQuery"];
  rollbackResult: LeadImportWizard["rollbackResult"];
  reset: LeadImportWizard["reset"];
  setConfirmRollback: LeadImportWizard["setConfirmRollback"];
}) {
  return (
    <div className="flex flex-col gap-4">
      {rollbackResult ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-border bg-canvas-strong px-3 py-2 text-sm text-text"
        >{`Rolled back ${rollbackResult.rolledBack} lead${rollbackResult.rolledBack === 1 ? "" : "s"}. ${rollbackResult.protected} stayed because they already have recorded activity.`}</p>
      ) : (
        <div role="status" className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={
                resultBatch!.status === "completed"
                  ? "success"
                  : running
                    ? "info"
                    : "warning"
              }
            >
              {humanize(resultBatch!.status)}
            </StatusBadge>
            <span className="text-sm text-text">
              {running
                ? "Importing in the background. You can leave this page; the import continues."
                : "Import finished."}
            </span>
          </div>
          {running && (
            <ProgressBar
              label="Rows processed"
              value={progressQuery.data?.progress.percent ?? 0}
              valueLabel={`${progressQuery.data?.progress.processed ?? 0} of ${progressQuery.data?.progress.total ?? resultBatch!.valid_rows}`}
            />
          )}
          <dl className="grid grid-cols-3 gap-3">
            <div className="rounded-[var(--radius-control)] border border-border p-3">
              <dt className="text-xs text-text-muted">Created</dt>
              <dd className="text-xl font-semibold tabular-nums text-text">
                {resultBatch!.created_rows ?? 0}
              </dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border p-3">
              <dt className="text-xs text-text-muted">Updated</dt>
              <dd className="text-xl font-semibold tabular-nums text-text">
                {resultBatch!.updated_rows ?? 0}
              </dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border p-3">
              <dt className="text-xs text-text-muted">Skipped</dt>
              <dd className="text-xl font-semibold tabular-nums text-text">
                {resultBatch!.skipped_rows ?? 0}
              </dd>
            </div>
          </dl>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onPress={reset}>
          Import another file
        </Button>
        {(resultBatch!.invalid_rows > 0 ||
          (resultBatch!.failed_rows ?? 0) > 0) && (
          <a
            href={leadImportErrorsUrl(resultBatch!.id)}
            className="inline-flex h-[var(--control-height-standard)] items-center rounded-[var(--radius-control)] border border-border px-4 text-sm font-medium text-text hover:bg-surface-muted"
          >
            Download rejected rows
          </a>
        )}
        {!rollbackResult && !running && (
          <Button variant="secondary" onPress={() => setConfirmRollback(true)}>
            Undo this import
          </Button>
        )}
      </div>
    </div>
  );
}
