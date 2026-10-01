"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Button,
  ErrorState,
  StatusBadge,
  type SelectOption,
} from "@vercentlabs/design-system";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  LeadLifecycleApiError,
  listLeadStages,
  listLeadStageTransitionReasons,
  setLeadStageTransitionReasonActive,
} from "../api/lead-lifecycle-api";
import { ReasonDialog } from "./ReasonDialog";

export function ReasonsSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stagesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead-stages"),
    queryFn: () => listLeadStages("active"),
  });
  const reasonsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transition-reasons"),
    queryFn: listLeadStageTransitionReasons,
  });
  const reasons = reasonsQuery.data?.rows ?? [];
  const stageOptions: SelectOption[] = (stagesQuery.data?.rows ?? []).map(
    (row) => ({ value: row.id, label: row.name }),
  );
  const stageName = (id: string | null) =>
    stageOptions.find((option) => option.value === id)?.label ??
    "a stage that is no longer in use";

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(
        workspace,
        "crm",
        "lead-stage-transition-reasons",
      ),
    });
  }
  function handleError(err: unknown) {
    setError(
      err instanceof LeadLifecycleApiError
        ? err.message
        : "This action could not be completed.",
    );
  }
  const toggleMutation = useMutation({
    mutationFn: (reason: { id: string; status: "active" | "inactive" }) =>
      setLeadStageTransitionReasonActive(reason.id, reason.status !== "active"),
    onSuccess: invalidate,
    onError: handleError,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">
            Reasons for stage changes
          </h2>
          <p className="text-sm text-text-secondary">
            Sellers choose from these when a move is set to ask for a reason.
          </p>
        </div>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New reason
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
      {reasonsQuery.isLoading && (
        <LoadingState
          label="Loading reasons"
          rows={3}
          onRetry={() => reasonsQuery.refetch()}
        />
      )}
      {reasonsQuery.isError && (
        <ErrorState
          title="Could not load reasons"
          description="Check your connection and try again."
          action={{
            label: "Try again",
            onPress: () => void reasonsQuery.refetch(),
          }}
        />
      )}
      {reasonsQuery.isSuccess && reasons.length === 0 && (
        <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">
          No reasons yet. When a move is set to ask for a reason, sellers pick
          from this list. Add reasons such as &quot;Not interested&quot; or
          &quot;Wrong contact&quot;.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {reasons.map((reason) => (
          <div
            key={reason.id}
            className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm"
          >
            <span className="text-text">
              {reason.label}{" "}
              <span className="text-text-muted">
                (
                {reason.scopeType === "transition"
                  ? `${stageName(reason.fromStageId)} to ${stageName(reason.toStageId)}`
                  : reason.scopeType === "destination"
                    ? `any move into ${stageName(reason.toStageId)}`
                    : "any stage change"}
                )
              </span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge
                tone={reason.status === "active" ? "success" : "neutral"}
              >
                {reason.status === "active" ? "Offered" : "Hidden"}
              </StatusBadge>
              <Button
                variant="ghost"
                size="compact"
                onPress={() => toggleMutation.mutate(reason)}
                isLoading={toggleMutation.isPending}
              >
                {reason.status === "active" ? "Hide" : "Offer again"}
              </Button>
            </span>
          </div>
        ))}
      </div>
      <ReasonDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        stageOptions={stageOptions}
        onSaved={invalidate}
        onError={handleError}
      />
    </section>
  );
}
