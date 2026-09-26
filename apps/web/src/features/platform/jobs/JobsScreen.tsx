"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, PageHeader, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

// Read-only. Shape of GET /api/jobs: labels, safe progress counters and a
// curated (or, for operations viewers, redacted) error. No cancel/retry.
type Job = {
  id: string;
  label: string;
  category: string;
  status: "pending" | "processing" | "completed" | "dead" | "cancelled";
  requestedByMe: boolean;
  requestedByName?: string | null;
  attempts?: number;
  maxAttempts?: number;
  progress: Record<string, number | boolean>;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

const TABS = [
  { key: "all", label: "All" },
  { key: "processing", label: "Running" },
  { key: "pending", label: "Queued" },
  { key: "completed", label: "Completed" },
  { key: "dead", label: "Failed" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATUS: Record<Job["status"], { label: string; tone: "info" | "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "Queued", tone: "neutral" },
  processing: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  dead: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const formatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function progressText(progress: Job["progress"]) {
  const processed = typeof progress.processed === "number" ? progress.processed : null;
  const total = typeof progress.requested === "number" ? progress.requested : typeof progress.total === "number" ? progress.total : null;
  if (processed === null || total === null) return null;
  return `${processed} of ${total} processed`;
}

export function JobsScreen() {
  const workspace = useWorkspaceContext();
  const [tab, setTab] = useState<TabKey>("all");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "jobs", tab),
    queryFn: async () => {
      const response = await fetch(`/api/jobs?status=${tab}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || "Could not load background tasks.");
      return payload as { jobs: Job[]; scope: "mine" | "organization" };
    },
    refetchInterval: 10_000,
  });
  const jobs = query.data?.jobs ?? [];
  const organization = query.data?.scope === "organization";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Background tasks"
        description={organization ? "Every background task in your organization." : "Background tasks you started, such as bulk updates and exports."}
      />
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as TabKey)}>
        <TabList aria-label="Task status" className="overflow-x-auto">
          {TABS.map((entry) => (
            <Tab key={entry.key} id={entry.key}>
              {entry.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load background tasks" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : jobs.length === 0 ? (
        <EmptyState title="No background tasks" description="Tasks you start, such as bulk updates or exports, appear here." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface" aria-label="Background tasks">
          {jobs.map((job) => {
            const progress = progressText(job.progress);
            return (
              <li key={job.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-text">{job.label}</span>
                  <span className="text-xs text-text-muted">
                    {`${job.category} · started ${formatter.format(new Date(job.createdAt))}`}
                    {organization && job.requestedByName ? ` by ${job.requestedByName}` : ""}
                    {job.completedAt ? ` · finished ${formatter.format(new Date(job.completedAt))}` : ""}
                  </span>
                  {progress && <span className="text-xs text-text-secondary">{progress}</span>}
                  {job.error && (
                    <span className="text-xs text-danger" role="note">
                      {job.error}
                    </span>
                  )}
                </div>
                <StatusBadge tone={STATUS[job.status].tone}>{STATUS[job.status].label}</StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
