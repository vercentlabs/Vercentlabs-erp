"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, TextField } from "@vercentlabs/design-system";
import { createLeadStage, updateLeadStage } from "../api/lead-lifecycle-api";
import type { LeadStage } from "../types";

export function StageDialog({
  isOpen,
  onOpenChange,
  stage,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  stage: LeadStage | null;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(stage?.name ?? "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(stage?.sortOrder ?? 100));
  const [dwellWarningHours, setDwellWarningHours] = useState(
    stage?.dwellWarningHours != null ? String(stage.dwellWarningHours) : "",
  );
  const [dwellBreachHours, setDwellBreachHours] = useState(
    stage?.dwellBreachHours != null ? String(stage.dwellBreachHours) : "",
  );

  const [seededFor, setSeededFor] = useState<LeadStage | null | undefined>(
    undefined,
  );
  if (isOpen && stage !== seededFor) {
    setSeededFor(stage);
    setName(stage?.name ?? "");
    setDescription(stage?.description ?? "");
    setSortOrder(String(stage?.sortOrder ?? 100));
    setDwellWarningHours(
      stage?.dwellWarningHours != null ? String(stage.dwellWarningHours) : "",
    );
    setDwellBreachHours(
      stage?.dwellBreachHours != null ? String(stage.dwellBreachHours) : "",
    );
  }

  const input = {
    name,
    description: description || null,
    sortOrder: Number(sortOrder) || 0,
    dwellWarningHours: dwellWarningHours ? Number(dwellWarningHours) : null,
    dwellBreachHours: dwellBreachHours ? Number(dwellBreachHours) : null,
  };
  const mutation = useMutation({
    mutationFn: () =>
      stage ? updateLeadStage(stage.id, input) : createLeadStage(input),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={stage ? `Edit ${stage.name}` : "New Lead lifecycle stage"}
    >
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField
          label="Description"
          value={description}
          onChange={setDescription}
        />
        <TextField
          label="Position in the list"
          description="Lower numbers come first. Leave as is to place it at the end."
          inputMode="numeric"
          value={sortOrder}
          onChange={setSortOrder}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Flag as slow after (hours)"
            description="Optional. Leads stuck this long are highlighted."
            inputMode="numeric"
            value={dwellWarningHours}
            onChange={setDwellWarningHours}
          />
          <TextField
            label="Flag as overdue after (hours)"
            description="Optional. Must be longer than the slow flag."
            inputMode="numeric"
            value={dwellBreachHours}
            onChange={setDwellBreachHours}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!name.trim()}
          >
            {stage ? "Save changes" : "Create stage"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
