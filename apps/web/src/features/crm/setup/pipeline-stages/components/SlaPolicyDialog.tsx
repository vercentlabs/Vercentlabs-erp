"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Dialog,
  TextField,
} from "@vercentlabs/design-system";
import {
  saveStageSlaPolicy,
  type StageSlaPolicy,
} from "../api/pipeline-stages-api";
import type { CrmSalesStage } from "../types";

// F010 gap-closure — the SLA policy table's own natural key is
// (pipeline, stage), so this dialog upserts by that key rather than
// requiring a policy id the caller may not have (a stage created after the
// original migration seed has no policy row at all).
export function SlaPolicyDialog({
  stage,
  pipelineId,
  policy,
  onOpenChange,
  onSaved,
  onError,
}: {
  stage: CrmSalesStage;
  pipelineId: string;
  policy: StageSlaPolicy | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const overrideActive =
    policy?.overrideStatus === "active" && policy.overrideDays != null;
  const [enabled, setEnabled] = useState(overrideActive);
  const [maximumDays, setMaximumDays] = useState(
    overrideActive ? String(policy!.overrideDays) : "",
  );

  const mutation = useMutation({
    mutationFn: () =>
      saveStageSlaPolicy(stage.id, {
        pipelineId,
        maximumDays: enabled
          ? Number(maximumDays) || null
          : (policy?.overrideDays ?? null),
        status: enabled ? "active" : "inactive",
        expectedUpdatedAt: policy?.updatedAt ?? null,
      }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <Dialog
      isOpen
      onOpenChange={onOpenChange}
      title={`SLA for ${stage.name}`}
      description={`Overrides the stage's own "stale after" default with a value specific to this pipeline. Deals in this stage past the threshold are flagged stalled on the dashboard, the Opportunities list, and the Pipeline board.`}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">{`Without an override, this stage falls back to "Stale after" (${stage.staleAfterDays ? `${stage.staleAfterDays} days` : "never"}).`}</p>
        <Checkbox isSelected={enabled} onChange={setEnabled}>
          Set a pipeline-specific SLA for this stage
        </Checkbox>
        {enabled && (
          <TextField
            label="Maximum days in stage"
            value={maximumDays}
            onChange={setMaximumDays}
            placeholder="e.g. 14"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={
              enabled && (!maximumDays.trim() || Number(maximumDays) < 1)
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
