"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button, ConflictBanner, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, Tab, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { CustomFieldsRuntimePanel } from "@/features/crm/shared/CustomFieldsRuntimePanel";
import { toNumber } from "@/features/crm/shared/format";
import { countryName, currencyName, formatDate, formatMoney, humanize } from "@/features/crm/shared/human";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { listOpportunities } from "@/features/crm/opportunities/api/opportunities-api";
import { AccountApiError, archiveAccount, getAccount } from "../api/accounts-api";
import { AccountCustomer360Panel } from "../components/AccountCustomer360Panel";
import { AccountHierarchyPanel } from "../components/AccountHierarchyPanel";
import { AccountDuplicatesPanel } from "../components/AccountDuplicatesPanel";
import { AccountPlanPanel } from "../components/AccountPlanPanel";
import { AccountContactRelationshipsPanel } from "../components/AccountContactRelationshipsPanel";
import { EmailHistoryPanel } from "@/features/crm/shared/EmailHistoryPanel";
import { AccountPrivacyPanel } from "../components/AccountPrivacyPanel";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

export function AccountDetailScreen({ accountId }: { accountId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const accountQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId),
    queryFn: () => getAccount(accountId),
  });
  const account = accountQuery.data?.record;

  const opportunitiesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId, "opportunities"),
    queryFn: () => listOpportunities({ partyId: accountId, limit: 50 }),
    enabled: Boolean(account),
  });
  const opportunities = opportunitiesQuery.data?.rows ?? [];
  const open = opportunities.filter((o) => o.status === "open");
  const pipelineValue = open.reduce((sum, o) => sum + toNumber(o.amount), 0);
  const currency = open[0]?.currencyCode ?? account?.currencyCode ?? null;

  const archiveMutation = useMutation({
    mutationFn: () => archiveAccount(accountId, account!.updatedAt),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
    },
    onError: (error: unknown) => {
      if (error instanceof AccountApiError && error.code === "CRM_STALE_WRITE") {
        setConflictMessage(error.message);
        return;
      }
      setActionError(error instanceof Error ? error.message : "This action could not be completed.");
    },
  });

  if (accountQuery.isLoading) return <LoadingState label="Loading account" rows={3} />;
  if (accountQuery.isError) {
    if (accountQuery.error instanceof AccountApiError && accountQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Account" />;
    }
    return <ErrorState title="Account not found" description="This Account may have been merged or removed." action={{ label: "Back to Accounts", onPress: () => router.push("/crm/accounts") }} />;
  }
  if (!account) return null;

  const active = account.status === "active";
  const contacts = account.relationships?.contacts ?? 0;

  return (
    <RecordDetailsPage
      header={{
        title: account.displayName,
        status: <StatusBadge tone={active ? "success" : "neutral"}>{account.status}</StatusBadge>,
        fields: [
          { label: "Industry", value: account.industry || "Not set" },
          { label: "Contacts", value: contacts },
          { label: "Open opportunities", value: opportunitiesQuery.isSuccess ? open.length : "…" },
          { label: "Open pipeline", value: opportunitiesQuery.isSuccess ? (open.length ? formatMoney(currency, pipelineValue) : "None") : "…" },
        ],
        primaryAction:
          canManage && active ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/accounts/${accountId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions:
          canManage && active ? (
            <MoreMenu
              isBusy={archiveMutation.isPending}
              items={[{ id: "archive", label: "Archive account", danger: true, onAction: () => archiveMutation.mutate(), confirm: { title: "Archive this account?", description: "It stops appearing in active lists and can no longer be edited. Its contacts, opportunities and history are kept.", confirmLabel: "Archive" } }]}
            />
          ) : undefined,
      }}
      tabs={
        <Tabs>
          <TabList aria-label="Account sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="360">360 view</Tab>
            <Tab id="contacts">Contacts</Tab>
            <Tab id="opportunities">Opportunities</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="plan">Account plan</Tab>
            <Tab id="timeline">Timeline</Tab>
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
              <AccountDuplicatesPanel account={account} canManage={canManage} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <PropertyList title="Company" items={[
                  { label: "Legal name", value: account.legalName },
                  { label: "Industry", value: account.industry },
                  { label: "Website", value: account.website ? <a className="text-brand hover:underline" href={account.website.startsWith("http") ? account.website : `https://${account.website}`} target="_blank" rel="noreferrer">{account.website}</a> : null },
                  { label: "Currency", value: account.currencyCode ? `${currencyName(account.currencyCode)} (${account.currencyCode})` : null },
                ]} />
                <PropertyList title="Contact details" items={[
                  { label: "Email", value: account.email },
                  { label: "Phone", value: account.phone },
                ]} />
                <PropertyList title="Address" items={[
                  { label: "Street", value: [account.addressLine1, account.addressLine2].filter(Boolean).join(", ") },
                  { label: "City", value: account.city },
                  { label: "State", value: account.state },
                  { label: "Postal code", value: account.postalCode },
                  { label: "Country", value: countryName(account.countryCode) },
                ]} />
                <PropertyList title="Tax" items={[
                  { label: "GSTIN", value: account.gstin },
                  { label: "PAN", value: account.pan },
                  { label: "MSME number", value: account.msmeNumber },
                ]} />
              </div>
              <p className="text-xs text-text-muted">{`Created ${formatDate(account.createdAt)} · Last updated ${formatDate(account.updatedAt)}`}</p>
            </div>
          </TabPanel>

          <TabPanel id="360">
            <div className="py-4">
              <AccountCustomer360Panel accountId={accountId} />
            </div>
          </TabPanel>

          <TabPanel id="contacts">
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-text-secondary">{contacts === 0 ? "No contacts are linked to this account yet." : `${contacts} contact${contacts === 1 ? "" : "s"} at this account.`}</p>
                <div className="flex gap-2">
                  <Link href={`/crm/contacts?accountId=${accountId}`} className="text-sm font-medium text-brand hover:underline">View in Contacts</Link>
                  {canManage && active && <Link href="/crm/contacts/new" className="text-sm font-medium text-brand hover:underline">Add contact</Link>}
                </div>
              </div>
              <AccountContactRelationshipsPanel accountId={accountId} />
            </div>
          </TabPanel>

          <TabPanel id="opportunities">
            <div className="flex flex-col gap-3 py-4">
              {opportunitiesQuery.isLoading && <p className="text-sm text-text-secondary">Loading opportunities…</p>}
              {opportunitiesQuery.isError && <ErrorState title="Could not load opportunities" action={{ label: "Retry", onPress: () => opportunitiesQuery.refetch() }} />}
              {opportunitiesQuery.isSuccess && opportunities.length === 0 && <p className="text-sm text-text-secondary">No opportunities for this account yet.</p>}
              {opportunities.length > 0 && (
                <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
                  <Table className="w-full text-sm">
                    <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-muted">
                      <TableRow><TableHeaderCell className="px-3 py-2">Opportunity</TableHeaderCell><TableHeaderCell className="px-3 py-2">Stage</TableHeaderCell><TableHeaderCell className="px-3 py-2 text-right">Amount</TableHeaderCell><TableHeaderCell className="px-3 py-2">Expected close</TableHeaderCell><TableHeaderCell className="px-3 py-2">Status</TableHeaderCell></TableRow>
                    </TableHead>
                    <TableBody>
                      {opportunities.map((o) => (
                        <TableRow key={o.id} className="border-t border-border">
                          <TableCell className="px-3 py-2"><Link className="font-medium text-brand hover:underline" href={`/crm/opportunities/${o.id}`}>{o.name}</Link></TableCell>
                          <TableCell className="px-3 py-2">{o.stageName ?? ""}</TableCell>
                          <TableCell className="px-3 py-2 text-right tabular-nums">{o.amount !== null ? formatMoney(o.currencyCode, o.amount) : ""}</TableCell>
                          <TableCell className="px-3 py-2">{formatDate(o.expectedCloseDate)}</TableCell>
                          <TableCell className="px-3 py-2"><StatusBadge tone={o.status === "won" ? "success" : o.status === "lost" ? "danger" : o.status === "open" ? "info" : "neutral"}>{humanize(o.status)}</StatusBadge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabPanel>

          <TabPanel id="activity">
            <div className="py-4">
              <EmailHistoryPanel entityType="party" entityId={accountId} />
            </div>
          </TabPanel>

          <TabPanel id="plan">
            <div className="py-4">
              <AccountPlanPanel accountId={accountId} canManage={canManage} />
            </div>
          </TabPanel>

          <TabPanel id="timeline">
            <div className="py-4">
              <RecordTimelinePanel entityType="party" entityId={accountId} />
            </div>
          </TabPanel>

          <TabPanel id="notes">
            <div className="py-4">
              <NotesPanel entityType="party" entityId={accountId} />
            </div>
          </TabPanel>

          <TabPanel id="files">
            <div className="py-4">
              <CrmAttachmentPanel entityType="party" entityId={accountId} />
            </div>
          </TabPanel>

          <TabPanel id="more">
            <div className="flex flex-col gap-6 py-4">
              <Section title="Hierarchy">
                <AccountHierarchyPanel accountId={accountId} canManage={canManage} />
              </Section>
              <Section title="Custom fields">
                <CustomFieldsRuntimePanel entityType="party" entityId={accountId} />
              </Section>
              <AccountPrivacyPanel accountId={accountId} accountName={account.displayName} />
            </div>
          </TabPanel>
        </Tabs>
      }
    >
      <div />
    </RecordDetailsPage>
  );
}
