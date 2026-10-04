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
import { countryName, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  archiveLead, assignLeadToMe, changeLeadStage, errorMessage, getLead, getLeadOptions, listLeadHistory, listLeadStageHistory, reopenLead, restoreLead,
  runLeadAssignmentRules, unassignLead, type Lead, type LeadOptions,
} from "../api/leads-api";
import { ConvertLeadDialog } from "../components/ConvertLeadDialog";
import { LeadDuplicatesPanel } from "../components/LeadDuplicatesPanel";
import { DisqualifyLeadsDialog } from "../components/LeadActionDialogs";
import { AssignLeadsDialog, LeadAssignmentPanel } from "../components/LeadAssignment";
import { LeadActivitiesPanel, LeadFollowUpsPanel, LeadTasksPanel, LogActivityDialog, ScheduleFollowUpDialog } from "../components/LeadWorkPanels";
import { QualificationPanel, QualificationSummary, QualifyLeadDialog } from "../components/QualificationPanel";
import { ErrorBanner, FollowUpCell, LeadStageBadge, LeadStatusBadge, PriorityBadge, RatingBadge, StaleBadge, days, leadName } from "../lead-format";
import { LIVE_LEAD_QUERY } from "../live-query";

type DialogKind = "assign" | "qualify" | "disqualify" | "convert" | "activity" | "followUp" | "archive" | null;

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const leadKey = scopedQueryKey(workspace, "crm", "lead", leadId);
  const leadQuery = useQuery({ queryKey: leadKey, queryFn: () => getLead(leadId), ...LIVE_LEAD_QUERY });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const lead = leadQuery.data;
  const options = optionsQuery.data;

  // Any change to the lead refreshes the record, its panels and the list.
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: leadKey });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
    onError: (failure) => setError(errorMessage(failure)),
  });

  if (leadQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading lead" />;
  if (leadQuery.isError || !lead)
    return <ErrorState title="Lead not found" description="It may have been removed, or you may not have access to it." action={{ label: "Back to leads", onPress: () => router.push("/crm/leads") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  const can = options.capabilities;
  const archived = Boolean(lead.archivedAt);
  const working = !archived && lead.status !== "converted";
  const canEdit = can.edit && working;
  const canAssign = working && (lead.ownerUserId ? can.reassign : can.assign);
  const canTake = working && !lead.ownerUserId && can.assignSelf && options.assignment.allowSelfAssignment;
  // Rules never run on an edit; this is the explicit way to route a lead again.
  const runRules = () => action.mutate(async () => {
    const outcome = await runLeadAssignmentRules(lead.id);
    setNotice(!outcome.matched ? (outcome.message ?? "No rule matches this lead.")
      : outcome.changed ? `Assigned by ${outcome.ruleName ? `rule "${outcome.ruleName}"` : "the default owner setting"}.`
      : "The rules give this lead to its current owner; nothing changed.");
  });
  const currency = lead.currencyCode ?? options.baseCurrency;

  const primaryAction = archived
    ? can.delete && <Button variant="primary" onPress={() => action.mutate(() => restoreLead(lead.id))} isLoading={action.isPending}>Restore lead</Button>
    : lead.status === "open" && can.qualify
      ? <Button variant="primary" onPress={() => setDialog("qualify")}>Qualify</Button>
      : lead.status === "qualified" && can.convert
        ? <Button variant="primary" onPress={() => setDialog("convert")}>Convert</Button>
        : lead.status === "disqualified" && can.reopen
          ? <Button variant="primary" onPress={() => action.mutate(() => reopenLead(lead.id))} isLoading={action.isPending}>Reopen lead</Button>
          : lead.convertedOpportunityId
            ? <LinkButton variant="primary" href={`/crm/opportunities/${lead.convertedOpportunityId}`}>Open opportunity</LinkButton>
            : undefined;

  const menuActions: Array<{ id: string; label: string; show: boolean; run: () => void }> = [
    { id: "edit", label: "Edit lead", show: canEdit, run: () => router.push(`/crm/leads/${lead.id}/edit`) },
    { id: "assign", label: lead.ownerUserId ? "Reassign" : "Assign", show: canAssign, run: () => setDialog("assign") },
    { id: "runRules", label: "Run assignment rules", show: canAssign, run: runRules },
    { id: "unassign", label: "Return to unassigned queue", show: working && can.reassign && Boolean(lead.ownerUserId), run: () => action.mutate(() => unassignLead(lead.id, { expectedUpdatedAt: lead.updatedAt })) },
    { id: "disqualify", label: "Disqualify", show: working && can.disqualify && lead.status !== "disqualified", run: () => setDialog("disqualify") },
    { id: "reopen", label: "Reopen lead", show: working && can.reopen && lead.status === "qualified", run: () => action.mutate(() => reopenLead(lead.id)) },
    { id: "archive", label: "Archive lead", show: working && can.delete, run: () => setDialog("archive") },
  ].filter((entry) => entry.show);

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{leadName(lead)} <span className="text-base font-normal whitespace-nowrap text-text-muted">{lead.code}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <LeadStatusBadge status={lead.status} />
              <LeadStageBadge name={lead.stageName} />
              <StaleBadge lead={lead} />
              {archived && <Badge tone="warning">Archived</Badge>}
            </span>
          ),
          fields: [
            { label: "Company", value: lead.companyName ?? "Not set" },
            { label: "Owner", value: lead.ownerName ?? "Unassigned" },
            { label: "Priority", value: <PriorityBadge priority={lead.priority} /> },
            { label: "Email", value: lead.email ? <a className="hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : lead.sensitiveDataRestricted ? "Hidden" : "Not set" },
            { label: "Phone", value: lead.mobile || lead.phone || (lead.sensitiveDataRestricted ? "Hidden" : "Not set") },
            { label: "Next follow-up", value: <FollowUpCell value={lead.nextFollowUpAt} /> },
          ],
          primaryAction,
          secondaryActions: (
            <>
              {canTake && <Button variant="secondary" onPress={() => action.mutate(() => assignLeadToMe(lead.id, lead.updatedAt))} isLoading={action.isPending}>Assign to me</Button>}
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
            {notice && (
              <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
                <p>{notice}</p>
                <Button variant="ghost" size="compact" onPress={() => setNotice(null)}>Dismiss</Button>
              </div>
            )}
            <QualificationSummary lead={lead} options={options} />
            <StageBar lead={lead} options={options} canChange={working && can.changeStage && lead.status === "open"} isChanging={action.isPending}
              onChange={(stage) => action.mutate(() => changeLeadStage(lead.id, stage))} />
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Lead sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="qualification">Qualification</Tab>
            <Tab id="activities">Activities</Tab>
            <Tab id="tasks">Tasks</Tab>
            <Tab id="followUps">Follow-ups</Tab>
            <Tab id="notes">Notes</Tab>
            <Tab id="attachments">Attachments</Tab>
            <Tab id="history">Activity history</Tab>
            {lead.status === "converted" && <Tab id="related">Related records</Tab>}
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              {lead.status === "converted" && <ConversionSummary lead={lead} />}
              <LeadDuplicatesPanel lead={lead} canResolve={canEdit && can.disqualify} hideWhenEmpty onMerged={refresh} />
              <PropertyList
                title="Lead details"
                columns={3}
                items={[
                  { label: "First name", value: lead.firstName },
                  { label: "Last name", value: lead.lastName },
                  { label: "Company", value: lead.companyName },
                  { label: "Job title", value: lead.jobTitle },
                  { label: "Industry", value: lead.industry },
                  { label: "Website", value: lead.website ? <a className="hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a> : null },
                  { label: "Email", value: lead.email },
                  { label: "Mobile", value: lead.mobile },
                  { label: "Phone", value: lead.phone },
                  { label: "City", value: lead.city },
                  { label: "State", value: lead.state },
                  { label: "Country", value: lead.countryCode ? countryName(lead.countryCode) : null },
                ]}
              />
              <PropertyList
                title="Source and interest"
                columns={3}
                items={[
                  { label: "Lead source", value: lead.sourceName },
                  { label: "Source detail", value: lead.sourceDetail },
                  { label: "Estimated deal value", value: lead.estimatedValue ? formatMoney(currency, lead.estimatedValue) : null },
                  { label: "Purchase timeframe", value: options.purchaseTimeframes.find((entry) => entry.code === lead.purchaseTimeframe)?.label },
                  { label: "Rating", value: <RatingBadge rating={lead.rating} /> },
                  { label: "Tags", value: lead.tags.length ? <span className="flex flex-wrap gap-1">{lead.tags.map((tag) => <Badge key={tag.id}>{tag.name}</Badge>)}</span> : null },
                  { label: "Product / service interest", value: lead.productInterest, wide: true },
                  { label: "Description", value: lead.description ? <span className="whitespace-pre-wrap">{lead.description}</span> : null, wide: true },
                ]}
              />
              <LeadAssignmentPanel lead={lead} options={options} />
              <PropertyList
                title="Record"
                columns={3}
                items={[
                  { label: "Created", value: `${formatDateTime(lead.createdAt)}${lead.createdByName ? ` by ${lead.createdByName}` : ""}` },
                  { label: "Updated", value: `${formatDateTime(lead.updatedAt)}${lead.updatedByName ? ` by ${lead.updatedByName}` : ""}` },
                ]}
              />
            </div>
          </TabPanel>

          <TabPanel id="qualification">
            {/* Re-created when the lead changes, so the form starts from the saved answers. */}
            <QualificationPanel key={lead.updatedAt} lead={lead} options={options} onChanged={refresh} onQualify={() => setDialog("qualify")}
              onDisqualify={() => setDialog("disqualify")} onScheduleFollowUp={() => setDialog("followUp")} />
          </TabPanel>
          <TabPanel id="activities"><LeadActivitiesPanel leadId={lead.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="tasks"><LeadTasksPanel leadId={lead.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="followUps"><LeadFollowUpsPanel leadId={lead.id} options={options} canEdit={canEdit} /></TabPanel>
          <TabPanel id="notes"><NotesPanel entityType="lead" entityId={lead.id} /></TabPanel>
          <TabPanel id="attachments"><CrmAttachmentPanel entityType="lead" entityId={lead.id} /></TabPanel>
          <TabPanel id="history">
            <div className="flex flex-col gap-6">
              <RecordTimelinePanel entityType="lead" entityId={lead.id} />
              <StageHistory leadId={lead.id} version={lead.stageChangedAt} />
              <AuditTrail leadId={lead.id} />
            </div>
          </TabPanel>
          {lead.status === "converted" && <TabPanel id="related"><ConversionSummary lead={lead} /></TabPanel>}
        </Tabs>
      </RecordDetailsPage>

      <AssignLeadsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} leadIds={[lead.id]} lead={lead} options={options} onDone={refresh} />
      {/* Qualifying normally continues straight into creating the account, contact and opportunity. */}
      <QualifyLeadDialog isOpen={dialog === "qualify"} onOpenChange={(open) => !open && setDialog(null)} lead={lead} options={options}
        onQualified={(convert) => { refresh(); setDialog(convert ? "convert" : null); }} />
      <DisqualifyLeadsDialog isOpen={dialog === "disqualify"} onOpenChange={(open) => !open && setDialog(null)} leadIds={[lead.id]} options={options} onDone={refresh} />
      <LogActivityDialog isOpen={dialog === "activity"} onOpenChange={(open) => !open && setDialog(null)} leadId={lead.id} options={options} onDone={refresh}
        currentStage={working && can.changeStage && lead.status === "open" ? lead.stage : undefined} />
      <ScheduleFollowUpDialog isOpen={dialog === "followUp"} onOpenChange={(open) => !open && setDialog(null)} leadId={lead.id} options={options} onDone={refresh} />
      <ConvertLeadDialog isOpen={dialog === "convert"} onOpenChange={(open) => !open && setDialog(null)} leadId={lead.id} options={options}
        onConverted={() => { refresh(); setTab("related"); }} />
      <AlertDialog
        isOpen={dialog === "archive"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Archive this lead?"
        description="The lead leaves the working lists but keeps its history, notes, files and activities. It can be restored from the Archived view."
        tone="danger"
        confirmLabel="Archive lead"
        isConfirming={action.isPending}
        onConfirm={() => action.mutate(async () => { await archiveLead(lead.id); setDialog(null); })}
      />
    </>
  );
}

// The stages as a clickable track: done, current (with how long the lead has
// been there), still ahead. Stage shows where the lead is in the process; it
// is separate from status (the outcome), shown in the header. A lead can move
// to any stage, forwards or backwards, while it is open.
function StageBar({ lead, options, canChange, isChanging, onChange }: {
  lead: Lead; options: LeadOptions; canChange: boolean; isChanging: boolean; onChange: (stage: string) => void;
}) {
  // A lead may still sit in a stage that has since been deactivated.
  const stages = options.stages.some((stage) => stage.code === lead.stage)
    ? options.stages
    : [{ code: lead.stage, label: lead.stageName }, ...options.stages];
  const currentIndex = stages.findIndex((stage) => stage.code === lead.stage);
  return (
    <ol aria-label="Lead stage" className="flex flex-wrap gap-1">
      {stages.map((stage, index) => {
        const isCurrent = index === currentIndex;
        const mark = isCurrent ? "●" : index < currentIndex ? "✓" : "○";
        const className = `flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-center text-sm font-medium transition-colors ${
          isCurrent ? "border-brand bg-brand text-text-inverse" : index < currentIndex ? "border-brand-border bg-brand-soft text-brand-active" : "border-border bg-surface text-text-secondary"}`;
        return (
          <li key={stage.code} className="flex min-w-32 flex-1" aria-current={isCurrent ? "step" : undefined}>
            {canChange && !isCurrent ? (
              <button type="button" disabled={isChanging} className={`${className} hover:border-brand disabled:opacity-60`} onClick={() => onChange(stage.code)}
                title={`Move to ${stage.label}`}>
                <span aria-hidden="true">{mark} </span>{stage.label}
              </button>
            ) : (
              <span className={className}>
                <span aria-hidden="true">{mark} </span>{stage.label}
                {isCurrent && lead.status === "open" && <span className="font-normal"> · {days(lead.stageAgeDays)}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ConversionSummary({ lead }: { lead: Lead }) {
  const opportunity = [lead.convertedOpportunityName, lead.convertedOpportunityAmount ? formatMoney(lead.currencyCode ?? undefined, lead.convertedOpportunityAmount) : null].filter(Boolean).join(" — ");
  const links = [
    lead.convertedPartyId && { label: "Account", name: lead.convertedAccountName, href: `/crm/accounts/${lead.convertedPartyId}` },
    lead.convertedContactId && { label: "Contact", name: lead.convertedContactName, href: `/crm/contacts/${lead.convertedContactId}` },
    lead.convertedOpportunityId && { label: "Opportunity", name: opportunity, href: `/crm/opportunities/${lead.convertedOpportunityId}` },
  ].filter((entry): entry is { label: string; name: string | null; href: string } => Boolean(entry));
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface-muted p-4">
      <div>
        <h2 className="text-base font-semibold">Converted</h2>
        <p className="text-sm text-text-secondary">This lead is kept as a read-only record. Continue the work on the records it became.</p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <div key={link.href} className="flex flex-col">
            <dt className="text-text-secondary">{link.label}</dt>
            <dd><Link className="font-medium text-brand hover:underline" href={link.href}>{link.name || `Open ${link.label.toLowerCase()}`}</Link></dd>
          </div>
        ))}
        <div className="flex flex-col"><dt className="text-text-secondary">Converted by</dt><dd className="font-medium">{lead.convertedByName ?? "Unknown"}</dd></div>
        <div className="flex flex-col"><dt className="text-text-secondary">Converted at</dt><dd className="font-medium">{formatDateTime(lead.convertedAt)}</dd></div>
      </dl>
    </section>
  );
}

// Each stage the lead has been in, newest first, with how long it stayed.
function StageHistory({ leadId, version }: { leadId: string; version: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead", leadId, "stage-history", version), queryFn: () => listLeadStageHistory(leadId) });
  const entries = query.data ?? [];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Stage history</h2>
      {query.isLoading ? <LoadingState label="Loading stage history" rows={2} /> : query.isError ? <ErrorBanner message="Could not load the stage history." />
        : entries.length === 0 ? <p className="text-sm text-text-secondary">No stage changes recorded for this lead.</p> : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="font-medium">
                  {entry.toStageName}{entry.fromStageName ? <span className="font-normal text-text-secondary"> from {entry.fromStageName}</span> : null}
                  {!entry.leftAt && <span className="font-normal text-text-secondary"> · current stage</span>}
                </span>
                {entry.note && <span className="text-text-secondary">{entry.note}</span>}
                <span className="text-xs text-text-muted">
                  Entered {formatDateTime(entry.enteredAt)}{entry.leftAt ? ` · left ${formatDateTime(entry.leftAt)}` : ""} · {entry.isAutomatic ? "Automatic" : entry.changedByName ?? "System"}
                </span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

// Every important change to the lead, newest first. Entries are never
// edited or removed.
function AuditTrail({ leadId }: { leadId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead", leadId, "history"), queryFn: () => listLeadHistory(leadId) });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Audit trail</h2>
      {query.isLoading ? <LoadingState label="Loading audit trail" rows={3} /> : query.isError ? <ErrorBanner message="Could not load the audit trail." /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {(query.data ?? []).map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
              <span className="font-medium">{entry.summary}</span>
              <FieldChanges changes={entry.changes} show={entry.eventType === "updated"} />
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
