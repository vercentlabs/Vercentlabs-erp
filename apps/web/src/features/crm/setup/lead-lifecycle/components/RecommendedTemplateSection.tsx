"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@vercentlabs/design-system";
import { humanize } from "@/shared/format/human";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  applyLeadStageTemplateUpgrade,
  LeadLifecycleApiError,
  previewLeadStageTemplateUpgrade,
  type LeadStageTemplatePreview,
} from "../api/lead-lifecycle-api";

// F007: "Apply recommended Vercentlabs 5-stage template" — only meaningful
// once a customization exists to diff against (an untouched organization is
// already auto-upgraded by ensureDefaultLeadStages, and re-checking here
// would just show an empty preview every time). Purely additive: creates
// only what's missing, never renames/removes an existing stage or edge.
export function RecommendedTemplateSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<LeadStageTemplatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const previewMutation = useMutation({
    mutationFn: previewLeadStageTemplateUpgrade,
    onSuccess: (result) => {
      setPreview(result);
      setPreviewOpen(true);
      setError(null);
      setApplied(false);
    },
    onError: (err) =>
      setError(
        err instanceof LeadLifecycleApiError
          ? err.message
          : "The recommended template could not be checked.",
      ),
  });
  const applyMutation = useMutation({
    mutationFn: applyLeadStageTemplateUpgrade,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "lead-stages"),
      });
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions"),
      });
      setApplied(true);
    },
    onError: (err) =>
      setError(
        err instanceof LeadLifecycleApiError
          ? err.message
          : "The recommended template could not be applied.",
      ),
  });

  const hasChanges = Boolean(
    preview &&
    (preview.stagesToCreate.length > 0 || preview.edgesToAdd.length > 0),
  );

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text">
            Vercentlabs standard 5-stage template
          </h2>
          <p className="text-sm text-text-secondary">
            New / Attempting Contact / Connected / Working &amp; Discovery /
            Nurturing. If your stages have been customized, check what&apos;s
            missing and add it without touching anything you&apos;ve already
            configured.
          </p>
        </div>
        <Button
          variant="secondary"
          onPress={() => previewMutation.mutate()}
          isLoading={previewMutation.isPending}
        >
          Check recommended template
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
      <Dialog
        isOpen={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setApplied(false);
        }}
        title="Apply recommended Vercentlabs 5-stage template"
        size="lg"
      >
        <div className="flex flex-col gap-4">
          {applied ? (
            <p
              role="status"
              className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm text-success"
            >
              Applied. {preview?.stagesToCreate.length ?? 0} stage(s) and{" "}
              {preview?.edgesToAdd.length ?? 0} transition(s) were added.
            </p>
          ) : !hasChanges ? (
            <p className="text-sm text-text-secondary">
              Your Lead lifecycle already includes everything in the recommended
              template. Nothing to add.
            </p>
          ) : (
            <>
              {preview!.stagesToCreate.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-text">
                    Stages to create
                  </p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-text-secondary">
                    {preview!.stagesToCreate.map((stage) => (
                      <li key={stage.code}>
                        <span className="font-medium text-text">
                          {stage.name}
                        </span>{" "}
                        — {stage.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview!.edgesToAdd.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-text">
                    Transitions to add
                  </p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-text-secondary">
                    {preview!.edgesToAdd.map((edge) => (
                      <li key={`${edge.fromCode}-${edge.toCode}`}>
                        {humanize(edge.fromCode)} to {humanize(edge.toCode)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-text-secondary">
                {preview!.affectedLeadCount} active Lead(s) in your pipeline
                today. This is purely additive — no existing stage, label or
                transition is changed or removed, and no Lead is moved.
              </p>
              {preview!.conflicts.length > 0 && (
                <div className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2">
                  <p className="text-sm font-medium text-warning">
                    Resolve before applying
                  </p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-warning">
                    {preview!.conflicts.map((conflict) => (
                      <li key={conflict.code}>{conflict.issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setPreviewOpen(false)}>
              {applied || !hasChanges ? "Close" : "Cancel"}
            </Button>
            {!applied && hasChanges && (
              <Button
                variant="primary"
                onPress={() => applyMutation.mutate()}
                isLoading={applyMutation.isPending}
                isDisabled={(preview?.conflicts.length ?? 0) > 0}
              >
                Apply recommended template
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </section>
  );
}
