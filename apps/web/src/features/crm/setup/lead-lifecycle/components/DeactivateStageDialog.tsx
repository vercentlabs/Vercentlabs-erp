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
  deactivateLeadStage,
  LeadLifecycleApiError,
} from "../api/lead-lifecycle-api";
import type { LeadStage } from "../types";

export function DeactivateStageDialog({
  stage,
  allStages,
  onOpenChange,
  onDone,
  onError,
}: {
  stage: LeadStage | null;
  allStages: LeadStage[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}) {
  const [migrateToStageId, setMigrateToStageId] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  const otherStageOptions: SelectOption[] = allStages
    .filter((row) => row.id !== stage?.id && row.status === "active")
    .map((row) => ({ value: row.id, label: row.name }));

  const mutation = useMutation({
    mutationFn: () =>
      deactivateLeadStage(stage!.id, migrateToStageId || undefined),
    onSuccess: (result) => {
      if (!result.deactivated) {
        setBlocked(
          "Leads are being moved. The stage retires as soon as the last one has moved.",
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
        err instanceof LeadLifecycleApiError &&
        err.code === "CRM_LEAD_STAGE_HAS_ACTIVE_LEADS"
      ) {
        setBlocked(err.message);
        return;
      }
      onError(err);
    },
  });

  return (
    <Dialog
      isOpen={Boolean(stage)}
      onOpenChange={onOpenChange}
      title={stage ? `Retire ${stage.name}` : "Retire stage"}
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
          Retiring a stage removes it from the &quot;Move to stage&quot;
          options. If leads are still on it, choose the stage they should move
          to. Nothing is deleted, and you can bring the stage back later.
        </p>
        <Select
          label="Migrate active Leads to"
          options={[
            { value: "", label: "Do not move leads (blocked if any remain)" },
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
            Retire stage
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
