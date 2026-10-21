"use client";

// The contact page. The header keeps the name, number, status and role badges, and the facts (email and phone are links). Log activity is
// the primary action (Reactivate when archived); Schedule follow-up and Call (hidden when the person is marked do-not-call) sit beside it;
// the rest is in the "…" menu, grouped like the company's. Five tabs: Overview, Companies & deals, Activity, Sales, Files.
import { formatPhone } from "@vercentlabs/shared-types";
import { customFieldProperties } from "@/features/crm/shared/ui/CustomFields";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, Badge, Button, ErrorState, LinkButton, RecordDetailsPage, Tab, TabList, TabPanel, Tabs,
} from "@vercentlabs/design-system";

import { ConsentHistory } from "@/features/crm/shared/ui/ConsentHistory";
import { EmailButton } from "@/features/crm/shared/ui/EmailComposer";
import { FollowButton } from "@/features/crm/shared/ui/FollowButton";
import { RecordImage } from "@/features/crm/shared/ui/RecordImage";
import { languageLabel } from "@/features/crm/shared/languages";
import { WhatsAppButton } from "@/features/crm/shared/ui/WhatsAppComposer";
import { CallSmsButtons } from "@/features/crm/shared/ui/CallSmsButtons";
import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { RelatedFollowUpsPanel, ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { RecordNotesPanel } from "@/features/crm/notes/components/RecordNotesPanel";
import { fieldLabel } from "@/features/crm/shared/field-labels";
import { RecordActivityFeed, type ActivityChip } from "@/features/crm/shared/RecordActivityFeed";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { FilterChips } from "@/features/crm/shared/ui/FilterChips";
import { MoreMenu, type MoreMenuItem } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/shared/ui/PropertyList";
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
  ContactActivitiesPanel, ContactTasksPanel, LogContactActivityDialog,
} from "../components/ContactWorkPanels";
import { useCrmShortcut } from "@/features/crm/shared/shortcuts";

type DialogKind = "assign" | "activity" | "followUp" | "merge" | "delete" | ContactStatus | null;
type SalesList = "quotations" | "orders" | "projects" | "tickets";

// Old ?tab= values (links from search, Notes & Files, notifications) open the tab — and the Activity chip — that now holds them.
const TAB_OF: Record<string, { tab: string; chip?: ActivityChip; list?: SalesList }> = {
  overview: { tab: "overview" }, companies: { tab: "companies" }, opportunities: { tab: "companies" }, deals: { tab: "companies" },
  activity: { tab: "activity" }, activities: { tab: "activity", chip: "calls" }, tasks: { tab: "activity", chip: "tasks" },
  followUps: { tab: "activity", chip: "followUps" }, notes: { tab: "activity", chip: "notes" }, history: { tab: "activity", chip: "changes" },
  sales: { tab: "sales" }, quotations: { tab: "sales", list: "quotations" }, orders: { tab: "sales", list: "orders" }, projects: { tab: "sales", list: "projects" },
  tickets: { tab: "sales", list: "tickets" }, files: { tab: "files" }, attachments: { tab: "files" },
};

export function ContactDetailScreen({ contactId }: { contactId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  // ?merge=<id> (from Data quality's "Review and merge") opens the merge with that duplicate chosen.
  const mergeWith = params.get("merge");
  const [dialog, setDialog] = useState<DialogKind>(mergeWith ? "merge" : null);
  const requested = TAB_OF[params.get("tab") ?? ""] ?? TAB_OF.overview;
  const [tab, setTab] = useState(requested.tab);
  const [salesList, setSalesList] = useState<SalesList | null>(requested.list ?? null);
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

  // E edits the contact and L logs an activity on it, unless it is archived.
  const editable = Boolean(contact && options?.capabilities.edit && contact.status !== "archived");
  useCrmShortcut("e", editable ? () => router.push(`/crm/contacts/${contactId}/edit`) : undefined);
  useCrmShortcut("l", editable ? () => setDialog("activity") : undefined);

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

  const close = (open: boolean) => !open && setDialog(null);
  // The menu, grouped like the company's: Edit · Ownership · Duplicates · Status (each says what it means), then Delete.
  const menuActions: Array<MoreMenuItem & { show: boolean }> = [
    { id: "edit", label: "Edit contact", show: canEdit, onAction: () => router.push(`/crm/contacts/${contact.id}/edit`) },
    { id: "assign", group: "Ownership", label: contact.ownerUserId ? "Reassign" : "Assign", show: canAssign, onAction: () => setDialog("assign") },
    { id: "merge", group: "Duplicates", label: "Merge a duplicate into this contact", show: can.merge && !archived, onAction: () => setDialog("merge") },
    { id: "inactive", group: "Status", label: "Deactivate — still searchable", show: can.archive && contact.status === "active", onAction: () => setDialog("inactive") },
    { id: "active", group: "Status", label: "Reactivate", show: can.archive && contact.status === "inactive", onAction: () => setDialog("active") },
    { id: "archived", group: "Status", label: "Archive — hidden and read-only", show: can.archive && !archived, onAction: () => setDialog("archived") },
    { id: "delete", label: "Delete contact", danger: true, show: can.delete, onAction: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  const salesLists: Array<{ id: SalesList; label: string; show: boolean }> = [
    { id: "quotations", label: "Quotations", show: modules.sales },
    { id: "orders", label: "Sales orders", show: modules.sales },
    { id: "projects", label: "Projects", show: modules.projects },
    { id: "tickets", label: "Support tickets", show: modules.support },
  ];
  const shownSales = salesLists.filter((entry) => entry.show);
  const activeSales = shownSales.find((entry) => entry.id === salesList) ?? shownSales[0];

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
            { label: "Mobile", value: contact.mobile ? <a className="hover:underline" href={`tel:${contact.mobile}`}>{formatPhone(contact.mobile)}</a> : hidden },
            { label: "Phone", value: contact.phone ? <a className="hover:underline" href={`tel:${contact.phone}`}>{formatPhone(contact.phone)}</a> : hidden },
            { label: "Owner", value: contact.ownerName ?? "Unassigned" },
          ],
          primaryAction: archived
            ? can.archive && <Button variant="primary" onPress={() => setDialog("active")}>Reactivate</Button>
            : canEdit ? <Button variant="primary" onPress={() => setDialog("activity")}>Log activity</Button> : undefined,
          secondaryActions: (
            <>
              {canEdit && <EmailButton entity="contacts" recordId={contact.id} />}
              <FollowButton entity="contacts" recordId={contact.id} />
              {canEdit && <WhatsAppButton entity="contacts" recordId={contact.id} />}
              {canEdit && <CallSmsButtons entity="contacts" recordId={contact.id} />}
              {canEdit && <Button variant="secondary" onPress={() => setDialog("followUp")}>Schedule follow-up</Button>}
              {phone && !contact.doNotCall && <LinkButton variant="secondary" href={`tel:${phone.replace(/[^0-9+]/g, "")}`}>Call</LinkButton>}
              <MoreMenu label="More contact actions" items={menuActions} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            <RecordImage entity="contacts" recordId={contact.id} name={contact.displayName} canEdit={canEdit} />
            {(contact.doNotEmail || contact.doNotCall || contact.doNotSms || contact.doNotWhatsapp) && (
              <p role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
                {[contact.doNotCall && "Do not call", contact.doNotEmail && "Do not email", contact.doNotSms && "Do not SMS", contact.doNotWhatsapp && "Do not WhatsApp"].filter(Boolean).join(" · ")}
              </p>
            )}
            <ConsentHistory type="contacts" id={contact.id} />
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
            <Tab id="companies">Companies &amp; deals</Tab>
            <Tab id="activity">Activity</Tab>
            {shownSales.length > 0 && <Tab id="sales">Sales</Tab>}
            <Tab id="files">Files</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <ContactSummaryCards contactId={contact.id} />
              <ContactDuplicatesPanel contact={contact} canMerge={can.merge && !archived} hideWhenEmpty onMerged={refresh} />
              {customFieldProperties(options.customFields ?? [], contact.customFields).length > 0 && (
                <PropertyList title="More about this contact" columns={3} items={customFieldProperties(options.customFields ?? [], contact.customFields)} />
              )}
              <PropertyList
                title="Person"
                columns={3}
                items={[
                  { label: "First name", value: contact.firstName },
                  { label: "Middle name", value: contact.middleName },
                  { label: "Last name", value: contact.lastName },
                  { label: "Company", value: contact.accountName },
                  { label: "Job title", value: contact.jobTitle },
                  { label: "Language", value: languageLabel(contact.preferredLanguage) },
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
                  { label: "Email", value: contact.email ?? (contact.sensitiveDataRestricted ? "Hidden" : null) },
                  { label: "Secondary email", value: contact.secondaryEmail ?? null },
                  { label: "Mobile", value: contact.mobile ? formatPhone(contact.mobile) : null },
                  { label: "Phone", value: contact.phone ? formatPhone(contact.phone) : null },
                  { label: "Alternate phone", value: contact.alternatePhone ? formatPhone(contact.alternatePhone) : null },
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
                  { label: "Created", value: `${formatDateTime(contact.createdAt)}${contact.createdByName ? ` by ${contact.createdByName}` : ""}` },
                  { label: "Updated", value: `${formatDateTime(contact.updatedAt)}${contact.updatedByName ? ` by ${contact.updatedByName}` : ""}` },
                  { label: "Description", value: contact.description ? <span className="whitespace-pre-wrap">{contact.description}</span> : null, wide: true },
                ]}
              />
            </div>
          </TabPanel>
          <TabPanel id="companies">
            <div className="flex flex-col gap-6">
              <ContactCompaniesPanel contact={contact} options={options} canEdit={canEdit} />
              <ContactRelatedListPanel contactId={contact.id} list="opportunities"
                action={canEdit && contact.accountId && <LinkButton variant="secondary" size="compact" href={`/crm/opportunities/new?accountId=${contact.accountId}`}>New deal</LinkButton>} />
            </div>
          </TabPanel>
          <TabPanel id="activity">
            <RecordActivityFeed entityType="contact" entityId={contact.id} initial={requested.chip} canAdd={canEdit}
              onLogActivity={() => setDialog("activity")} onScheduleFollowUp={() => setDialog("followUp")}
              sections={{
                calls: <ContactActivitiesPanel contactId={contact.id} options={options} canEdit={canEdit} />,
                tasks: <ContactTasksPanel contactId={contact.id} options={options} canEdit={canEdit} />,
                followUps: <RelatedFollowUpsPanel related={{ type: "contact", id: contact.id, name: contact.displayName, accountId: contact.accountId }} canCreate={canEdit} onChanged={refresh} />,
                notes: <RecordNotesPanel relatedType="contact" relatedId={contact.id} />,
                changes: (
                  <>
                    <RecordTimelinePanel entityType="contact" entityId={contact.id} kinds={["stage", "history"]} />
                    <AuditTrail contactId={contact.id} />
                  </>
                ),
              }} />
          </TabPanel>
          {shownSales.length > 0 && activeSales && (
            <TabPanel id="sales">
              <div className="flex flex-col gap-4">
                {shownSales.length > 1 && (
                  <FilterChips label="Show" chips={shownSales.map((entry) => ({ id: entry.id, label: entry.label }))} selected={activeSales.id} onSelect={(id) => setSalesList(id as SalesList)} />
                )}
                <ContactRelatedListPanel key={activeSales.id} contactId={contact.id} list={activeSales.id} />
              </div>
            </TabPanel>
          )}
          <TabPanel id="files"><RecordAttachmentsPanel relatedType="contact" relatedId={contact.id} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      <AssignContactsDialog isOpen={dialog === "assign"} onOpenChange={close} contactIds={[contact.id]} options={options} onDone={refresh} />
      {(dialog === "active" || dialog === "inactive" || dialog === "archived") && (
        <ContactStatusDialog isOpen onOpenChange={close} contactIds={[contact.id]} status={dialog} onDone={refresh} />
      )}
      <LogContactActivityDialog isOpen={dialog === "activity"} onOpenChange={close} contactId={contact.id} options={options} onDone={refresh}
        onScheduleNext={() => setDialog("followUp")} />
      <ScheduleFollowUpForRecord isOpen={dialog === "followUp"} onOpenChange={close} related={{ type: "contact", id: contact.id, name: contact.displayName, accountId: contact.accountId }} onDone={refresh} />
      <MergeContactsDialog keep={contact} isOpen={dialog === "merge"} onOpenChange={close} initialDuplicateId={mergeWith} onMerged={refresh} />
      <AlertDialog
        isOpen={dialog === "delete"}
        onOpenChange={close}
        title="Delete this contact permanently?"
        description="Only a contact created by mistake, with no deals, quotations, orders, tickets or activities, can be deleted. Otherwise archive it instead."
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
                    return <li key={field}>{fieldLabel(field)}: {String(change.from ?? "empty")} → {String(change.to ?? "empty")}</li>;
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
