"use client";

import { humanize } from "@/features/crm/shared/human";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Archive, Plus, Star } from "lucide-react";
import { Button, IconButton, Select, StatusBadge, TextArea, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import {
  addOpportunityContactRole,
  listOpportunityContactRoles,
  OPPORTUNITY_CONTACT_ROLES,
  OpportunityContactRoleApiError,
  removeOpportunityContactRole,
  setPrimaryOpportunityContactRole,
  type OpportunityContactRole,
  type OpportunityContactRoleRow,
} from "../api/opportunity-contact-roles-api";

const ROLE_OPTIONS: SelectOption[] = [
  { value: "", label: "No role" },
  ...OPPORTUNITY_CONTACT_ROLES.map((role) => ({ value: role, label: role.replace(/_/g, " ") })),
];

// F003 gap-closure (benchmark: "Contact management in top ERPs") —
// tenant.crm_opportunity_contact_roles (migration 165) already governs a
// full multi-Contact buying-committee model for a deal, mirroring
// Salesforce's OpportunityContactRole / SAP's Buying Center — this is its
// only frontend consumer. The single legacy `contactId`/"Contact" field on
// the Overview tab keeps working unchanged: it's synced to whichever role
// here is primary.
export function OpportunityContactRolesPanel({ opportunityId, partyId, canManage }: { opportunityId: string; partyId: string | null; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId, "contact-roles"),
    queryFn: () => listOpportunityContactRoles(opportunityId),
  });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId, "contact-roles") });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId) });
  }
  function handleError(err: unknown) {
    setError(err instanceof OpportunityContactRoleApiError ? err.message : "This action could not be completed.");
  }

  const primaryMutation = useMutation({
    mutationFn: (role: OpportunityContactRoleRow) => setPrimaryOpportunityContactRole(opportunityId, role.id),
    onSuccess: invalidate,
    onError: handleError,
  });
  const removeMutation = useMutation({
    mutationFn: (role: OpportunityContactRoleRow) => removeOpportunityContactRole(opportunityId, role.id),
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
      {query.isLoading && <p className="text-sm text-text-secondary">Loading contact roles…</p>}
      {!query.isLoading && rows.length === 0 && <p className="text-sm text-text-muted">No Contacts added to this deal yet.</p>}
      {rows.map((role) => (
        <div key={role.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
          <button type="button" className="flex flex-col text-left hover:underline" onClick={() => router.push(`/crm/contacts/${role.contactId}`)}>
            <span className="font-medium text-text">
              {role.firstName} {role.lastName || ""}
            </span>
            <span className="text-text-secondary">
              {role.designation || "—"}
              {role.role ? ` · ${humanize(role.role)}` : ""}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {role.isPrimary ? (
              <StatusBadge tone="success">Primary</StatusBadge>
            ) : (
              canManage && (
                <IconButton aria-label={`Make ${role.firstName} the primary contact`} size="compact" variant="outline" onPress={() => primaryMutation.mutate(role)} isDisabled={primaryMutation.isPending}>
                  <Star className="size-4" aria-hidden="true" />
                </IconButton>
              )
            )}
            {canManage && (
              <IconButton aria-label={`Remove ${role.firstName} from this deal`} size="compact" variant="danger" onPress={() => removeMutation.mutate(role)} isDisabled={removeMutation.isPending}>
                <Archive className="size-4" aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
      ))}
      {canManage &&
        (addOpen ? (
          <AddContactRoleForm opportunityId={opportunityId} partyId={partyId} onDone={() => setAddOpen(false)} onSaved={invalidate} onError={handleError} />
        ) : (
          <Button variant="secondary" size="compact" className="self-start" onPress={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add contact
          </Button>
        ))}
    </div>
  );
}

function AddContactRoleForm({
  opportunityId,
  partyId,
  onDone,
  onSaved,
  onError,
}: {
  opportunityId: string;
  partyId: string | null;
  onDone: () => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const workspace = useWorkspaceContext();
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState<OpportunityContactRole | "">("");
  const [notes, setNotes] = useState("");

  const contactsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contacts", "opportunity-role-candidates", partyId),
    queryFn: () => listContacts({ accountId: partyId ?? undefined, status: "active", limit: 200 }),
  });
  const contactOptions: SelectOption[] = (contactsQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: `${row.firstName} ${row.lastName || ""}`.trim() }));

  const mutation = useMutation({
    mutationFn: () => addOpportunityContactRole(opportunityId, { contactId, role: role || null, notes: notes || null }),
    onSuccess: () => {
      onSaved();
      onDone();
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border-strong p-3">
      <Select label="Contact" options={contactOptions} selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key ?? ""))} />
      {partyId && <p className="text-xs text-text-muted">Showing Contacts linked to this deal&apos;s Account.</p>}
      <Select label="Role" options={ROLE_OPTIONS} selectedKey={role} onSelectionChange={(key) => setRole((key as OpportunityContactRole) ?? "")} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      <div className="flex gap-2">
        <Button variant="secondary" size="compact" onPress={onDone}>Cancel</Button>
        <Button variant="primary" size="compact" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!contactId}>
          Add to deal
        </Button>
      </div>
    </div>
  );
}
