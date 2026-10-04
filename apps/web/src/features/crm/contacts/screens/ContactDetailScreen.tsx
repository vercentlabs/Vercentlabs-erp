"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog, Badge, Button, ErrorState, LinkButton, Menu, MenuItem, MenuTrigger, RecordDetailsPage, Tab, TabList, TabPanel, Tabs,
} from "@vercentlabs/design-system";

import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { countryName, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { humanizeEvent } from "@/features/crm/accounts/account-format";
import { deleteContact, errorMessage, getContact, getContactOptions, listContactHistory, type ContactStatus } from "../api/contacts-api";
import { ContactStatusBadge, ErrorBanner, LIVE_CONTACT_QUERY, RoleBadge, bestPhone } from "../contact-format";
import { AssignContactsDialog, ContactStatusDialog } from "../components/ContactActionDialogs";
import { ContactCompaniesPanel } from "../components/ContactCompaniesPanel";
import { ContactDuplicatesPanel, MergeContactsDialog } from "../components/ContactMergeAndDuplicates";
import { ContactRelatedListPanel, ContactSummaryCards } from "../components/ContactOverviewPanels";
import {
  ContactActivitiesPanel, ContactFollowUpsPanel, ContactTasksPanel, LogContactActivityDialog, ScheduleContactFollowUpDialog,
} from "../components/ContactWorkPanels";

type DialogKind = "assign" | "activity" | "followUp" | "merge" | "delete" | ContactStatus | null;

export function ContactDetailScreen({ contactId }: { contactId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);

  const contactKey = scopedQueryKey(workspace, "crm", "contact", contactId);
  const contactQuery = useQuery({ queryKey: contactKey, queryFn: () => getContact(contactId), ...LIVE_CONTACT_QUERY });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact-options"), queryFn: getContactOptions, staleTime: 60_000 });
  const contact = contactQuery.data;
  const options = optionsQuery.data;

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: contactKey });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  const remove = useMutation({
    mutationFn: () => deleteContact(contactId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
      router.replace("/crm/contacts");
    },
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });

  if (contactQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading contact" />;
  if (contactQuery.isError || !contact)
    return <ErrorState title="Contact not found" description="It may have been merged or deleted, or you may not have access to it." action={{ label: "Back to contacts", onPress: () => router.push("/crm/contacts") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  const can = options.capabilities;
  const archived = contact.status === "archived";
  const canEdit = can.edit && !archived;
  const canAssign = !archived && (contact.ownerUserId ? can.reassign : can.assign);
  const modules = options.moduleAccess;
  const phone = bestPhone(contact);
  const hidden = contact.sensitiveDataRestricted ? "Hidden" : "Not set";

  const menuActions: Array<{ id: string; label: string; show: boolean; run: () => void }> = [
    { id: "edit", label: "Edit contact", show: canEdit, run: () => router.push(`/crm/contacts/${contact.id}/edit`) },
    { id: "assign", label: contact.ownerUserId ? "Reassign" : "Assign", show: canAssign, run: () => setDialog("assign") },
    { id: "merge", label: "Merge a duplicate into this contact", show: can.merge && !archived, run: () => setDialog("merge") },
    { id: "inactive", label: "Deactivate", show: can.archive && contact.status === "active", run: () => setDialog("inactive") },
    { id: "active", label: "Reactivate", show: can.archive && contact.status === "inactive", run: () => setDialog("active") },
    { id: "archived", label: "Archive", show: can.archive && !archived, run: () => setDialog("archived") },
    { id: "delete", label: "Delete contact", show: can.delete, run: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  const relatedTabs: Array<{ id: "quotations" | "orders" | "projects" | "tickets"; label: string; show: boolean }> = [
    { id: "quotations", label: "Quotations", show: modules.sales },
    { id: "orders", label: "Sales", show: modules.sales },
    { id: "projects", label: "Projects", show: modules.projects },
    { id: "tickets", label: "Support tickets", show: modules.support },
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{contact.displayName} <span className="text-base font-normal whitespace-nowrap text-text-muted">{contact.contactNumber}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <ContactStatusBadge status={contact.status} />
              <RoleBadge label={contact.roleLabel} />
              {contact.isPrimary && <Badge tone="brand">Primary contact</Badge>}
              {contact.isDecisionMaker && <Badge tone="success">Decision maker</Badge>}
            </span>
          ),
          fields: [
            { label: "Company", value: contact.accountId ? <Link className="hover:underline" href={`/crm/accounts/${contact.accountId}`}>{contact.accountName}</Link> : "No company" },
            { label: "Job title", value: contact.jobTitle ?? "Not set" },
            { label: "Email", value: contact.email ? <a className="hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a> : hidden },
            { label: "Mobile", value: contact.mobile ? <a className="hover:underline" href={`tel:${contact.mobile}`}>{contact.mobile}</a> : hidden },
            { label: "Phone", value: contact.phone ? <a className="hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a> : hidden },
            { label: "Owner", value: contact.ownerName ?? "Unassigned" },
          ],
          primaryAction: archived
            ? can.archive && <Button variant="primary" onPress={() => setDialog("active")}>Reactivate</Button>
            : canEdit ? <Button variant="primary" onPress={() => setDialog("activity")}>Log activity</Button> : undefined,
          secondaryActions: (
            <>
              {canEdit && <Button variant="secondary" onPress={() => setDialog("followUp")}>Schedule follow-up</Button>}
              {phone && !contact.doNotCall && <LinkButton variant="outline" href={`tel:${phone}`}>Call</LinkButton>}
              {menuActions.length > 0 && (
                <MenuTrigger>
                  <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
                  <Menu onAction={(key) => menuActions.find((entry) => entry.id === key)?.run()}>
                    {menuActions.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}
                  </Menu>
                </MenuTrigger>
              )}
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {(contact.doNotEmail || contact.doNotCall || contact.doNotSms) && (
              <p role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
                {[contact.doNotCall && "Do not call", contact.doNotEmail && "Do not email", contact.doNotSms && "Do not SMS"].filter(Boolean).join(" · ")}
              </p>
            )}
            {archived && (
              <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">
                This contact is archived. It is read-only until it is reactivated.
              </p>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Contact sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="companies">Company / Accounts</Tab>
            <Tab id="opportunities">Opportunities</Tab>
            <Tab id="activities">Activities</Tab>
            <Tab id="tasks">Tasks</Tab>
            <Tab id="followUps">Follow-ups</Tab>
            <Tab id="notes">Notes</Tab>
            <Tab id="attachments">Attachments</Tab>
            {relatedTabs.filter((entry) => entry.show).map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}
            <Tab id="history">Activity history</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <ContactSummaryCards contactId={contact.id} />
              <ContactDuplicatesPanel contact={contact} canMerge={can.merge && !archived} hideWhenEmpty onMerged={refresh} />
              <PropertyList
                title="Person"
                columns={3}
                items={[
                  { label: "First name", value: contact.firstName },
                  { label: "Middle name", value: contact.middleName },
                  { label: "Last name", value: contact.lastName },
                  { label: "Company", value: contact.accountName },
                  { label: "Job title", value: contact.jobTitle },
                  { label: "Department", value: contact.department },
                  { label: "Role", value: contact.roleLabel },
                  { label: "Decision maker", value: contact.isDecisionMaker ? "Yes" : "No" },
                  { label: "Primary contact", value: contact.isPrimary ? "Yes" : "No" },
                ]}
              />
              <PropertyList
                title="Contact details"
                columns={3}
                items={[
                  { label: "Work email", value: contact.email ?? (contact.sensitiveDataRestricted ? "Hidden" : null) },
                  { label: "Secondary email", value: contact.secondaryEmail ?? null },
                  { label: "Mobile", value: contact.mobile ?? null },
                  { label: "Work phone", value: contact.phone ?? null },
                  { label: "Alternate phone", value: contact.alternatePhone ?? null },
                  { label: "Preferred method", value: options.preferredContactMethods.find((entry) => entry.code === contact.preferredContactMethod)?.label },
                  { label: "Marketing", value: options.marketingConsent.find((entry) => entry.code === contact.marketingConsent)?.label },
                  {
                    label: "Address",
                    value: contact.useAccountAddress ? "Uses the company address"
                      : [contact.addressLine1, contact.addressLine2, contact.city, contact.state, contact.postalCode, contact.countryCode ? countryName(contact.countryCode) : null].filter(Boolean).join(", ") || null,
                    wide: true,
                  },
                ]}
              />
              <PropertyList
                title="Ownership and record"
                columns={3}
                items={[
                  { label: "Contact owner", value: contact.ownerName ?? "Unassigned" },
                  { label: "Sales team", value: contact.teamName },
                  { label: "Source", value: contact.sourceName },
                  { label: "Tags", value: contact.tags.length ? <span className="flex flex-wrap gap-1">{contact.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}</span> : null },
                  { label: "Created", value: `${formatDateTime(contact.createdAt)}${contact.createdByName ? ` by ${contact.createdByName}` : ""}` },
                  { label: "Updated", value: `${formatDateTime(contact.updatedAt)}${contact.updatedByName ? ` by ${contact.updatedByName}` : ""}` },
                  { label: "Description", value: contact.description ? <span className="whitespace-pre-wrap">{contact.description}</span> : null, wide: true },
                ]}
              />
            </div>
          </TabPanel>
          <TabPanel id="companies"><ContactCompaniesPanel contact={contact} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="opportunities">
            <ContactRelatedListPanel contactId={contact.id} list="opportunities"
              action={canEdit && contact.accountId && <LinkButton variant="primary" size="compact" href={`/crm/opportunities/new?accountId=${contact.accountId}`}>New opportunity</LinkButton>} />
          </TabPanel>
          <TabPanel id="activities"><ContactActivitiesPanel contactId={contact.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="tasks"><ContactTasksPanel contactId={contact.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="followUps"><ContactFollowUpsPanel contactId={contact.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="notes"><NotesPanel entityType="contact" entityId={contact.id} /></TabPanel>
          <TabPanel id="attachments"><CrmAttachmentPanel entityType="contact" entityId={contact.id} /></TabPanel>
          {relatedTabs.filter((entry) => entry.show).map((entry) => (
            <TabPanel key={entry.id} id={entry.id}><ContactRelatedListPanel contactId={contact.id} list={entry.id} /></TabPanel>
          ))}
          <TabPanel id="history">
            <div className="flex flex-col gap-6">
              <RecordTimelinePanel entityType="contact" entityId={contact.id} />
              <AuditTrail contactId={contact.id} />
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      <AssignContactsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} contactIds={[contact.id]} options={options} onDone={refresh} />
      {(dialog === "active" || dialog === "inactive" || dialog === "archived") && (
        <ContactStatusDialog isOpen onOpenChange={(open) => !open && setDialog(null)} contactIds={[contact.id]} status={dialog} onDone={refresh} />
      )}
      <LogContactActivityDialog isOpen={dialog === "activity"} onOpenChange={(open) => !open && setDialog(null)} contactId={contact.id} options={options} onDone={refresh} />
      <ScheduleContactFollowUpDialog isOpen={dialog === "followUp"} onOpenChange={(open) => !open && setDialog(null)} contactId={contact.id} options={options} onDone={refresh} />
      <MergeContactsDialog keep={contact} isOpen={dialog === "merge"} onOpenChange={(open) => !open && setDialog(null)} onMerged={refresh} />
      <AlertDialog
        isOpen={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Delete this contact permanently?"
        description="Only a contact created by mistake, with no opportunities, quotations, orders, tickets or activities, can be deleted. Otherwise archive it instead."
        tone="danger"
        confirmLabel="Delete contact"
        isConfirming={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function AuditTrail({ contactId }: { contactId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "history"), queryFn: () => listContactHistory(contactId), ...LIVE_CONTACT_QUERY });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Audit trail</h2>
      {query.isLoading ? <LoadingState label="Loading audit trail" rows={3} /> : query.isError ? <ErrorBanner message="Could not load the audit trail." /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {(query.data ?? []).map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{humanizeEvent(entry.eventType)}</Badge><span className="font-medium">{entry.summary}</span></span>
              {entry.eventType === "updated" && (
                <ul className="text-text-secondary">
                  {Object.entries(entry.changes).filter(([, value]) => value && typeof value === "object" && "to" in (value as object)).map(([field, value]) => {
                    const change = value as { from: unknown; to: unknown };
                    return <li key={field}>{field}: {String(change.from ?? "empty")} → {String(change.to ?? "empty")}</li>;
                  })}
                </ul>
              )}
              <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)} · {entry.actorName ?? "System"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
