"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  Select,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { createLeadStageTransitionReason } from "../api/lead-lifecycle-api";
import type { TransitionReasonScope } from "../types";

export function ReasonDialog({
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
  const [scopeType, setScopeType] = useState<TransitionReasonScope>("any");
  const [fromStageId, setFromStageId] = useState("");
  const [toStageId, setToStageId] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      createLeadStageTransitionReason({
        scopeType,
        fromStageId: scopeType === "transition" ? fromStageId : undefined,
        toStageId: scopeType !== "any" ? toStageId : undefined,
        code,
        label,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setCode("");
      setLabel("");
      setCodeEdited(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New reason">
      <div className="flex flex-col gap-4">
        <Select
          label="Applies to"
          options={[
            { value: "any", label: "Any transition" },
            {
              value: "destination",
              label: "Any transition into a specific stage",
            },
            { value: "transition", label: "One specific transition" },
          ]}
          selectedKey={scopeType}
          onSelectionChange={(key) =>
            setScopeType((key as TransitionReasonScope) ?? "any")
          }
        />
        {scopeType === "transition" && (
          <Select
            label="From stage"
            options={stageOptions}
            selectedKey={fromStageId}
            onSelectionChange={(key) => setFromStageId(String(key ?? ""))}
          />
        )}
        {scopeType !== "any" && (
          <Select
            label="To stage"
            options={stageOptions}
            selectedKey={toStageId}
            onSelectionChange={(key) => setToStageId(String(key ?? ""))}
          />
        )}
        <TextField
          label="Reason shown to sellers"
          value={label}
          onChange={(v) => {
            setLabel(v);
            if (!codeEdited)
              setCode(
                v
                  .toLowerCase()
                  .trim()
                  .replace(/[^a-z0-9]+/g, "_")
                  .replace(/^_|_$/g, ""),
              );
          }}
        />
        <TextField
          label="Short internal code"
          description="Made from the reason. Lowercase letters, numbers and underscores. Used in reports."
          value={code}
          onChange={(v) => {
            setCodeEdited(true);
            setCode(v.toLowerCase());
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!code.trim() || !label.trim()}
          >
            Create reason
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
