"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Dialog,
  Select,
  type SelectOption,
} from "@vercentlabs/design-system";
import { addLeadStageTransition } from "../api/lead-lifecycle-api";

export function AddTransitionDialog({
  isOpen,
  onOpenChange,
  stageOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  stageOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [fromStageId, setFromStageId] = useState("");
  const [toStageId, setToStageId] = useState("");
  const [reasonRequired, setReasonRequired] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      addLeadStageTransition(fromStageId, toStageId, reasonRequired),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setFromStageId("");
      setToStageId("");
      setReasonRequired(false);
    },
    onError,
  });

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Allow a stage change"
    >
      <div className="flex flex-col gap-4">
        <Select
          label="From stage"
          options={stageOptions}
          selectedKey={fromStageId}
          onSelectionChange={(key) => setFromStageId(String(key ?? ""))}
        />
        <Select
          label="To stage"
          options={stageOptions}
          selectedKey={toStageId}
          onSelectionChange={(key) => setToStageId(String(key ?? ""))}
        />
        <Checkbox isSelected={reasonRequired} onChange={setReasonRequired}>
          Ask the seller for a reason when they make this move
        </Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!fromStageId || !toStageId || fromStageId === toStageId}
          >
            Allow this move
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
