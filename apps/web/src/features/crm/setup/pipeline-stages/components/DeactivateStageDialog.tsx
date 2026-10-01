"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  Select,
  type SelectOption,
} from "@vercentlabs/design-system";
import {
  deactivateStageWithMigration,
  PipelineStagesApiError,
} from "../api/pipeline-stages-api";
import type { CrmSalesStage } from "../types";

// F012 gap-closure — deactivateSalesStageWithMigration/enqueueOpportunity
// StageMigrationJob existed, tested, and (the job processor) wired to a
// real worker handler since this file was first written, but nothing ever
// called the enqueue entry point: an admin blocked by
// CRM_SALES_STAGE_OPEN_OPPORTUNITIES had no way to do what the error
// message told them to ("choose a replacement stage to migrate them").
// Mirrors LeadLifecycleSettingsScreen.tsx's DeactivateStageDialog exactly —
// same contract (deactivated:false means "migration enqueued, retry later"),
// same copy pattern, applied to Sales Stages instead of Lead Stages.
export function DeactivateStageDialog({
  stage,
  allStages,
  onOpenChange,
  onDone,
  onError,
}: {
  stage: CrmSalesStage;
  allStages: CrmSalesStage[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}) {
  const [migrateToStageId, setMigrateToStageId] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  const otherStageOptions: SelectOption[] = allStages
    .filter((row) => row.id !== stage.id && row.status === "active")
    .map((row) => ({ value: row.id, label: row.name }));

  const mutation = useMutation({
    mutationFn: () =>
      deactivateStageWithMigration(
        stage.id,
        migrateToStageId || undefined,
        stage.updatedAt,
      ),
    onSuccess: (result) => {
      if (!result.deactivated) {
        setBlocked(
          "Opportunities are being moved. The stage deactivates as soon as the last one has moved.",
        );
        return;
      }
      onDone();
      onOpenChange(false);
      setBlocked(null);
      setMigrateToStageId("");
    },
    onError: (err) => {
      if (
        err instanceof PipelineStagesApiError &&
        err.code === "CRM_SALES_STAGE_OPEN_OPPORTUNITIES"
      ) {
        setBlocked(err.message);
        return;
      }
      onError(err);
    },
  });

  return (
    <Dialog
      isOpen
      onOpenChange={onOpenChange}
      title={`Deactivate ${stage.name}`}
    >
      <div className="flex flex-col gap-4">
        {blocked && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning"
          >
            {blocked}
          </p>
        )}
        <p className="text-sm text-text-secondary">
          Deactivating a stage removes it from the &quot;Move to stage&quot;
          options. If Opportunities are still on it, choose the stage they
          should move to. Nothing is deleted, and you can reactivate the stage
          later.
        </p>
        <Select
          label="Migrate open Opportunities to"
          options={[
            {
              value: "",
              label: "Do not move Opportunities (blocked if any remain)",
            },
            ...otherStageOptions,
          ]}
          selectedKey={migrateToStageId}
          onSelectionChange={(key) => setMigrateToStageId(String(key ?? ""))}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
          >
            Deactivate stage
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
