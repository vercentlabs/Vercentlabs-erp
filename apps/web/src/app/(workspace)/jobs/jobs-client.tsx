"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListTodo } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type BackgroundJob = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
  progress: { processed?: number; total?: number } | null;
};

const STATUS_TABS = [
  "all",
  "pending",
  "processing",
  "completed",
  "dead",
] as const;
const STATUS_LABEL: Record<string, string> = { dead: "failed" };

async function fetchJobs(status: string): Promise<BackgroundJob[]> {
  const response = await fetch(`/api/jobs?status=${status}`);
  const payload = (await response.json()) as {
    ok: boolean;
    jobs?: BackgroundJob[];
    message?: string;
  };
  if (!response.ok || !payload.ok)
    throw new Error(payload.message || "Could not load background jobs.");
  return payload.jobs ?? [];
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function statusBadgeClass(status: string) {
  if (status === "completed") return "bg-success-soft text-success";
  if (status === "dead") return "bg-danger-soft text-danger";
  if (status === "processing") return "bg-brand-soft text-brand";
  return "bg-surface-muted text-text-secondary";
}

export function JobsClient() {
  const workspace = useWorkspaceContext();
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]>("all");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "background-jobs", status),
    queryFn: () => fetchJobs(status),
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">Background Jobs</h1>

      <div className="flex gap-1 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setStatus(tab)}
            className={[
              "border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors",
              status === tab
                ? "border-brand text-brand"
                : "border-transparent text-text-secondary hover:text-text",
            ].join(" ")}
          >
            {STATUS_LABEL[tab] || tab}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading jobs…</p>
      ) : query.isError ? (
        <p className="text-sm text-danger">
          Could not load background jobs. Try again.
        </p>
      ) : (query.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ListTodo aria-hidden="true" className="size-8 text-text-muted" />
          <p className="text-sm text-text-secondary">No jobs here.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-panel)] border border-border">
          {(query.data ?? []).map((job) => {
            // Only ever a real backend-reported number — no invented percentage.
            const progressText =
              job.progress?.total != null && job.progress?.processed != null
                ? `${job.progress.processed} / ${job.progress.total}`
                : null;
            return (
              <li
                key={job.id}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-text">
                    {job.job_type}
                  </p>
                  <p className="text-xs text-text-muted">
                    {dateFormatter.format(new Date(job.created_at))}
                    {job.attempts > 1
                      ? ` · attempt ${job.attempts}/${job.max_attempts}`
                      : ""}
                    {progressText ? ` · ${progressText}` : ""}
                  </p>
                  {job.last_error ? (
                    <p className="text-xs text-danger">{job.last_error}</p>
                  ) : null}
                </div>
                <span
                  className={[
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                    statusBadgeClass(job.status),
                  ].join(" ")}
                >
                  {STATUS_LABEL[job.status] || job.status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
