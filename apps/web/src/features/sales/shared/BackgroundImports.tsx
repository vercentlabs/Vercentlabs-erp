"use client";

// Sales imports that run in the background (Line-by-line audit P5): a file with more rows than an import takes on screen is handed
// to the worker; the person keeps working, is notified when it finishes, and downloads the rows to fix from here.
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, buttonVariants } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { SalesApiError, request } from "./http";
import { dateTime } from "./format";

export type SalesDataJobEntity = "customers" | "customer_addresses" | "customer_contacts" | "prices";
export type SalesDataJob = {
  id: string; entity: SalesDataJobEntity; entityLabel: string; status: "queued" | "running" | "succeeded" | "failed"; fileName: string | null;
  result: { rowCount?: number; total?: number; created?: number; added?: number; updated?: number; linked?: number; skipped?: number; review?: number; failed?: number };
  error: string | null; hasOutput: boolean; requestedAt: string; completedAt: string | null;
};

// Queues the import of `file` in the background.
export async function startBackgroundImport(input: { entity: SalesDataJobEntity; file: File; mapping: Record<string, string>; options?: Record<string, unknown> }) {
  const form = new FormData();
  form.set("entity", input.entity);
  form.set("file", input.file);
  form.set("mapping", JSON.stringify(input.mapping));
  form.set("options", JSON.stringify(input.options ?? {}));
  const response = await fetch("/api/sales/data-jobs", { method: "POST", body: form, credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The import could not be started.", response.status, payload.code, payload);
  return payload.job as SalesDataJob;
}

const TONE = { queued: "neutral", running: "info", succeeded: "success", failed: "danger" } as const;
const LABEL = { queued: "Waiting", running: "Importing", succeeded: "Finished", failed: "Failed" } as const;

export function backgroundJobsKey(workspace: ReturnType<typeof useWorkspaceContext>, entities: SalesDataJobEntity[]) {
  return scopedQueryKey(workspace, "sales", "data-jobs", entities.join(","));
}

// The person's recent background imports of these kinds, refreshed while one is still running.
export function BackgroundImports({ entities }: { entities: SalesDataJobEntity[] }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: backgroundJobsKey(workspace, entities),
    queryFn: () => request<{ jobs: SalesDataJob[] }>(`/data-jobs?entities=${entities.join(",")}`).then((r) => r.jobs),
    refetchInterval: (state) => (state.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 5000 : false),
  });
  const jobs = query.data ?? [];
  if (!jobs.length) return null;
  return (
    <section aria-label="Background imports" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-base font-semibold">Imports running in the background</h2>
      <ul className="flex flex-col divide-y divide-border">
        {jobs.map((job) => {
          const done = (job.result.created ?? job.result.added ?? 0) + (job.result.updated ?? 0) + (job.result.linked ?? 0);
          const notDone = (job.result.failed ?? 0) + (job.result.skipped ?? 0) + (job.result.review ?? 0);
          return (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex flex-col">
                <span className="font-medium">{job.fileName ?? job.entityLabel} · {job.entityLabel}</span>
                <span className="text-xs text-text-muted">
                  Started {dateTime(job.requestedAt)}
                  {job.status === "succeeded" ? ` · ${done} of ${job.result.total ?? job.result.rowCount ?? 0} imported${notDone ? `, ${notDone} not imported` : ""}` : ""}
                  {job.status !== "succeeded" && job.result.rowCount ? ` · ${job.result.rowCount} rows` : ""}
                  {job.error ? ` · ${job.error}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={TONE[job.status]}>{LABEL[job.status]}</Badge>
                {job.hasOutput && (
                  <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={`/api/sales/data-jobs/${job.id}/download`} download>
                    <Download className="size-4" aria-hidden="true" />Rows to fix
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
