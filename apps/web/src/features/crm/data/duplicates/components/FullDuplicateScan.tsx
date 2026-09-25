"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { humanize } from "@/features/crm/shared/human";

import {
  DuplicateScanApiError,
  getDuplicateScanJob,
  getLatestDuplicateScan,
  listDuplicateScanMatches,
  startDuplicateScan,
  type DuplicateScanEntityType,
} from "../api/duplicate-scan-api";

const RUNNING_STATUSES = new Set(["pending", "processing"]);

// F008 gap-closure — a genuine full-dataset duplicate scan (background
// job), distinct from SuspectedDuplicates' honestly-scoped 40-most-recent-
// records check above it on this same screen. Both call the SAME governed
// matching engine server-side; this one just pages through every record
// instead of the 40 most recently changed.
export function FullDuplicateScan({ type, onReview }: { type: DuplicateScanEntityType; onReview: (recordId: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const noun = type === "account" ? "accounts" : `${type}s`;

  const latestQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "duplicate-scan", "latest", type),
    queryFn: () => getLatestDuplicateScan(type),
  });

  const startMutation = useMutation({
    mutationFn: () => startDuplicateScan(type),
    onSuccess: ({ job }) => queryClient.setQueryData(scopedQueryKey(workspace, "crm", "duplicate-scan", "latest", type), { job }),
  });

  const job = latestQuery.data?.job ?? null;
  const jobQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "duplicate-scan", "job", job?.id ?? ""),
    queryFn: () => getDuplicateScanJob(job!.id),
    enabled: Boolean(job?.id),
    refetchInterval: (query) => (RUNNING_STATUSES.has(query.state.data?.job?.status ?? "") ? 2000 : false),
    initialData: job ? { job } : undefined,
  });
  const activeJob = jobQuery.data?.job ?? job;

  const matchesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "duplicate-scan", "matches", activeJob?.id ?? ""),
    queryFn: () => listDuplicateScanMatches(activeJob!.id),
    enabled: activeJob?.status === "completed",
  });

  const isRunning = Boolean(activeJob) && RUNNING_STATUSES.has(activeJob?.status ?? "");
  const matches = matchesQuery.data?.rows ?? [];

  return (
    <section aria-label="Full duplicate scan" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Full scan</h2>
          <p className="text-xs text-text-muted">{`Checks every active ${type} record, not just the ${40} most recently changed. Runs in the background — you can leave this page while it works.`}</p>
        </div>
        <Button variant="secondary" size="compact" onPress={() => startMutation.mutate()} isDisabled={isRunning} isLoading={startMutation.isPending}>
          {isRunning ? "Scan running…" : "Run full scan"}
        </Button>
      </div>

      {startMutation.isError && (
        <p role="alert" className="text-sm text-danger">
          {startMutation.error instanceof DuplicateScanApiError ? startMutation.error.message : "The scan could not be started."}
        </p>
      )}

      {isRunning && (
        <p className="text-sm text-text-secondary">
          {`Scanning… ${activeJob?.progress?.processed ?? 0} ${noun} checked so far, ${activeJob?.progress?.found ?? 0} suspected pair(s) found.`}
        </p>
      )}

      {activeJob?.status === "dead" && <p role="alert" className="text-sm text-danger">{activeJob.lastError || "The scan failed. Try again."}</p>}

      {activeJob?.status === "completed" && (
        <>
          <p className="text-xs text-text-muted">
            {`Last full scan: ${new Date(activeJob.completedAt || activeJob.updatedAt).toLocaleString()} — ${activeJob.resultManifest?.processed ?? 0} ${noun} checked, ${activeJob.resultManifest?.found ?? 0} suspected pair(s) found.`}
          </p>
          {matchesQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading results…</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-text-secondary">No suspected duplicates found across the full dataset.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {matches.map((match) => (
                <li key={match.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-text">
                      {match.recordAName || "(deleted record)"} <span className="text-text-muted">and</span> {match.recordBName || "(deleted record)"}
                    </span>
                    <span className="text-xs text-text-muted">{match.matchedSignals.length ? `Matched on ${match.matchedSignals.map((s) => humanize(s).toLowerCase()).join(", ")}` : "Similar details"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${match.classification === "exact" ? "border-danger-emphasis/30 bg-danger-soft text-danger" : "border-warning-emphasis/30 bg-warning-soft text-warning"}`}>
                      {match.classification === "exact" ? "Very likely" : "Possible"}
                    </span>
                    <Button variant="secondary" size="compact" onPress={() => onReview(match.recordAId)}>Review</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
