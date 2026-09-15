"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Archive, Plus, Star } from "lucide-react";
import { Button, IconButton, Select, StatusBadge, TextArea, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listAccounts } from "@/features/crm/accounts/api/accounts-api";
import {
  addContactRelationship,
  ContactRelationshipApiError,
  listContactRelationships,
  removeContactRelationship,
  setPrimaryContactRelationship,
  STAKEHOLDER_ROLES,
  type ContactAccountRelationship,
  type RelationshipType,
  type StakeholderRole,
} from "../api/contact-relationships-api";

const TYPE_OPTIONS: SelectOption[] = [
  { value: "employment", label: "Employment" },
  { value: "affiliated", label: "Affiliated" },
  { value: "other", label: "Other" },
];
const ROLE_OPTIONS: SelectOption[] = [{ value: "", label: "No stakeholder role" }, ...STAKEHOLDER_ROLES.map((role) => ({ value: role, label: role.replace(/_/g, " ") }))];

// F003 Stage A2 — the already-built, already-tested multi-account Contact
// relationship model (tenant.crm_contact_account_relationships, migration
// 088) had zero frontend consumer. A Contact can concurrently relate to
// several Accounts, each with its own relationship type + stakeholder
// role; exactly one relationship is is_primary, mirrored onto the legacy
// contacts.accountId/isPrimary fields server-side so existing callers
// (e.g. the "View linked account" link above) never desync.
export function ContactRelationshipsPanel({ contactId, canManage }: { contactId: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contacts", contactId, "relationships"), queryFn: () => listContactRelationships(contactId) });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts", contactId, "relationships") });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts", contactId) });
  }
  function handleError(err: unknown) {
    setError(err instanceof ContactRelationshipApiError ? err.message : "This action could not be completed.");
  }

  const primaryMutation = useMutation({
    mutationFn: (relationship: ContactAccountRelationship) => setPrimaryContactRelationship(contactId, relationship.id),
    onSuccess: invalidate,
    onError: handleError,
  });
  const removeMutation = useMutation({
    mutationFn: (relationship: ContactAccountRelationship) => removeContactRelationship(contactId, relationship.id),
    onSuccess: invalidate,
    onError: handleError,
  });

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {query.isLoading && <p className="text-sm text-text-secondary">Loading account relationships…</p>}
      {!query.isLoading && rows.length === 0 && <p className="text-sm text-text-muted">No Account relationships yet.</p>}
      {rows.map((relationship) => (
        <div key={relationship.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
          <button type="button" className="flex flex-col text-left hover:underline" onClick={() => router.push(`/crm/accounts/${relationship.partyId}`)}>
            <span className="font-medium text-text">{relationship.accountName}</span>
            <span className="text-text-secondary">
              {relationship.relationshipType}
              {relationship.stakeholderRole ? ` · ${relationship.stakeholderRole.replace(/_/g, " ")}` : ""}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {relationship.isPrimary ? (
              <StatusBadge tone="success">Primary</StatusBadge>
            ) : (
              canManage && (
                <IconButton aria-label={`Make ${relationship.accountName} primary`} size="compact" variant="outline" onPress={() => primaryMutation.mutate(relationship)} isDisabled={primaryMutation.isPending}>
                  <Star className="size-4" aria-hidden="true" />
                </IconButton>
              )
            )}
            {canManage && (
              <IconButton aria-label={`Remove relationship with ${relationship.accountName}`} size="compact" variant="danger" onPress={() => removeMutation.mutate(relationship)} isDisabled={removeMutation.isPending}>
                <Archive className="size-4" aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
      ))}
      {canManage &&
        (addOpen ? (
          <AddRelationshipForm contactId={contactId} onDone={() => setAddOpen(false)} onSaved={invalidate} onError={handleError} />
        ) : (
          <Button variant="secondary" size="compact" className="self-start" onPress={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add Account relationship
          </Button>
        ))}
    </div>
  );
}

function AddRelationshipForm({ contactId, onDone, onSaved, onError }: { contactId: string; onDone: () => void; onSaved: () => void; onError: (error: unknown) => void }) {
  const workspace = useWorkspaceContext();
  const [accountId, setAccountId] = useState("");
  const [relationshipType, setRelationshipType] = useState<RelationshipType>("employment");
  const [stakeholderRole, setStakeholderRole] = useState<StakeholderRole | "">("");
  const [notes, setNotes] = useState("");

  const accountsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "accounts", "relationship-candidates"), queryFn: () => listAccounts({ status: "active", limit: 200 }) });
  const accountOptions: SelectOption[] = (accountsQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.displayName }));

  const mutation = useMutation({
    mutationFn: () => addContactRelationship(contactId, { accountId, relationshipType, stakeholderRole: stakeholderRole || null, notes: notes || null }),
    onSuccess: () => {
      onSaved();
      onDone();
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border-strong p-3">
      <Select label="Account" options={accountOptions} selectedKey={accountId} onSelectionChange={(key) => setAccountId(String(key ?? ""))} />
      <Select label="Relationship type" options={TYPE_OPTIONS} selectedKey={relationshipType} onSelectionChange={(key) => setRelationshipType((key as RelationshipType) ?? "employment")} />
      <Select label="Stakeholder role" options={ROLE_OPTIONS} selectedKey={stakeholderRole} onSelectionChange={(key) => setStakeholderRole((key as StakeholderRole) ?? "")} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      <div className="flex gap-2">
        <Button variant="secondary" size="compact" onPress={onDone}>Cancel</Button>
        <Button variant="primary" size="compact" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!accountId}>
          Add relationship
        </Button>
      </div>
    </div>
  );
}
