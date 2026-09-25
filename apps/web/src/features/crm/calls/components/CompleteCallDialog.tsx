"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import { completeCall } from "../api/calls-api";
import { OUTCOME_OPTIONS } from "../constants";
import type { Call } from "../types";

// F013 gap-closure — the only place completeCall was ever invoked from the
// UI (CallListScreen's row action) hardcoded outcomeCode to "connected"
// with no way to record what actually happened, even though the backend
// (call-operations.js's OUTCOMES set) and the create form's "log" mode both
// fully support the 7-value outcome list. Shared here so the list screen's
// row action and the detail screen's action both go through the same real
// picker instead of a second one drifting from this file over time.
export function CompleteCallDialog({
  call,
  onOpenChange,
  onDone,
  onError,
}: {
  call: Call;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}) {
  const [outcomeCode, setOutcomeCode] = useState("connected");
  const [outcome, setOutcome] = useState("");

  const mutation = useMutation({
    mutationFn: () => completeCall(call.id, outcomeCode, outcome || undefined, call.updatedAt),
    onSuccess: () => {
      onDone();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen onOpenChange={onOpenChange} title={`Complete ${call.subject}`}>
      <div className="flex flex-col gap-4">
        <Select label="Outcome" options={OUTCOME_OPTIONS} selectedKey={outcomeCode} onSelectionChange={(key) => setOutcomeCode(String(key ?? "connected"))} />
        <TextArea label="Notes" placeholder="Optional" value={outcome} onChange={setOutcome} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            Complete call
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
