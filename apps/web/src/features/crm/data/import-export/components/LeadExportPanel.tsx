"use client";

import { Button, StatusBadge } from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import { formatDateTime, humanize } from "@/shared/format/human";
import {
  leadExportDownloadUrl,
  type getLeadExportJobRequest,
} from "../api/import-export-api";

// Export panel: start a background Lead export and download the CSV when
// the job completes.
export function LeadExportPanel({
  exportError,
  exportFailure,
  exportJob,
  exportJobId,
  exportRunning,
  exportStartMutation,
  setExportJobId,
}: {
  exportError: string | null;
  exportFailure: string | null;
  exportJob:
    Awaited<ReturnType<typeof getLeadExportJobRequest>>["job"] | undefined;
  exportJobId: string | null;
  exportRunning: boolean;
  exportStartMutation: { mutate: () => void; isPending: boolean };
  setExportJobId: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <section
      className="flex max-w-2xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5"
      aria-label="Export leads"
    >
      <div>
        <h2 className="text-sm font-semibold text-text">Export leads</h2>
        <p className="text-sm text-text-secondary">
          Choose what to export, then start. It runs in the background and gives
          you a download when it is ready.
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">What</dt>
          <dd className="text-sm font-medium text-text">Leads</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Which ones</dt>
          <dd className="text-sm font-medium text-text">
            Every lead you can see, up to 10,000
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Format</dt>
          <dd className="text-sm font-medium text-text">
            CSV (opens in Excel and Sheets)
          </dd>
        </div>
      </dl>
      {(exportError || exportFailure) && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {exportError || exportFailure}
        </p>
      )}
      {exportRunning ? (
        <div className="flex items-center gap-3" role="status">
          <StatusBadge tone="info">
            {humanize(exportJob?.status ?? "starting")}
          </StatusBadge>
          <span className="text-sm text-text-secondary">
            Preparing your file…
          </span>
        </div>
      ) : (
        <div>
          <Button
            variant="primary"
            onPress={() => {
              setExportJobId(null);
              exportStartMutation.mutate();
            }}
            isLoading={exportStartMutation.isPending}
          >
            Start export
          </Button>
        </div>
      )}
      {exportJob?.status === "completed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm">
          <span className="text-text">{`${exportJob.manifest.rowCount ?? 0} lead${(exportJob.manifest.rowCount ?? 0) === 1 ? "" : "s"} ready${exportJob.manifest.truncated ? " (limited to the first 10,000)" : ""}.`}</span>
          <a
            href={leadExportDownloadUrl(exportJobId!)}
            className="font-medium text-brand underline"
          >
            Download CSV
          </a>
          {exportJob.manifest.expiresAt && (
            <span className="text-xs text-text-muted">{`Available until ${formatDateTime(exportJob.manifest.expiresAt)}`}</span>
          )}
        </div>
      )}
    </section>
  );
}
