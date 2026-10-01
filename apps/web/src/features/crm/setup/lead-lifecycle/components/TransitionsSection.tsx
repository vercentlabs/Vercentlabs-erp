"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  Button,
  ErrorState,
  type SelectOption,
} from "@vercentlabs/design-system";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  LeadLifecycleApiError,
  listLeadStages,
  listLeadStageTransitions,
  removeLeadStageTransition,
} from "../api/lead-lifecycle-api";
import { AddTransitionDialog } from "./AddTransitionDialog";

export function TransitionsSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stagesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead-stages"),
    queryFn: () => listLeadStages("active"),
  });
  const transitionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions"),
    queryFn: listLeadStageTransitions,
  });
  const transitions = useMemo(
    () => transitionsQuery.data?.rows ?? [],
    [transitionsQuery.data],
  );
  const [removingEdge, setRemovingEdge] = useState<
    (typeof transitions)[number] | null
  >(null);
  const groupedTransitions = useMemo(() => {
    const groups = new Map<
      string,
      { fromName: string; edges: typeof transitions }
    >();
    for (const edge of transitions) {
      const group = groups.get(edge.fromStageId) ?? {
        fromName: edge.fromStageName,
        edges: [],
      };
      group.edges.push(edge);
      groups.set(edge.fromStageId, group);
    }
    return groups;
  }, [transitions]);
  const stageOptions: SelectOption[] = (stagesQuery.data?.rows ?? []).map(
    (row) => ({ value: row.id, label: row.name }),
  );

  function invalidate() {
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
  const removeMutation = useMutation({
    mutationFn: (edge: { fromStageId: string; toStageId: string }) =>
      removeLeadStageTransition(edge.fromStageId, edge.toStageId),
    onSuccess: invalidate,
    onError: handleError,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Allowed moves</h2>
          <p className="text-sm text-text-secondary">
            For each stage, the stages a lead may move to. Only these appear in
            a lead&apos;s &quot;Move to stage&quot; picker.
          </p>
        </div>
        <Button variant="primary" onPress={() => setAddOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add a move
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
      {transitionsQuery.isLoading && (
        <LoadingState
          label="Loading transitions"
          rows={3}
          onRetry={() => transitionsQuery.refetch()}
        />
      )}
      {transitionsQuery.isError && (
        <ErrorState
          title="Could not load transitions"
          description="Check your connection and try again."
          action={{
            label: "Try again",
            onPress: () => void transitionsQuery.refetch(),
          }}
        />
      )}
      {transitionsQuery.isSuccess && transitions.length === 0 && (
        <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">
          No moves are allowed yet, so sellers cannot change a lead&apos;s
          stage. Add a transition to say which stage a lead may move to from
          each stage.
        </p>
      )}
      <ul aria-label="Allowed moves by stage" className="flex flex-col gap-2">
        {[...groupedTransitions.entries()].map(([fromStageId, group]) => (
          <li
            key={fromStageId}
            className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm sm:flex-row sm:items-center"
          >
            <span className="w-44 shrink-0 font-medium text-text">
              {group.fromName}
            </span>
            <span className="text-text-muted">can move to</span>
            <ul className="flex flex-wrap gap-2">
              {group.edges.map((edge) => (
                <li
                  key={edge.toStageId}
                  className="flex items-center gap-1 rounded-full border border-border bg-surface-muted py-0.5 pl-3 pr-1"
                >
                  <span className="text-text">{edge.toStageName}</span>
                  {edge.reasonRequired && (
                    <span className="text-xs text-text-muted">
                      (needs a reason)
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="compact"
                    aria-label={
                      "Stop allowing " +
                      edge.fromStageName +
                      " to " +
                      edge.toStageName
                    }
                    onPress={() => setRemovingEdge(edge)}
                  >
                    <span aria-hidden="true">&times;</span>
                  </Button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {removingEdge && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setRemovingEdge(null);
          }}
          title="Stop allowing this move?"
          description={
            "Sellers will no longer be able to move a lead from " +
            removingEdge.fromStageName +
            " to " +
            removingEdge.toStageName +
            ". Leads already in either stage stay where they are."
          }
          confirmLabel="Stop allowing"
          isConfirming={removeMutation.isPending}
          onConfirm={() =>
            removeMutation.mutate(removingEdge, {
              onSettled: () => setRemovingEdge(null),
            })
          }
        />
      )}
      <AddTransitionDialog
        isOpen={addOpen}
        onOpenChange={setAddOpen}
        stageOptions={stageOptions}
        onSaved={invalidate}
        onError={handleError}
      />
    </section>
  );
}
