"use client";

// Assign and change status — used for one contact (from its page) and for
// many (bulk selection on the list).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import { bulkContactAction, errorMessage, setContactStatus, type ContactBulkResult, type ContactOptions, type ContactStatus } from "../api/contacts-api";
import { ErrorBanner } from "../contact-format";

type ActionDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  options: ContactOptions;
  onDone: (result: ContactBulkResult) => void;
};

const UNASSIGNED = "__unassigned__";
const NO_CHANGE = "__no_change__";
const NO_TEAM = "__no_team__";

const plural = (count: number) => (count === 1 ? "this contact" : `${count} contacts`);
const singleFailure = (result: ContactBulkResult) =>
  result.results.length === 1 && !result.results[0].ok ? (result.results[0].message ?? "The change could not be saved.") : null;

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

export function AssignContactsDialog({ isOpen, onOpenChange, contactIds, options, onDone }: ActionDialogProps) {
  const [owner, setOwner] = useState(NO_CHANGE);
  const [team, setTeam] = useState(NO_CHANGE);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => bulkContactAction({
      action: "assign",
      contactIds,
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
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Assign ${plural(contactIds.length)}`} description="Choose a new owner, a sales team, or both. The new owner is notified.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Contact owner" selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))}
          options={[
            { value: NO_CHANGE, label: "Keep current owner" },
            { value: UNASSIGNED, label: "Unassigned" },
            ...options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
          ]} />
        <Select label="Sales team" selectedKey={team} onSelectionChange={(key) => setTeam(String(key))}
          options={[{ value: NO_CHANGE, label: "Keep current team" }, { value: NO_TEAM, label: "No team" }, ...options.teams.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <DialogActions onCancel={() => onOpenChange(false)} confirmLabel="Assign" isLoading={mutation.isPending} isDisabled={owner === NO_CHANGE && team === NO_CHANGE} onConfirm={() => mutation.mutate()} />
      </div>
    </Dialog>
  );
}

const STATUS_COPY: Record<ContactStatus, { title: string; description: string; confirm: string }> = {
  inactive: { title: "Deactivate", description: "An inactive contact keeps all their history — activities, quotations, opportunities and tickets — but is marked as no longer in use.", confirm: "Deactivate" },
  active: { title: "Reactivate", description: "The contact becomes active again.", confirm: "Reactivate" },
  archived: { title: "Archive", description: "An archived contact is hidden from the working lists and read-only until reactivated. Nothing is deleted.", confirm: "Archive" },
};

export function ContactStatusDialog({ isOpen, onOpenChange, contactIds, status, onDone }: Omit<ActionDialogProps, "options"> & { status: ContactStatus }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copy = STATUS_COPY[status];
  const mutation = useMutation({
    mutationFn: async (): Promise<ContactBulkResult> => {
      if (contactIds.length === 1) {
        const outcome = await setContactStatus(contactIds[0], status, note.trim() || undefined);
        return { results: [{ contactId: contactIds[0], ok: true }], succeeded: outcome.changed ? 1 : 0, failed: 0 };
      }
      return bulkContactAction({ action: "status", contactIds, status });
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
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`${copy.title} ${plural(contactIds.length)}`} description={copy.description}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        {contactIds.length === 1 && <TextArea label="Reason" description="Optional. Kept in the contact history." value={note} onChange={setNote} />}
        <DialogActions danger={status !== "active"} onCancel={() => onOpenChange(false)} confirmLabel={copy.confirm} isLoading={mutation.isPending} onConfirm={() => mutation.mutate()} />
      </div>
    </Dialog>
  );
}
