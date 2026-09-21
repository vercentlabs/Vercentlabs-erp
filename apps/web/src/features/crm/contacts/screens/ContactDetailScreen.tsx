"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, RotateCcw } from "lucide-react";
import { Button, ConflictBanner, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { CustomFieldsRuntimePanel } from "@/features/crm/shared/CustomFieldsRuntimePanel";
import { formatDate, formatMoney, humanize, timezoneLabel } from "@/features/crm/shared/human";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { getAccount } from "@/features/crm/accounts/api/accounts-api";
import { listOpportunities } from "@/features/crm/opportunities/api/opportunities-api";
import { archiveContact, ContactApiError, getContact, reactivateContact } from "../api/contacts-api";
import { ContactDuplicatesPanel } from "../components/ContactDuplicatesPanel";
import { ContactCommunicationsPanel } from "../components/ContactCommunicationsPanel";
import { ContactRelationshipsPanel } from "../components/ContactRelationshipsPanel";

const LANGUAGES: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi", ta: "Tamil", te: "Telugu", bn: "Bengali", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi", ur: "Urdu", fr: "French", de: "German", es: "Spanish", ar: "Arabic" };

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

  const accountQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", contact?.accountId ?? "none"),
    queryFn: () => getAccount(contact!.accountId!),
    enabled: Boolean(contact?.accountId),
  });
  const accountName = accountQuery.data?.record.displayName ?? null;

  const dealsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contacts", contactId, "opportunities"),
    queryFn: () => listOpportunities({ contactId, limit: 50 } as never),
    enabled: Boolean(contact),
  });
  const deals = dealsQuery.data?.rows ?? [];

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

  if (contactQuery.isLoading) return <LoadingState label="Loading contact" rows={3} />;
  if (contactQuery.isError) {
    if (contactQuery.error instanceof ContactApiError && contactQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Contact" />;
    }
    return <ErrorState title="Contact not found" action={{ label: "Back to Contacts", onPress: () => router.push("/crm/contacts") }} />;
  }
  if (!contact) return null;

  const active = contact.status === "active";
  return (
    <RecordDetailsPage
      header={{
        title: `${contact.firstName} ${contact.lastName || ""}`.trim(),
        status: <StatusBadge tone={active ? "success" : "neutral"}>{contact.status}</StatusBadge>,
        fields: [
          { label: "Role", value: contact.designation || "Not set" },
          { label: "Account", value: contact.accountId ? (accountName ?? "…") : "No account" },
          ...(contact.isPrimary ? [{ label: "Primary contact", value: "Yes" }] : []),
          { label: "Open deals", value: dealsQuery.isSuccess ? deals.filter((d) => d.status === "open").length : "…" },
        ],
        primaryAction:
          canManage && active ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/contacts/${contactId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions: canManage ? (
          active ? (
            <MoreMenu
              isBusy={archiveMutation.isPending}
              items={[{ id: "archive", label: "Archive contact", danger: true, onAction: () => archiveMutation.mutate(), confirm: { title: "Archive this contact?", description: "The contact stops appearing in active lists. Their history and linked records are kept, and you can reactivate them later.", confirmLabel: "Archive" } }]}
            />
          ) : (
            <Button variant="secondary" onPress={() => reactivateMutation.mutate()} isLoading={reactivateMutation.isPending}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Reactivate
            </Button>
          )
        ) : undefined,
      }}
      tabs={
        <Tabs>
          <TabList aria-label="Contact sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="deals">Deals</Tab>
            <Tab id="notes">Notes</Tab>
            <Tab id="files">Files</Tab>
            <Tab id="more">More</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-4 py-4">
              {conflictMessage && <ConflictBanner message={conflictMessage} onReload={() => router.refresh()} />}
              {actionError && (
                <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                  {actionError}
                </p>
              )}
              <ContactDuplicatesPanel contact={contact} canManage={canManage} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <PropertyList title="Reach them" items={[
                  { label: "Email", value: contact.email ? <a className="text-brand hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a> : null },
                  { label: "Mobile", value: contact.mobile ? <a className="text-brand hover:underline" href={`tel:${contact.mobile}`}>{contact.mobile}</a> : null },
                  { label: "Phone", value: contact.phone ? <a className="text-brand hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a> : null },
                ]} />
                <PropertyList title="Preferences" items={[
                  { label: "Preferred language", value: contact.preferredLanguage ? (LANGUAGES[contact.preferredLanguage] ?? humanize(contact.preferredLanguage)) : null },
                  { label: "Time zone", value: contact.timezone ? timezoneLabel(contact.timezone) : null },
                  { label: "Account", value: contact.accountId ? <Link className="text-brand hover:underline" href={`/crm/accounts/${contact.accountId}`}>{accountName ?? "View account"}</Link> : null },
                ]} />
              </div>
              <p className="text-xs text-text-muted">{`Added ${formatDate(contact.createdAt)} · Last updated ${formatDate(contact.updatedAt)}`}</p>
            </div>
          </TabPanel>

          <TabPanel id="activity">
            <div className="py-4">
              <ContactCommunicationsPanel contactId={contactId} />
            </div>
          </TabPanel>

          <TabPanel id="deals">
            <div className="flex flex-col gap-4 py-4">
              {dealsQuery.isLoading && <p className="text-sm text-text-secondary">Loading deals…</p>}
              {dealsQuery.isSuccess && deals.length === 0 && <p className="text-sm text-text-secondary">This contact is not linked to any opportunity yet.</p>}
              {deals.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
                  {deals.map((deal) => (
                    <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link className="font-medium text-brand hover:underline" href={`/crm/opportunities/${deal.id}`}>{deal.name}</Link>
                      <span className="text-text-secondary">{[deal.stageName, deal.amount !== null ? formatMoney(deal.currencyCode, deal.amount) : null].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-text">Accounts this person is linked to</h3>
                <ContactRelationshipsPanel contactId={contactId} canManage={canManage} />
              </div>
            </div>
          </TabPanel>

          <TabPanel id="notes">
            <div className="py-4">
              <NotesPanel entityType="contact" entityId={contactId} />
            </div>
          </TabPanel>

          <TabPanel id="files">
            <div className="py-4">
              <CrmAttachmentPanel entityType="contact" entityId={contactId} />
            </div>
          </TabPanel>

          <TabPanel id="more">
            <div className="py-4">
              <CustomFieldsRuntimePanel entityType="contact" entityId={contactId} />
            </div>
          </TabPanel>
        </Tabs>
      }
    >
      <div />
    </RecordDetailsPage>
  );
}
