"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, TextField } from "@vercentlabs/design-system";
import { createPipeline } from "../api/pipeline-stages-api";
import type { CrmPipeline } from "../types";

export function PipelineDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (pipeline: CrmPipeline) => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const mutation = useMutation({
    mutationFn: () => createPipeline({ name, code }),
    onSuccess: ({ record }) => {
      onCreated(record);
      onOpenChange(false);
      setName("");
      setCode("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New pipeline">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!name.trim() || !code.trim()}
          >
            Create pipeline
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
