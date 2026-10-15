"use client";

// The company page. The header keeps the name, number, type, status and six facts (owner, industry, location, phone, website, next
// follow-up). The primary action follows the company: Create customer for a prospect, New deal for a customer, Reactivate when archived.
// Log activity and Schedule follow-up sit beside it; everything else is in the "…" menu, grouped (Duplicates holds both merges). Six tabs,
// the Customer 360 figures as their badges: Overview, People, Deals, Activity, Sales & money, Details.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, Badge, Button, ErrorState, LinkButton, RecordDetailsPage, Tab, TabList, TabPanel, Tabs,
} from "@vercentlabs/design-system";

import { FollowUpCell } from "@/features/crm/leads/lead-format";
import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { RelatedFollowUpsPanel, ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { RecordNotesPanel } from "@/features/crm/notes/components/RecordNotesPanel";
import { fieldLabel } from "@/features/crm/shared/field-labels";
import { RecordActivityFeed, type ActivityChip } from "@/features/crm/shared/RecordActivityFeed";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { FilterChips } from "@/features/crm/shared/ui/FilterChips";
import { MoreMenu, type MoreMenuItem } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/shared/ui/PropertyList";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { deleteAccount, errorMessage, getAccount, getAccountOptions, getAccountSummary, listAccountHistory, type AccountStatus } from "../api/accounts-api";
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
import { useCrmShortcut } from "@/features/crm/shared/shortcuts";

type DialogKind = "assign" | "activity" | "followUp" | "customer" | "linkCustomer" | "merge" | "delete" | AccountStatus | null;
type MoneyList = "quotations" | "orders" | "returns" | "invoices" | "payments" | "projects" | "tickets";

// Old ?tab= values (links from search, Notes & Files, notifications) open the tab — and the Activity chip — that now holds them.
const TAB_OF: Record<string, { tab: string; chip?: ActivityChip; list?: MoneyList }> = {
  overview: { tab: "overview" }, people: { tab: "people" }, contacts: { tab: "people" }, deals: { tab: "deals" }, opportunities: { tab: "deals" },
  leads: { tab: "deals" }, activity: { tab: "activity" }, activities: { tab: "activity", chip: "calls" }, tasks: { tab: "activity", chip: "tasks" },
  followUps: { tab: "activity", chip: "followUps" }, notes: { tab: "activity", chip: "notes" }, history: { tab: "activity", chip: "changes" },
  money: { tab: "money" }, quotations: { tab: "money", list: "quotations" }, orders: { tab: "money", list: "orders" }, invoices: { tab: "money", list: "invoices" },
  payments: { tab: "money", list: "payments" }, returns: { tab: "money", list: "returns" }, projects: { tab: "money", list: "projects" },
  tickets: { tab: "money", list: "tickets" }, details: { tab: "details" }, addresses: { tab: "details" }, files: { tab: "details" }, attachments: { tab: "details" },
};

export function AccountDetailScreen({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  // ?merge=<id> (from Data quality's "Review and merge") opens the merge with that duplicate chosen.
  const mergeWith = params.get("merge");
  const [dialog, setDialog] = useState<DialogKind>(mergeWith ? "merge" : null);
  const requested = TAB_OF[params.get("tab") ?? ""] ?? TAB_OF.overview;
  const [tab, setTab] = useState(requested.tab);
  const [moneyList, setMoneyList] = useState<MoneyList | null>(requested.list ?? null);
  // Bumped by Create customer's "Add billing address": the Details tab opens with the address form.
  const [addAddress, setAddAddress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const accountKey = scopedQueryKey(workspace, "crm", "account", accountId);
  const accountQuery = useQuery({ queryKey: accountKey, queryFn: () => getAccount(accountId), ...LIVE_ACCOUNT_QUERY });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account-options"), queryFn: getAccountOptions, staleTime: 60_000 });
  // The Customer 360 figures (also the overview cards): the tab badges.
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", accountId, "summary"), queryFn: () => getAccountSummary(accountId), ...LIVE_ACCOUNT_QUERY }).data;
  const account = accountQuery.data;
  const options = optionsQuery.data;

  // Any change to the company refreshes the record, its panels and the list.
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

  // E edits the company and L logs an activity on it, unless it is archived.
  const editable = Boolean(account && options?.capabilities.edit && account.status !== "archived");
  useCrmShortcut("e", editable ? () => router.push(`/crm/accounts/${accountId}/edit`) : undefined);
  useCrmShortcut("l", editable ? () => setDialog("activity") : undefined);

  if (accountQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading company" />;
  if (accountQuery.isError || !account)
    return <ErrorState title="Company not found" description="It may have been merged or deleted, or you may not have access to it." action={{ label: "Back to companies", onPress: () => router.push("/crm/accounts") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  const can = options.capabilities;
  const archived = account.status === "archived";
  const canEdit = can.edit && !archived;
  const canAssign = !archived && (account.ownerUserId ? can.reassign : can.assign);
  const currency = account.currencyCode ?? options.baseCurrency;
  const modules = options.moduleAccess;
  const canBecomeCustomer = can.createCustomer && !account.isCustomer && account.status === "active";
  const money = (value: number) => formatMoney(currency, value);
  const close = (open: boolean) => !open && setDialog(null);

  // Someone who maintains the Customer Master gets its full form, prefilled from this company; others get the short CRM dialog.
  const hasPermission = (key: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(key);
  const usesCustomerForm = modules.sales && hasPermission("sales.customers.create") && hasPermission("sales.customers.link_account");
  const newDealHref = `/crm/opportunities/new?accountId=${account.id}`;
  const primaryAction = archived
    ? can.archive && <Button variant="primary" onPress={() => setDialog("active")}>Reactivate</Button>
    : canBecomeCustomer
      ? usesCustomerForm
        ? <LinkButton variant="primary" href={`/sales/customers/new?accountId=${account.id}`}>Create customer</LinkButton>
        : <Button variant="primary" onPress={() => setDialog("customer")}>Create customer</Button>
      : can.edit ? <LinkButton variant="primary" href={newDealHref}>New deal</LinkButton> : undefined;

  // The menu, grouped: Edit and New deal · Ownership · Duplicates (both merge records) · Status (each says what it means), then Delete.
  const menuActions: Array<MoreMenuItem & { show: boolean }> = [
    { id: "edit", label: "Edit company", show: canEdit, onAction: () => router.push(`/crm/accounts/${account.id}/edit`) },
    { id: "deal", label: "New deal", show: canEdit && canBecomeCustomer, onAction: () => router.push(newDealHref) },
    { id: "assign", group: "Ownership", label: account.ownerUserId ? "Reassign" : "Assign", show: canAssign, onAction: () => setDialog("assign") },
    { id: "merge", group: "Duplicates", label: "Merge a duplicate into this company", show: can.merge && !archived, onAction: () => setDialog("merge") },
    { id: "linkCustomer", group: "Duplicates", label: "Merge into an existing customer", show: canBecomeCustomer && can.merge, onAction: () => setDialog("linkCustomer") },
    { id: "inactive", group: "Status", label: "Deactivate — still searchable", show: can.archive && account.status === "active", onAction: () => setDialog("inactive") },
    { id: "active", group: "Status", label: "Reactivate", show: can.archive && account.status === "inactive", onAction: () => setDialog("active") },
    { id: "archived", group: "Status", label: "Archive — hidden and read-only", show: can.archive && !archived, onAction: () => setDialog("archived") },
    { id: "delete", label: "Delete company", danger: true, show: can.delete && !account.isCustomer, onAction: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  const moneyLists: Array<{ id: MoneyList; label: string; show: boolean }> = [
    { id: "quotations", label: "Quotations", show: modules.sales },
    { id: "orders", label: "Sales orders", show: modules.sales },
    { id: "invoices", label: "Invoices", show: modules.finance },
    { id: "payments", label: "Payments", show: modules.finance },
    { id: "returns", label: "Returns", show: modules.sales },
    { id: "projects", label: "Projects", show: modules.projects },
    { id: "tickets", label: "Support", show: modules.support },
  ];
  const shownMoney = moneyLists.filter((entry) => entry.show);
  const activeMoney = shownMoney.find((entry) => entry.id === moneyList) ?? shownMoney[0];
  // Badges: where to go without opening each tab.
  const dealsBadge = summary?.crm.openOpportunities ? ` ${summary.crm.openOpportunities}` : "";
  const peopleBadge = summary?.crm.contacts ? ` ${summary.crm.contacts}` : "";
  const moneyBadge = summary?.finance?.outstanding ? ` · ${money(summary.finance.outstanding)} due` : summary?.sales?.openQuotations ? ` · ${summary.sales.openQuotations} open quotes` : "";

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
          primaryAction: primaryAction || undefined,
          secondaryActions: (
            <>
              {canEdit && <Button variant="secondary" onPress={() => setDialog("activity")}>Log activity</Button>}
              {canEdit && <Button variant="secondary" onPress={() => setDialog("followUp")}>Schedule follow-up</Button>}
              <MoreMenu label="More company actions" items={menuActions} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {archived && (
              <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">
                This company is archived{account.archivedAt ? ` since ${formatDate(account.archivedAt)}` : ""}. It is read-only until it is reactivated.
              </p>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Company sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="people">People{peopleBadge}</Tab>
            <Tab id="deals">Deals{dealsBadge}</Tab>
            <Tab id="activity">Activity</Tab>
            {shownMoney.length > 0 && <Tab id="money">Sales &amp; money{moneyBadge}</Tab>}
            <Tab id="details">Details</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <AccountSummaryCards accountId={account.id} currency={currency} />
              <AccountDuplicatesPanel account={account} canMerge={can.merge && !archived} hideWhenEmpty onMerged={refresh} />
              <PropertyList
                title="Company"
                columns={3}
                items={[
                  { label: "Company name", value: account.displayName },
                  ...(account.isIndividual ? [] : [{ label: "Legal name", value: account.legalName }]),
                  { label: "Company number", value: account.code },
                  // A person has no industry, headcount or revenue.
                  ...(account.isIndividual ? [{ label: "Kind", value: "Individual customer" }] : [{ label: "Industry", value: account.industry },
                    { label: "Employees", value: account.employeeRange },
                    { label: "Annual revenue", value: account.annualRevenue !== null ? formatMoney(currency, account.annualRevenue) : null }]),
                  { label: "Email", value: account.email ? <a className="hover:underline" href={`mailto:${account.email}`}>{account.email}</a> : account.sensitiveDataRestricted ? "Hidden" : null },
                  { label: "Phone", value: account.phone ? <a className="hover:underline" href={`tel:${account.phone}`}>{account.phone}</a> : account.sensitiveDataRestricted ? "Hidden" : null },
                  { label: "Secondary phone", value: account.secondaryPhone ?? null },
                  { label: "Website", value: account.website ? <a className="hover:underline" href={account.website} target="_blank" rel="noreferrer">{account.website}</a> : null },
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
              <PropertyList
                title="Ownership and record"
                columns={3}
                items={[
                  { label: "Owner", value: account.ownerName ?? "Unassigned" },
                  { label: "Sales team", value: account.teamName },
                  { label: "Assigned at", value: formatDateTime(account.assignedAt) },
                  { label: "Source", value: account.sourceName },
                  { label: "Source detail", value: account.sourceDetail },
                  { label: "Last activity", value: formatDateTime(account.lastActivityAt) },
                  { label: "Created", value: `${formatDateTime(account.createdAt)}${account.createdByName ? ` by ${account.createdByName}` : ""}` },
                  { label: "Updated", value: `${formatDateTime(account.updatedAt)}${account.updatedByName ? ` by ${account.updatedByName}` : ""}` },
                ]}
              />
              <AccountHierarchyPanel account={account} canEdit={canEdit} />
            </div>
          </TabPanel>

          <TabPanel id="people"><AccountContactsPanel account={account} canEdit={canEdit} /></TabPanel>
          <TabPanel id="deals">
            <div className="flex flex-col gap-6">
              <AccountRelatedListPanel accountId={account.id} list="opportunities" currency={currency}
                action={canEdit && <LinkButton variant="secondary" size="compact" href={newDealHref}>New deal</LinkButton>} />
              <AccountRelatedListPanel accountId={account.id} list="leads" currency={currency} />
            </div>
          </TabPanel>
          <TabPanel id="activity">
            <RecordActivityFeed entityType="party" entityId={account.id} initial={requested.chip} canAdd={canEdit}
              onLogActivity={() => setDialog("activity")} onScheduleFollowUp={() => setDialog("followUp")}
              sections={{
                calls: <AccountActivitiesPanel accountId={account.id} options={options} canEdit={canEdit} />,
                tasks: <AccountTasksPanel accountId={account.id} options={options} canEdit={canEdit} />,
                followUps: <RelatedFollowUpsPanel related={{ type: "party", id: account.id, name: account.displayName, accountId: account.id }} canCreate={canEdit} onChanged={refresh} />,
                notes: <RecordNotesPanel relatedType="party" relatedId={account.id} />,
                changes: (
                  <>
                    <RecordTimelinePanel entityType="party" entityId={account.id} kinds={["stage", "history"]} />
                    <AuditTrail accountId={account.id} />
                  </>
                ),
              }} />
          </TabPanel>
          {shownMoney.length > 0 && activeMoney && (
            <TabPanel id="money">
              <div className="flex flex-col gap-4">
                {shownMoney.length > 1 && (
                  <FilterChips label="Show" chips={shownMoney.map((entry) => ({ id: entry.id, label: entry.label }))} selected={activeMoney.id} onSelect={(id) => setMoneyList(id as MoneyList)} />
                )}
                <AccountRelatedListPanel key={activeMoney.id} accountId={account.id} list={activeMoney.id} currency={currency} />
              </div>
            </TabPanel>
          )}
          <TabPanel id="details">
            <div className="flex flex-col gap-6">
              <AccountAddressesPanel key={addAddress} account={account} options={options} canEdit={canEdit} startAdding={addAddress > 0} />
              <RecordAttachmentsPanel relatedType="party" relatedId={account.id} />
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      <AssignAccountsDialog isOpen={dialog === "assign"} onOpenChange={close} partyIds={[account.id]} options={options} onDone={refresh} />
      {(dialog === "active" || dialog === "inactive" || dialog === "archived") && (
        <AccountStatusDialog isOpen onOpenChange={close} partyIds={[account.id]} status={dialog} onDone={refresh} />
      )}
      <LogAccountActivityDialog isOpen={dialog === "activity"} onOpenChange={close} accountId={account.id} options={options} onDone={refresh}
        onScheduleNext={() => setDialog("followUp")} />
      <ScheduleFollowUpForRecord isOpen={dialog === "followUp"} onOpenChange={close} related={{ type: "party", id: account.id, name: account.displayName, accountId: account.id }} onDone={refresh} />
      <CreateCustomerDialog account={account} options={options} isOpen={dialog === "customer"} onOpenChange={close} onDone={refresh}
        onAddBillingAddress={canEdit ? () => { setTab("details"); setAddAddress((count) => count + 1); } : undefined} />
      <LinkCustomerDialog account={account} isOpen={dialog === "linkCustomer"} onOpenChange={close}
        onLinked={(customerId) => { refresh(); router.replace(`/crm/accounts/${customerId}`); }} />
      <MergeAccountsDialog keep={account} isOpen={dialog === "merge"} onOpenChange={close} initialDuplicateId={mergeWith} onMerged={refresh} />
      <AlertDialog
        isOpen={dialog === "delete"}
        onOpenChange={close}
        title="Delete this company permanently?"
        description="Only a company created by mistake, with no contacts, deals, activities or documents, can be deleted. Otherwise archive it instead."
        tone="danger"
        confirmLabel="Delete company"
        isConfirming={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

// Every important change to the company, newest first. Entries are never
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
        return <li key={field}>{fieldLabel(field)}: {String(change.from ?? "empty")} → {String(change.to ?? "empty")}</li>;
      })}
    </ul>
  );
}
