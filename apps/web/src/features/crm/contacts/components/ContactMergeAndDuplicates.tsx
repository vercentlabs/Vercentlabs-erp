"use client";

// Duplicate people: the matches for a contact, and the side-by-side merge
// that folds a duplicate into the contact being viewed.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Radio, RadioGroup } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { checkContactDuplicates, errorMessage, mergeContacts, previewContactMerge, type Contact } from "../api/contacts-api";
import { ErrorBanner } from "../contact-format";
import { ContactDuplicateWarning } from "./ContactDuplicateWarning";
import { ContactPicker } from "./ContactPicker";

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name", middleName: "Middle name", lastName: "Last name", displayName: "Display name", email: "Work email",
  secondaryEmail: "Secondary email", phone: "Work phone", mobile: "Mobile", alternatePhone: "Alternate phone",
  preferredContactMethod: "Preferred contact method", description: "Description", sourceId: "Source", ownerUserId: "Owner", teamId: "Team",
};

function display(contact: Contact, field: string): string {
  if (field === "sourceId") return contact.sourceName ?? "";
  if (field === "ownerUserId") return contact.ownerName ?? "";
  if (field === "teamId") return contact.teamName ?? "";
  const value = (contact as unknown as Record<string, unknown>)[field];
  return value === null || value === undefined ? "" : String(value);
}

export function MergeContactsDialog({ keep, isOpen, onOpenChange, initialDuplicateId = null, onMerged }: {
  keep: Contact; isOpen: boolean; onOpenChange: (open: boolean) => void; initialDuplicateId?: string | null; onMerged: () => void;
}) {
  const workspace = useWorkspaceContext();
  const [duplicateId, setDuplicateId] = useState<string | null>(initialDuplicateId);
  const [choices, setChoices] = useState<Record<string, "keep" | "duplicate">>({});
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contact-merge", keep.id, duplicateId),
    queryFn: () => previewContactMerge(keep.id, duplicateId as string),
    enabled: isOpen && Boolean(duplicateId),
  });
  const mutation = useMutation({
    mutationFn: () => mergeContacts({ keepId: keep.id, duplicateId: duplicateId as string, choices }),
    onSuccess: () => { setError(null); setDuplicateId(null); setChoices({}); onOpenChange(false); onMerged(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const data = preview.data;
  const differing = data ? data.fields.filter((field) => display(data.keep, field) !== display(data.duplicate, field) && display(data.duplicate, field)) : [];
  const moves = data ? Object.entries(data.moves).filter(([, count]) => count > 0) : [];

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Merge a duplicate into ${keep.displayName}`}
      description="Company links, opportunities, activities, notes, files, quotations, orders and tickets of the duplicate move to this contact. The duplicate is archived, not deleted." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <ContactPicker label="Duplicate contact" value={duplicateId} excludeId={keep.id} onChange={(id) => { setDuplicateId(id); setChoices({}); setError(null); }} />
        {duplicateId && preview.isLoading && <LoadingState label="Comparing contacts" rows={3} />}
        {preview.isError && <ErrorBanner message={errorMessage(preview.error)} />}
        {data && (
          <>
            {data.blockers.length > 0 && (
              <div role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                {data.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
              </div>
            )}
            {differing.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Choose which value to keep</p>
                {differing.map((field) => (
                  <RadioGroup key={field} label={FIELD_LABELS[field] ?? field} value={choices[field] ?? (display(data.keep, field) ? "keep" : "duplicate")}
                    onChange={(value) => setChoices((current) => ({ ...current, [field]: value as "keep" | "duplicate" }))}>
                    <Radio value="keep">{display(data.keep, field) || <span className="text-text-muted">Empty</span>} <span className="text-xs text-text-muted">(this contact)</span></Radio>
                    <Radio value="duplicate">{display(data.duplicate, field)} <span className="text-xs text-text-muted">(duplicate)</span></Radio>
                  </RadioGroup>
                ))}
              </div>
            ) : <p className="text-sm text-text-secondary">The duplicate has no different values to choose from.</p>}
            <p className="text-sm text-text-secondary">
              {moves.length ? `Moves to this contact: ${moves.map(([label, count]) => `${count} ${label}`).join(", ")}.` : "The duplicate has no related records to move."}
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!data || data.blockers.length > 0}>Merge contacts</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ContactDuplicatesPanel({ contact, canMerge, hideWhenEmpty = false, onMerged }: {
  contact: Contact; canMerge: boolean; hideWhenEmpty?: boolean; onMerged?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [mergingId, setMergingId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contact", contact.id, "duplicates"),
    queryFn: () => checkContactDuplicates({
      firstName: contact.firstName, lastName: contact.lastName, email: contact.email, secondaryEmail: contact.secondaryEmail, phone: contact.phone,
      mobile: contact.mobile, alternatePhone: contact.alternatePhone, accountId: contact.accountId, excludeId: contact.id,
    }),
    enabled: contact.status !== "archived",
  });
  const matches = query.data?.matches ?? [];
  if (matches.length === 0) {
    if (hideWhenEmpty || query.isLoading) return null;
    return <p className="text-sm text-text-secondary">No similar contacts were found for {contact.displayName}.</p>;
  }
  const mergeable = matches.filter((match) => match.canOpen && match.status !== "archived");
  return (
    <section className="flex flex-col gap-3">
      <ContactDuplicateWarning matches={matches} blocking={query.data?.hasBlockingMatch ?? false}>
        {canMerge && mergeable.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {mergeable.map((match) => (
              <Button key={match.id} variant="outline" size="compact" onPress={() => setMergingId(match.id)}>Merge {match.name ?? match.code} into this contact</Button>
            ))}
          </div>
        )}
      </ContactDuplicateWarning>
      {mergingId && (
        <MergeContactsDialog keep={contact} isOpen initialDuplicateId={mergingId} onOpenChange={(open) => !open && setMergingId(null)}
          onMerged={() => {
            void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contact", contact.id) });
            void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
            onMerged?.();
          }} />
      )}
    </section>
  );
}
