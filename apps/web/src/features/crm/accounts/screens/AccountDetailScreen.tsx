"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog, Badge, Button, ErrorState, LinkButton, Menu, MenuItem, MenuTrigger, RecordDetailsPage, Tab, TabList, TabPanel, Tabs,
} from "@vercentlabs/design-system";

import { FollowUpCell } from "@/features/crm/leads/lead-format";
import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { RelatedFollowUpsPanel, ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { RecordNotesPanel } from "@/features/crm/notes/components/RecordNotesPanel";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { deleteAccount, errorMessage, getAccount, getAccountOptions, listAccountHistory, type AccountStatus } from "../api/accounts-api";
import { AccountStatusBadge, AccountTypeBadge, ErrorBanner, humanizeEvent, locationOf } from "../account-format";
import { AccountStatusDialog, AssignAccountsDialog } from "../components/AccountActionDialogs";
import { AccountRelatedListPanel, AccountSummaryCards } from "../components/AccountCustomer360";
import { CreateCustomerDialog, LinkCustomerDialog } from "../components/AccountCustomerDialogs";
import { AccountDuplicatesPanel } from "../components/AccountDuplicatesPanel";
import { AccountAddressesPanel, AccountContactsPanel, AccountHierarchyPanel } from "../components/AccountRelationshipPanels";
import {
  AccountActivitiesPanel, AccountTasksPanel, LogAccountActivityDialog,
} from "../components/AccountWorkPanels";
import { MergeAccountsDialog } from "../components/MergeAccountsDialog";
import { LIVE_ACCOUNT_QUERY } from "../live-query";

type DialogKind = "assign" | "activity" | "followUp" | "customer" | "linkCustomer" | "merge" | "delete" | AccountStatus | null;

export function AccountDetailScreen({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);

  const accountKey = scopedQueryKey(workspace, "crm", "account", accountId);
  const accountQuery = useQuery({ queryKey: accountKey, queryFn: () => getAccount(accountId), ...LIVE_ACCOUNT_QUERY });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account-options"), queryFn: getAccountOptions, staleTime: 60_000 });
  const account = accountQuery.data;
  const options = optionsQuery.data;

  // Any change to the account refreshes the record, its panels and the list.
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: accountKey });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  const remove = useMutation({
    mutationFn: () => deleteAccount(accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
      router.replace("/crm/accounts");
    },
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });

  if (accountQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading account" />;
  if (accountQuery.isError || !account)
    return <ErrorState title="Account not found" description="It may have been merged or deleted, or you may not have access to it." action={{ label: "Back to accounts", onPress: () => router.push("/crm/accounts") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  const can = options.capabilities;
  const archived = account.status === "archived";
  const canEdit = can.edit && !archived;
  const canAssign = !archived && (account.ownerUserId ? can.reassign : can.assign);
  const currency = account.currencyCode ?? options.baseCurrency;
  const modules = options.moduleAccess;
  const canBecomeCustomer = can.createCustomer && !account.isCustomer && account.status === "active";

  const primaryAction = archived
    ? can.archive && <Button variant="primary" onPress={() => setDialog("active")}>Reactivate</Button>
    : canBecomeCustomer
      ? <Button variant="primary" onPress={() => setDialog("customer")}>Create customer</Button>
      : can.edit ? <LinkButton variant="primary" href={`/crm/opportunities/new?accountId=${account.id}`}>New opportunity</LinkButton> : undefined;

  const menuActions: Array<{ id: string; label: string; show: boolean; run: () => void }> = [
    { id: "edit", label: "Edit account", show: canEdit, run: () => router.push(`/crm/accounts/${account.id}/edit`) },
    { id: "opportunity", label: "New opportunity", show: canEdit && canBecomeCustomer, run: () => router.push(`/crm/opportunities/new?accountId=${account.id}`) },
    { id: "assign", label: account.ownerUserId ? "Reassign" : "Assign", show: canAssign, run: () => setDialog("assign") },
    { id: "merge", label: "Merge a duplicate into this account", show: can.merge && !archived, run: () => setDialog("merge") },
    { id: "linkCustomer", label: "Link existing customer", show: canBecomeCustomer && can.merge, run: () => setDialog("linkCustomer") },
    { id: "inactive", label: "Deactivate", show: can.archive && account.status === "active", run: () => setDialog("inactive") },
    { id: "active", label: "Reactivate", show: can.archive && account.status === "inactive", run: () => setDialog("active") },
    { id: "archived", label: "Archive", show: can.archive && !archived, run: () => setDialog("archived") },
    { id: "delete", label: "Delete account", show: can.delete && !account.isCustomer, run: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  const relatedTabs: Array<{ id: "quotations" | "orders" | "returns" | "invoices" | "payments" | "projects" | "tickets"; label: string; show: boolean }> = [
    { id: "quotations", label: "Quotations", show: modules.sales },
    { id: "orders", label: "Sales orders", show: modules.sales },
    { id: "invoices", label: "Invoices", show: modules.finance },
    { id: "payments", label: "Payments", show: modules.finance },
    { id: "returns", label: "Returns", show: modules.sales },
    { id: "projects", label: "Projects", show: modules.projects },
    { id: "tickets", label: "Support", show: modules.support },
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{account.displayName} <span className="text-base font-normal whitespace-nowrap text-text-muted">{account.code}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <AccountTypeBadge type={account.accountType} />
              <AccountStatusBadge status={account.status} />
              {account.customerNumber && <Badge tone="success">Customer {account.customerNumber}</Badge>}
            </span>
          ),
          fields: [
            { label: "Owner", value: account.ownerName ?? "Unassigned" },
            { label: "Industry", value: account.industry ?? "Not set" },
            { label: "Location", value: locationOf(account) || "Not set" },
            { label: "Phone", value: account.phone ? <a className="hover:underline" href={`tel:${account.phone}`}>{account.phone}</a> : account.sensitiveDataRestricted ? "Hidden" : "Not set" },
            { label: "Website", value: account.website ? <a className="hover:underline" href={account.website} target="_blank" rel="noreferrer">{account.website.replace(/^https?:\/\//, "")}</a> : "Not set" },
            { label: "Next follow-up", value: <FollowUpCell value={account.nextFollowUpAt} /> },
          ],
          primaryAction,
          secondaryActions: (
            <>
              {canEdit && <Button variant="secondary" onPress={() => setDialog("activity")}>Log activity</Button>}
              {canEdit && <Button variant="secondary" onPress={() => setDialog("followUp")}>Schedule follow-up</Button>}
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
            {archived && (
              <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">
                This account is archived{account.archivedAt ? ` since ${formatDate(account.archivedAt)}` : ""}. It is read-only until it is reactivated.
              </p>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Account sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="contacts">Contacts</Tab>
            <Tab id="opportunities">Opportunities</Tab>
            <Tab id="activities">Activities</Tab>
            <Tab id="tasks">Tasks</Tab>
            <Tab id="followUps">Follow-ups</Tab>
            <Tab id="addresses">Addresses</Tab>
            <Tab id="leads">Leads</Tab>
            {relatedTabs.filter((entry) => entry.show).map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}
            <Tab id="notes">Notes</Tab>
            <Tab id="attachments">Attachments</Tab>
            <Tab id="history">Activity history</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <AccountSummaryCards accountId={account.id} currency={currency} />
              <AccountDuplicatesPanel account={account} canMerge={can.merge && !archived} hideWhenEmpty onMerged={refresh} />
              <PropertyList
                title="Company"
                columns={3}
                items={[
                  { label: "Account name", value: account.displayName },
                  { label: "Legal name", value: account.legalName },
                  { label: "Account number", value: account.code },
                  { label: "Industry", value: account.industry },
                  { label: "Employees", value: account.employeeRange },
                  { label: "Annual revenue", value: account.annualRevenue !== null ? formatMoney(currency, account.annualRevenue) : null },
                  { label: "Email", value: account.email ? <a className="hover:underline" href={`mailto:${account.email}`}>{account.email}</a> : account.sensitiveDataRestricted ? "Hidden" : null },
                  { label: "Phone", value: account.phone ?? (account.sensitiveDataRestricted ? "Hidden" : null) },
                  { label: "Secondary phone", value: account.secondaryPhone ?? null },
                  { label: "Website", value: account.website ? <a className="hover:underline" href={account.website} target="_blank" rel="noreferrer">{account.website}</a> : null },
                  { label: "Tags", value: account.tags.length ? <span className="flex flex-wrap gap-1">{account.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}</span> : null },
                  { label: "Description", value: account.description ? <span className="whitespace-pre-wrap">{account.description}</span> : null, wide: true },
                ]}
              />
              {account.isCustomer && (
                <PropertyList
                  title="Customer Master"
                  columns={3}
                  items={[
                    { label: "Customer number", value: account.customerNumber ?? "Created in Sales" },
                    { label: "Customer since", value: formatDate(account.customerSince) },
                    { label: "Commercial terms", value: modules.sales ? <a className="hover:underline" href={`/sales/customers/${account.id}`}>Open in Sales</a> : "Maintained by Sales" },
                  ]}
                />
              )}
              <AccountHierarchyPanel account={account} canEdit={canEdit} />
              <PropertyList
                title="Ownership and record"
                columns={3}
                items={[
                  { label: "Account owner", value: account.ownerName ?? "Unassigned" },
                  { label: "Sales team", value: account.teamName },
                  { label: "Assigned at", value: formatDateTime(account.assignedAt) },
                  { label: "Source", value: account.sourceName },
                  { label: "Source detail", value: account.sourceDetail },
                  { label: "Last activity", value: formatDateTime(account.lastActivityAt) },
                  { label: "Created", value: `${formatDateTime(account.createdAt)}${account.createdByName ? ` by ${account.createdByName}` : ""}` },
                  { label: "Updated", value: `${formatDateTime(account.updatedAt)}${account.updatedByName ? ` by ${account.updatedByName}` : ""}` },
                ]}
              />
            </div>
          </TabPanel>

          <TabPanel id="contacts"><AccountContactsPanel account={account} canEdit={canEdit} /></TabPanel>
          <TabPanel id="opportunities">
            <AccountRelatedListPanel accountId={account.id} list="opportunities" currency={currency}
              action={canEdit && <LinkButton variant="primary" size="compact" href={`/crm/opportunities/new?accountId=${account.id}`}>New opportunity</LinkButton>} />
          </TabPanel>
          <TabPanel id="activities"><AccountActivitiesPanel accountId={account.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="tasks"><AccountTasksPanel accountId={account.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="followUps"><RelatedFollowUpsPanel related={{ type: "party", id: account.id, name: account.displayName, accountId: account.id }} canCreate={canEdit} onChanged={refresh} /></TabPanel>
          <TabPanel id="addresses"><AccountAddressesPanel account={account} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="leads"><AccountRelatedListPanel accountId={account.id} list="leads" currency={currency} /></TabPanel>
          {relatedTabs.filter((entry) => entry.show).map((entry) => (
            <TabPanel key={entry.id} id={entry.id}><AccountRelatedListPanel accountId={account.id} list={entry.id} currency={currency} /></TabPanel>
          ))}
          <TabPanel id="notes"><RecordNotesPanel relatedType="party" relatedId={account.id} /></TabPanel>
          <TabPanel id="attachments"><RecordAttachmentsPanel relatedType="party" relatedId={account.id} /></TabPanel>
          <TabPanel id="history">
            <div className="flex flex-col gap-6">
              <RecordTimelinePanel entityType="party" entityId={account.id} />
              <AuditTrail accountId={account.id} />
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      <AssignAccountsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} partyIds={[account.id]} options={options} onDone={refresh} />
      {(dialog === "active" || dialog === "inactive" || dialog === "archived") && (
        <AccountStatusDialog isOpen onOpenChange={(open) => !open && setDialog(null)} partyIds={[account.id]} status={dialog} onDone={refresh} />
      )}
      <LogAccountActivityDialog isOpen={dialog === "activity"} onOpenChange={(open) => !open && setDialog(null)} accountId={account.id} options={options} onDone={refresh} />
      <ScheduleFollowUpForRecord isOpen={dialog === "followUp"} onOpenChange={(open) => !open && setDialog(null)} related={{ type: "party", id: account.id, name: account.displayName, accountId: account.id }} onDone={refresh} />
      <CreateCustomerDialog account={account} options={options} isOpen={dialog === "customer"} onOpenChange={(open) => !open && setDialog(null)} onDone={refresh} />
      <LinkCustomerDialog account={account} isOpen={dialog === "linkCustomer"} onOpenChange={(open) => !open && setDialog(null)}
        onLinked={(customerId) => { refresh(); router.replace(`/crm/accounts/${customerId}`); }} />
      <MergeAccountsDialog keep={account} isOpen={dialog === "merge"} onOpenChange={(open) => !open && setDialog(null)} onMerged={refresh} />
      <AlertDialog
        isOpen={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Delete this account permanently?"
        description="Only an account created by mistake, with no contacts, opportunities, activities or documents, can be deleted. Otherwise archive it instead."
        tone="danger"
        confirmLabel="Delete account"
        isConfirming={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

// Every important change to the account, newest first. Entries are never
// edited or removed.
function AuditTrail({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", accountId, "history"), queryFn: () => listAccountHistory(accountId), ...LIVE_ACCOUNT_QUERY });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Audit trail</h2>
      {query.isLoading ? <LoadingState label="Loading audit trail" rows={3} /> : query.isError ? <ErrorBanner message="Could not load the audit trail." /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {(query.data ?? []).map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{humanizeEvent(entry.eventType)}</Badge><span className="font-medium">{entry.summary}</span></span>
              <FieldChanges changes={entry.changes} show={entry.eventType === "updated" || entry.eventType === "address_updated"} />
              <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)} · {entry.actorName ?? "System"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FieldChanges({ changes, show }: { changes: Record<string, unknown>; show: boolean }) {
  if (!show) return null;
  const entries = Object.entries(changes).filter(([, value]) => value && typeof value === "object" && "to" in (value as object));
  if (!entries.length) return null;
  return (
    <ul className="text-text-secondary">
      {entries.map(([field, value]) => {
        const change = value as { from: unknown; to: unknown };
        return <li key={field}>{field}: {String(change.from ?? "empty")} → {String(change.to ?? "empty")}</li>;
      })}
    </ul>
  );
}
