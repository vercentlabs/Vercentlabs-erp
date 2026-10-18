"use client";

// The person's imports and exports that run in the background, newest first: what each is, how far it got, and its file to download
// (the export, or an import's rows that were not imported). Refreshes itself while one is still waiting or running.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { StatusBadge, buttonVariants } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { ON_SCREEN_IMPORT_LIMIT, dataJobDownloadUrl, listDataJobs, queueImport, type DataJob, type DataJobEntity } from "../data-jobs-api";

const STATUS: Record<DataJob["status"], { label: string; tone: "neutral" | "info" | "success" | "danger" }> = {
  queued: { label: "Waiting", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Finished", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const dataJobsQueryKey = (workspace: Parameters<typeof scopedQueryKey>[0], entity?: DataJobEntity) =>
  scopedQueryKey(workspace, "crm", "data-jobs", entity ?? "all");

function summary(job: DataJob) {
  const result = job.result;
  if (job.status === "failed") return job.error ?? "It could not finish.";
  if (job.status !== "succeeded") return job.kind === "import" ? `${result.rowCount ?? ""} rows to import`.trim() : "Preparing the file";
  if (job.kind === "export") return `${result.rowCount ?? 0} ${job.entityLabel} exported`;
  const parts = [`${result.created ?? 0} of ${result.total ?? 0} imported`];
  if (result.won) parts.push(`${result.won} won`);
  if (result.lost) parts.push(`${result.lost} lost`);
  if (result.failed) parts.push(`${result.failed} not imported`);
  return parts.join(" · ");
}

export function BackgroundRunsPanel({ entity }: { entity?: DataJobEntity }) {
  const workspace = useWorkspaceContext();
  const jobs = useQuery({
    queryKey: dataJobsQueryKey(workspace, entity),
    queryFn: () => listDataJobs(entity),
    refetchInterval: (query) => (query.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 5000 : false),
  });
  if (!jobs.data?.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      <div>
        <h2 className="text-base font-semibold">Background imports and exports</h2>
        <p className="text-sm text-text-secondary">Large files run here while you keep working; you are notified when each one finishes. Files are kept for a few days.</p>
      </div>
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border">
        {jobs.data.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                {job.kind === "import" ? "Import" : "Export"} of {job.entityLabel}{job.fileName ? ` · ${job.fileName}` : ""}
              </span>
              <span className="text-text-secondary">{summary(job)} · started {formatDateTime(job.requestedAt)}</span>
            </div>
            <StatusBadge tone={STATUS[job.status].tone}>{STATUS[job.status].label}</StatusBadge>
            {job.status === "succeeded" && job.hasOutput && (
              <a className={buttonVariants({ variant: "outline", size: "compact" })} href={dataJobDownloadUrl(job.id)} download>
                <Download className="size-4" aria-hidden="true" />{job.kind === "export" ? "Download" : "Rows not imported"}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// For an import screen: a file with more rows than the import takes at once is queued instead (same mapping and options).
export function useBackgroundImport(entity: DataJobEntity, onError: (failure: unknown) => void) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [queued, setQueued] = useState<DataJob | null>(null);
  const queue = useMutation({
    mutationFn: ({ file, mapping, ...options }: { file: File; mapping: Record<string, string> } & Record<string, unknown>) => queueImport(entity, file, mapping, options),
    onSuccess: (job) => {
      setQueued(job);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "data-jobs") });
    },
    onError,
  });
  return { limit: ON_SCREEN_IMPORT_LIMIT[entity], queue, queued, reset: () => setQueued(null) };
}

export function QueuedImportNotice({ job }: { job: DataJob | null }) {
  if (!job) return null;
  return (
    <Notice tone="info">
      The import of {job.result.rowCount ?? "the"} rows is running in the background. You can leave this page: you will be notified when it finishes, and its result appears below.
    </Notice>
  );
}
