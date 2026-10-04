"use client";

// Change stage and disqualify — used for one lead (from its page) and for many
// (bulk selection on the list). Both go through the bulk operation, which
// reports each lead's outcome. Assigning lives in LeadAssignment.tsx.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import { bulkLeadAction, errorMessage, type LeadBulkResult, type LeadOptions } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";

type ActionDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  options: LeadOptions;
  onDone: (result: LeadBulkResult) => void;
};

function plural(count: number) {
  return count === 1 ? "this lead" : `${count} leads`;
}

// A single lead's refusal is an error to show; in bulk the list summarises it.
function singleFailure(result: LeadBulkResult) {
  return result.results.length === 1 && !result.results[0].ok ? (result.results[0].message ?? "The change could not be saved.") : null;
}

function useBulkAction(leadIds: string[], onDone: (result: LeadBulkResult) => void, close: () => void) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: { action: "stage" | "disqualify" } & Record<string, unknown>) => bulkLeadAction({ ...input, leadIds }),
    onSuccess: (result) => {
      const failure = singleFailure(result);
      if (failure) return setError(failure);
      setError(null);
      onDone(result);
      close();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return { error, mutation };
}

function DialogActions({ onCancel, onConfirm, confirmLabel, isLoading, isDisabled, danger }: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  isLoading: boolean;
  isDisabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onPress={onConfirm} isLoading={isLoading} isDisabled={isDisabled}>{confirmLabel}</Button>
    </div>
  );
}

export function ChangeStageDialog({ isOpen, onOpenChange, leadIds, options, onDone, currentStage }: ActionDialogProps & { currentStage?: string }) {
  const [stage, setStage] = useState(currentStage ?? "");
  const { error, mutation } = useBulkAction(leadIds, onDone, () => onOpenChange(false));

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Change stage of ${plural(leadIds.length)}`} description="The stage shows where the lead is in your process. It can change only while the lead is open.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select
          label="Stage"
          isRequired
          selectedKey={stage}
          onSelectionChange={(key) => setStage(String(key))}
          options={options.stages.map((entry) => ({ value: entry.code, label: entry.label }))}
        />
        <DialogActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Change stage"
          isLoading={mutation.isPending}
          isDisabled={!stage}
          onConfirm={() => mutation.mutate({ action: "stage", stage })}
        />
      </div>
    </Dialog>
  );
}

export function DisqualifyLeadsDialog({ isOpen, onOpenChange, leadIds, options, onDone }: ActionDialogProps) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  // Open follow-ups are cancelled, unless the timing was wrong and the salesperson wants to come back later.
  const [followUps, setFollowUps] = useState("");
  const { error, mutation } = useBulkAction(leadIds, onDone, () => onOpenChange(false));
  const notesRequired = reason === "other";
  const openFollowUps = followUps || (reason === "timing_not_suitable" ? "keep" : "cancel");

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Disqualify ${plural(leadIds.length)}`} description="The lead is kept with its history and can be reopened later.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select
          label="Reason"
          isRequired
          selectedKey={reason}
          onSelectionChange={(key) => setReason(String(key))}
          options={options.disqualificationReasons.map((entry) => ({ value: entry.code, label: entry.label }))}
        />
        <TextArea label="Notes" isRequired={notesRequired} value={notes} onChange={setNotes} description={notesRequired ? "Explain the reason." : undefined} />
        <Select label="Open follow-ups" selectedKey={openFollowUps} onSelectionChange={(key) => setFollowUps(String(key))}
          description={reason === "timing_not_suitable" ? "Keep a future follow-up to come back when the timing is right." : undefined}
          options={[{ value: "cancel", label: "Cancel them" }, { value: "keep", label: "Keep them scheduled" }]} />
        <DialogActions
          danger
          onCancel={() => onOpenChange(false)}
          confirmLabel="Disqualify"
          isLoading={mutation.isPending}
          isDisabled={!reason || (notesRequired && !notes.trim())}
          onConfirm={() => mutation.mutate({ action: "disqualify", reason, notes, openFollowUps })}
        />
      </div>
    </Dialog>
  );
}
