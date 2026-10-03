"use client";

// Assign and change status — used for one account (from its page) and for
// many (bulk selection on the list). Both go through the bulk operation,
// which reports each account's outcome.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import { bulkAccountAction, errorMessage, setAccountStatus, type AccountBulkResult, type AccountOptions, type AccountStatus } from "../api/accounts-api";
import { ErrorBanner } from "../account-format";

type ActionDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  partyIds: string[];
  options: AccountOptions;
  onDone: (result: AccountBulkResult) => void;
};

const UNASSIGNED = "__unassigned__";
const NO_CHANGE = "__no_change__";
const NO_TEAM = "__no_team__";

function plural(count: number) {
  return count === 1 ? "this account" : `${count} accounts`;
}

// A single account's refusal is an error to show; in bulk the list summarises it.
function singleFailure(result: AccountBulkResult) {
  return result.results.length === 1 && !result.results[0].ok ? (result.results[0].message ?? "The change could not be saved.") : null;
}

function DialogActions({ onCancel, onConfirm, confirmLabel, isLoading, isDisabled, danger }: {
  onCancel: () => void; onConfirm: () => void; confirmLabel: string; isLoading: boolean; isDisabled?: boolean; danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onPress={onConfirm} isLoading={isLoading} isDisabled={isDisabled}>{confirmLabel}</Button>
    </div>
  );
}

export function AssignAccountsDialog({ isOpen, onOpenChange, partyIds, options, onDone }: ActionDialogProps) {
  const [owner, setOwner] = useState(NO_CHANGE);
  const [team, setTeam] = useState(NO_CHANGE);
  const [error, setError] = useState<string | null>(null);
  const nothingChosen = owner === NO_CHANGE && team === NO_CHANGE;
  const mutation = useMutation({
    mutationFn: () => bulkAccountAction({
      action: "assign",
      partyIds,
      ...(owner !== NO_CHANGE ? { ownerUserId: owner === UNASSIGNED ? null : owner } : {}),
      ...(team !== NO_CHANGE ? { teamId: team === NO_TEAM ? null : team } : {}),
    }),
    onSuccess: (result) => {
      const failure = singleFailure(result);
      if (failure) return setError(failure);
      setError(null);
      onDone(result);
      onOpenChange(false);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Assign ${plural(partyIds.length)}`} description="Choose a new owner, a sales team, or both. The new owner is notified.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Account owner" selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))}
          options={[
            { value: NO_CHANGE, label: "Keep current owner" },
            { value: UNASSIGNED, label: "Unassigned" },
            ...options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
          ]} />
        <Select label="Sales team" selectedKey={team} onSelectionChange={(key) => setTeam(String(key))}
          options={[{ value: NO_CHANGE, label: "Keep current team" }, { value: NO_TEAM, label: "No team" }, ...options.teams.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <DialogActions onCancel={() => onOpenChange(false)} confirmLabel="Assign" isLoading={mutation.isPending} isDisabled={nothingChosen} onConfirm={() => mutation.mutate()} />
      </div>
    </Dialog>
  );
}

const STATUS_COPY: Record<AccountStatus, { title: string; description: string; confirm: string }> = {
  inactive: { title: "Deactivate", description: "An inactive account stays searchable with all its history, but is marked as not in use.", confirm: "Deactivate" },
  active: { title: "Reactivate", description: "The account becomes active again.", confirm: "Reactivate" },
  archived: { title: "Archive", description: "An archived account is hidden from the working lists and can no longer be changed until it is reactivated. Nothing is deleted.", confirm: "Archive" },
};

export function AccountStatusDialog({ isOpen, onOpenChange, partyIds, status, onDone }: Omit<ActionDialogProps, "options"> & { status: AccountStatus }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copy = STATUS_COPY[status];
  const mutation = useMutation({
    mutationFn: async (): Promise<AccountBulkResult> => {
      if (partyIds.length === 1) {
        const outcome = await setAccountStatus(partyIds[0], status, note.trim() || undefined);
        return { results: [{ partyId: partyIds[0], ok: true }], succeeded: outcome.changed ? 1 : 0, failed: 0 };
      }
      return bulkAccountAction({ action: "status", partyIds, status });
    },
    onSuccess: (result) => {
      const failure = singleFailure(result);
      if (failure) return setError(failure);
      setError(null);
      setNote("");
      onDone(result);
      onOpenChange(false);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`${copy.title} ${plural(partyIds.length)}`} description={copy.description}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        {partyIds.length === 1 && <TextArea label="Reason" description="Optional. Kept in the account history." value={note} onChange={setNote} />}
        <DialogActions danger={status !== "active"} onCancel={() => onOpenChange(false)} confirmLabel={copy.confirm} isLoading={mutation.isPending} onConfirm={() => mutation.mutate()} />
      </div>
    </Dialog>
  );
}
