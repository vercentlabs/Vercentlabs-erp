"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, RotateCcw } from "lucide-react";
import { Button, ConflictBanner, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { archiveContact, ContactApiError, getContact, reactivateContact } from "../api/contacts-api";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

export function ContactDetailScreen({ contactId }: { contactId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const contactQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contacts", contactId),
    queryFn: () => getContact(contactId),
  });
  const contact = contactQuery.data?.record;

  function handleError(error: unknown) {
    if (error instanceof ContactApiError && error.code === "CRM_STALE_WRITE") {
      setConflictMessage(error.message);
      return;
    }
    setActionError(error instanceof Error ? error.message : "This action could not be completed.");
  }

  const archiveMutation = useMutation({
    mutationFn: () => archiveContact(contactId, contact!.updatedAt),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    },
    onError: handleError,
  });

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateContact(contactId, contact!.updatedAt),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    },
    onError: handleError,
  });

  if (contactQuery.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading contact…</p>;
  if (contactQuery.isError) {
    if (contactQuery.error instanceof ContactApiError && contactQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Contact" />;
    }
    return <ErrorState title="Contact not found" action={{ label: "Back to Contacts", onPress: () => router.push("/crm/contacts") }} />;
  }
  if (!contact) return null;

  return (
    <RecordDetailsPage
      header={{
        title: `${contact.firstName} ${contact.lastName || ""}`.trim(),
        status: <StatusBadge tone={contact.status === "active" ? "success" : "neutral"}>{contact.status}</StatusBadge>,
        fields: [
          { label: "Designation", value: contact.designation || "—" },
          { label: "Primary", value: contact.isPrimary ? "Yes" : "No" },
        ],
        primaryAction:
          canManage && contact.status === "active" ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/contacts/${contactId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions: canManage ? (
          contact.status === "active" ? (
            <Button variant="danger" onPress={() => archiveMutation.mutate()} isLoading={archiveMutation.isPending}>
              <Archive className="size-4" aria-hidden="true" />
              Archive
            </Button>
          ) : (
            <Button variant="secondary" onPress={() => reactivateMutation.mutate()} isLoading={reactivateMutation.isPending}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Reactivate
            </Button>
          )
        ) : undefined,
      }}
    >
      <div className="flex flex-col gap-6 py-4">
        {conflictMessage && <ConflictBanner message={conflictMessage} onReload={() => router.refresh()} />}
        {actionError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {actionError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email" value={contact.email} />
          <Field label="Phone" value={contact.phone} />
          <Field label="Mobile" value={contact.mobile} />
          <Field label="Preferred language" value={contact.preferredLanguage} />
          <Field label="Timezone" value={contact.timezone} />
        </div>
        {contact.accountId && (
          <button type="button" className="w-fit text-sm text-brand hover:underline" onClick={() => router.push(`/crm/accounts/${contact.accountId}`)}>
            View linked account
          </button>
        )}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Notes</p>
          <NotesPanel entityType="contact" entityId={contactId} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Attachments</p>
          <CrmAttachmentPanel entityType="contact" entityId={contactId} />
        </div>
      </div>
    </RecordDetailsPage>
  );
}
