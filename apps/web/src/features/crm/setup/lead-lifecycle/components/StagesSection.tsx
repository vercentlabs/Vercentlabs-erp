"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button, ErrorState, StatusBadge } from "@vercentlabs/design-system";
import { formatMinutes } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  LeadLifecycleApiError,
  listLeadStages,
  reactivateLeadStage,
} from "../api/lead-lifecycle-api";
import type { LeadStage } from "../types";
import { StageDialog } from "./StageDialog";
import { DeactivateStageDialog } from "./DeactivateStageDialog";

export function StagesSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<LeadStage | null>(null);
  const [deactivatingStage, setDeactivatingStage] = useState<LeadStage | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead-stages"),
    queryFn: () => listLeadStages("all"),
  });
  const stages = useMemo(
    () =>
      [...(query.data?.rows ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [query.data],
  );

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "lead-stages"),
    });
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions"),
    });
  }
  function handleError(err: unknown) {
    setError(
      err instanceof LeadLifecycleApiError
        ? err.message
        : "This action could not be completed.",
    );
  }

  const reactivateMutation = useMutation({
    mutationFn: (stage: LeadStage) => reactivateLeadStage(stage.id),
    onSuccess: invalidate,
    onError: handleError,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">
            Lead lifecycle stages
          </h2>
          <p className="text-sm text-text-secondary">
            Governs the &quot;Move to stage&quot; options on every Lead.
          </p>
        </div>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New stage
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {query.isLoading && (
        <LoadingState
          label="Loading stages"
          rows={4}
          onRetry={() => query.refetch()}
        />
      )}
      {query.isError && (
        <ErrorState
          title="Could not load stages"
          description="Check your connection and try again."
          action={{ label: "Try again", onPress: () => void query.refetch() }}
        />
      )}
      {query.isSuccess && stages.length === 0 && (
        <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">
          No stages yet. Stages describe how far a prospect has progressed, for
          example New, Contacted, Working. Use the recommended template above to
          start with a standard set, or add your own.
        </p>
      )}
      <ol aria-label="Lead stages in order" className="flex flex-col gap-2">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-text-muted"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col text-sm">
                <span className="font-medium text-text">
                  {stage.name}{" "}
                  {stage.isInitial && (
                    <span className="font-normal text-text-muted">
                      (where every new lead starts)
                    </span>
                  )}
                </span>
                {stage.description && (
                  <span className="text-text-secondary">
                    {stage.description}
                  </span>
                )}
                <span className="text-xs text-text-muted">
                  {`${stage.leadCount} lead${stage.leadCount === 1 ? "" : "s"} here now`}
                  {stage.dwellWarningHours
                    ? `. Flagged after ${formatMinutes(Number(stage.dwellWarningHours) * 60)}`
                    : ""}
                  {stage.dwellBreachHours
                    ? `, overdue after ${formatMinutes(Number(stage.dwellBreachHours) * 60)}`
                    : ""}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={stage.status === "active" ? "success" : "neutral"}
              >
                {stage.status === "active" ? "In use" : "Retired"}
              </StatusBadge>
              <Button
                variant="outline"
                size="compact"
                aria-label={`Edit ${stage.name}`}
                onPress={() => setEditingStage(stage)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              {stage.status === "active" ? (
                !stage.isInitial && (
                  <Button
                    variant="danger"
                    size="compact"
                    aria-label={`Retire ${stage.name}`}
                    onPress={() => setDeactivatingStage(stage)}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                  </Button>
                )
              ) : (
                <Button
                  variant="outline"
                  size="compact"
                  aria-label={`Bring ${stage.name} back`}
                  onPress={() => reactivateMutation.mutate(stage)}
                  isLoading={reactivateMutation.isPending}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <StageDialog
        isOpen={createOpen || Boolean(editingStage)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditingStage(null);
          }
        }}
        stage={editingStage}
        onSaved={invalidate}
        onError={handleError}
      />
      <DeactivateStageDialog
        stage={deactivatingStage}
        allStages={stages}
        onOpenChange={(open) => !open && setDeactivatingStage(null)}
        onDone={invalidate}
        onError={handleError}
      />
    </section>
  );
}
