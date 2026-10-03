"use client";

// Assign, change stage and disqualify — used for one lead (from its page) and
// for many (bulk selection on the list). They all go through the bulk
// operation, which reports each lead's outcome.
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

const UNASSIGNED = "__unassigned__";
const NO_CHANGE = "__no_change__";
const NO_TEAM = "__no_team__";

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
    mutationFn: (input: { action: "assign" | "stage" | "disqualify" } & Record<string, unknown>) => bulkLeadAction({ ...input, leadIds }),
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

export function AssignLeadsDialog({ isOpen, onOpenChange, leadIds, options, onDone }: ActionDialogProps) {
  const [owner, setOwner] = useState(NO_CHANGE);
  const [team, setTeam] = useState(NO_CHANGE);
  const { error, mutation } = useBulkAction(leadIds, onDone, () => onOpenChange(false));
  const nothingChosen = owner === NO_CHANGE && team === NO_CHANGE;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Assign ${plural(leadIds.length)}`} description="Choose a new owner, a sales team, or both.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select
          label="Lead owner"
          selectedKey={owner}
          onSelectionChange={(key) => setOwner(String(key))}
          options={[
            { value: NO_CHANGE, label: "Keep current owner" },
            { value: UNASSIGNED, label: "Unassigned (back to the queue)" },
            ...options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
          ]}
        />
        <Select
          label="Assigned team"
          selectedKey={team}
          onSelectionChange={(key) => setTeam(String(key))}
          options={[
            { value: NO_CHANGE, label: "Keep current team" },
            { value: NO_TEAM, label: "No team" },
            ...options.teams.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
        />
        <DialogActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Assign"
          isLoading={mutation.isPending}
          isDisabled={nothingChosen}
          onConfirm={() => mutation.mutate({
            action: "assign",
            ...(owner !== NO_CHANGE ? { ownerUserId: owner === UNASSIGNED ? null : owner } : {}),
            ...(team !== NO_CHANGE ? { teamId: team === NO_TEAM ? null : team } : {}),
          })}
        />
      </div>
    </Dialog>
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
  const { error, mutation } = useBulkAction(leadIds, onDone, () => onOpenChange(false));
  const notesRequired = reason === "other";

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
        <DialogActions
          danger
          onCancel={() => onOpenChange(false)}
          confirmLabel="Disqualify"
          isLoading={mutation.isPending}
          isDisabled={!reason || (notesRequired && !notes.trim())}
          onConfirm={() => mutation.mutate({ action: "disqualify", reason, notes })}
        />
      </div>
    </Dialog>
  );
}
