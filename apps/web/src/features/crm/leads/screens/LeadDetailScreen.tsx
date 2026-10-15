"use client";

// A lead: its header with the one primary action its status calls for, the qualification summary and the clickable stage track, then five tabs
// — Overview, Qualify, Activity (one feed: logged activities, tasks, follow-ups, notes, files and changes, with filter chips), Files and Related.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, Badge, Button, Checkbox, ErrorState, LinkButton, RecordDetailsPage, Tab, TabList, TabPanel, Tabs,
} from "@vercentlabs/design-system";

import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { RelatedDocuments } from "@/shared/related/RelatedDocuments";
import { ConversionSummary } from "@/features/crm/conversion/components/ConversionSummary";
import { RelatedFollowUpsPanel, ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { RecordNotesPanel } from "@/features/crm/notes/components/RecordNotesPanel";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { RecordActivityFeed, type ActivityChip } from "@/features/crm/shared/RecordActivityFeed";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { fieldLabel, readableHistory } from "@/features/crm/shared/field-labels";
import { MoreMenu, type MoreMenuItem } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/shared/ui/PropertyList";
import { countryName, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  archiveLead, assignLeadToMe, changeLeadStage, errorMessage, getLead, getLeadOptions, listLeadHistory, listLeadStageHistory, reopenLead, restoreLead,
  runLeadAssignmentRules, unassignLead, type Lead, type LeadOptions,
} from "../api/leads-api";
import { LeadDuplicatesPanel } from "../components/LeadDuplicatesPanel";
import { DisqualifyLeadsDialog } from "../components/LeadActionDialogs";
import { AssignLeadsDialog, LeadAssignmentPanel } from "../components/LeadAssignment";
import { LeadActivitiesPanel, LeadTasksPanel, LogActivityDialog } from "../components/LeadWorkPanels";
import { QualificationPanel, QualificationSummary, QualifyLeadDialog } from "../components/QualificationPanel";
import { ErrorBanner, FollowUpCell, LeadStageBadge, LeadStatusBadge, PriorityBadge, RatingBadge, StaleBadge, days, leadName } from "../lead-format";
import { LIVE_LEAD_QUERY } from "../live-query";
import { useCrmShortcut } from "@/features/crm/shared/shortcuts";

type DialogKind = "assign" | "qualify" | "disqualify" | "activity" | "followUp" | "archive" | null;
// The five tabs; the addresses of the earlier tabs (notes, attachments, history and the rest) open the tab that now holds them.
const TAB_OF: Record<string, { tab: string; chip?: ActivityChip }> = {
  overview: { tab: "overview" }, qualify: { tab: "qualify" }, qualification: { tab: "qualify" }, activity: { tab: "activity" }, files: { tab: "files" }, related: { tab: "related" },
  activities: { tab: "activity", chip: "calls" }, tasks: { tab: "activity", chip: "tasks" }, followUps: { tab: "activity", chip: "followUps" },
  notes: { tab: "activity", chip: "notes" }, attachments: { tab: "files" }, history: { tab: "activity", chip: "changes" },
};

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [keepWork, setKeepWork] = useState(false);
  // ?tab= opens a tab (links from search and from To-dos › Notes and Files); ?merge=<lead> opens the merge with that lead chosen.
  const params = useSearchParams();
  const requested = TAB_OF[params.get("tab") ?? ""] ?? TAB_OF.overview;
  const [tab, setTab] = useState(requested.tab);
  const [ask, setAsk] = useState<Ask | null>(null);
  const mergeWith = params.get("merge");
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

  // E edits the lead and L logs an activity on it, while it can be worked.
  const editable = Boolean(lead && options?.capabilities.edit && !lead.archivedAt && lead.status !== "converted");
  useCrmShortcut("e", editable ? () => router.push(`/crm/leads/${leadId}/edit`) : undefined);
  useCrmShortcut("l", editable ? () => setDialog("activity") : undefined);

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
        ? <LinkButton variant="primary" href={`/crm/leads/${lead.id}/convert`}>Convert lead</LinkButton>
        : lead.status === "disqualified" && can.reopen
          ? <Button variant="primary" onPress={() => askReopen()} isLoading={action.isPending}>Reopen lead</Button>
          : lead.convertedOpportunityId
            ? <LinkButton variant="primary" href={`/crm/opportunities/${lead.convertedOpportunityId}`}>Open deal</LinkButton>
            : undefined;

  // Reopening takes an optional note (kept in the lead's history).
  function askReopen() {
    setAsk({ title: `Reopen ${lead!.code}`, confirm: "Reopen lead", description: "The lead goes back to open and can be worked again.",
      fields: [{ name: "note", label: "Note", kind: "textarea", description: "Optional. Why it is reopened." }],
      run: async (values) => { await action.mutateAsync(() => reopenLead(lead!.id, String(values.note ?? "").trim() || undefined)); } });
  }
  // The menu, grouped: Edit · Ownership · Status, then Archive (red, at the bottom).
  const menuActions: Array<MoreMenuItem & { show: boolean }> = [
    { id: "edit", label: "Edit lead", show: canEdit, onAction: () => router.push(`/crm/leads/${lead.id}/edit`) },
    { id: "assign", group: "Ownership", label: lead.ownerUserId ? "Reassign" : "Assign", show: canAssign, onAction: () => setDialog("assign") },
    { id: "runRules", group: "Ownership", label: "Run assignment rules", show: canAssign, onAction: runRules },
    { id: "unassign", group: "Ownership", label: "Return to unassigned queue", show: working && can.reassign && Boolean(lead.ownerUserId),
      confirm: { title: "Return this lead to the unassigned queue?", description: `${lead.ownerName ?? "Its owner"} stops owning it; it waits in the unassigned queue until someone is assigned.`, confirmLabel: "Return to queue" },
      onAction: () => action.mutate(() => unassignLead(lead.id, { expectedUpdatedAt: lead.updatedAt })) },
    { id: "convertOverride", group: "Status", label: "Convert without full qualification", show: working && lead.status === "open" && can.convert && can.overrideQualification, onAction: () => router.push(`/crm/leads/${lead.id}/convert`) },
    { id: "disqualify", group: "Status", label: "Disqualify", show: working && can.disqualify && lead.status !== "disqualified", onAction: () => setDialog("disqualify") },
    { id: "reopen", group: "Status", label: "Reopen lead", show: working && can.reopen && lead.status === "qualified", onAction: askReopen },
    { id: "archive", label: "Archive lead", danger: true, show: working && can.delete, onAction: () => setDialog("archive") },
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
            { label: lead.mobile ? "Mobile" : "Phone", value: lead.mobile || lead.phone ? <a className="hover:underline" href={`tel:${(lead.mobile || lead.phone || "").replace(/[^0-9+]/g, "")}`}>{lead.mobile || lead.phone}</a>
              : lead.sensitiveDataRestricted ? "Hidden" : "Not set" },
            { label: "Next follow-up", value: <FollowUpCell value={lead.nextFollowUpAt} /> },
          ],
          primaryAction,
          secondaryActions: (
            <>
              {canTake && <Button variant="secondary" onPress={() => action.mutate(() => assignLeadToMe(lead.id, lead.updatedAt))} isLoading={action.isPending}>Assign to me</Button>}
              {canEdit && <Button variant="secondary" onPress={() => setDialog("activity")}>Log activity</Button>}
              {canEdit && <Button variant="secondary" onPress={() => setDialog("followUp")}>Schedule follow-up</Button>}
              {menuActions.length > 0 && <MoreMenu items={menuActions} isBusy={action.isPending} />}
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {lead.mergedIntoLeadId && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">
                <p>This lead was merged into <span className="font-medium">{lead.mergedIntoLeadName ?? lead.mergedIntoLeadCode}</span>. It is kept here for its history.</p>
                <LinkButton variant="outline" href={`/crm/leads/${lead.mergedIntoLeadId}`}>Open {lead.mergedIntoLeadCode ?? "the primary lead"}</LinkButton>
              </div>
            )}
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
            <Tab id="qualify">Qualify</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="files">Files</Tab>
            <Tab id="related">Related</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              {lead.status === "converted" && <ConversionSummary lead={lead} />}
              <LeadDuplicatesPanel lead={lead} canResolve={working && can.merge} hideWhenEmpty onMerged={refresh} mergeWith={mergeWith} />
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
                  { label: "Estimated value", value: lead.estimatedValue ? formatMoney(currency, lead.estimatedValue) : null },
                  { label: "Purchase timeframe", value: options.purchaseTimeframes.find((entry) => entry.code === lead.purchaseTimeframe)?.label },
                  { label: "Rating", value: <RatingBadge rating={lead.rating} /> },
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

          <TabPanel id="qualify">
            {/* Re-created when the lead changes, so the form starts from the saved answers. */}
            <QualificationPanel key={lead.updatedAt} lead={lead} options={options} onChanged={refresh} onQualify={() => setDialog("qualify")}
              onDisqualify={() => setDialog("disqualify")} onScheduleFollowUp={() => setDialog("followUp")} />
          </TabPanel>
          <TabPanel id="activity">
            <RecordActivityFeed entityType="lead" entityId={lead.id} initial={requested.chip} canAdd={canEdit}
              onLogActivity={() => setDialog("activity")} onScheduleFollowUp={() => setDialog("followUp")}
              sections={{
                calls: <LeadActivitiesPanel leadId={lead.id} options={options} canEdit={canEdit} />,
                tasks: <LeadTasksPanel leadId={lead.id} options={options} canEdit={canEdit} />,
                followUps: <RelatedFollowUpsPanel related={{ type: "lead", id: lead.id, name: leadName(lead) }} canCreate={canEdit} onChanged={refresh} />,
                notes: <RecordNotesPanel relatedType="lead" relatedId={lead.id} />,
                files: <RecordAttachmentsPanel relatedType="lead" relatedId={lead.id} />,
                changes: (
                  <>
                    <RecordTimelinePanel entityType="lead" entityId={lead.id} kinds={["stage", "history"]} />
                    <StageHistory leadId={lead.id} version={lead.stageChangedAt} />
                    <AuditTrail leadId={lead.id} />
                  </>
                ),
              }} />
          </TabPanel>
          <TabPanel id="files"><RecordAttachmentsPanel relatedType="lead" relatedId={lead.id} /></TabPanel>
          <TabPanel id="related"><div className="flex flex-col gap-4">{lead.status === "converted" && <ConversionSummary lead={lead} />}<RelatedDocuments type="lead" id={lead.id} /></div></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      <AssignLeadsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} leadIds={[lead.id]} lead={lead} options={options} onDone={refresh} />
      {/* Qualifying normally continues straight into converting the lead (the conversion page). */}
      <QualifyLeadDialog isOpen={dialog === "qualify"} onOpenChange={(open) => !open && setDialog(null)} lead={lead} options={options}
        onQualified={(convert) => { refresh(); setDialog(null); if (convert) router.push(`/crm/leads/${lead.id}/convert`); }}
        onAnswer={() => { setDialog(null); setTab("qualify"); }} />
      <DisqualifyLeadsDialog isOpen={dialog === "disqualify"} onOpenChange={(open) => !open && setDialog(null)} leadIds={[lead.id]} options={options} onDone={refresh} />
      <LogActivityDialog isOpen={dialog === "activity"} onOpenChange={(open) => !open && setDialog(null)} leadId={lead.id} options={options} onDone={refresh}
        onScheduleNext={() => setDialog("followUp")}
        currentStage={working && can.changeStage && lead.status === "open" ? lead.stage : undefined} />
      <ScheduleFollowUpForRecord isOpen={dialog === "followUp"} onOpenChange={(open) => !open && setDialog(null)} related={{ type: "lead", id: lead.id, name: leadName(lead) }} onDone={refresh} />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      <AlertDialog
        isOpen={dialog === "archive"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Archive this lead?"
        description={<span className="flex flex-col gap-2"><span>The lead leaves the working lists but keeps its history, notes, files and activities. It can be restored from the Archived view.
          Its open tasks and follow-ups are cancelled so no reminders keep firing.</span>
          <Checkbox isSelected={keepWork} onChange={setKeepWork}>Keep its open tasks and follow-ups instead</Checkbox></span>}
        tone="danger"
        confirmLabel="Archive lead"
        isConfirming={action.isPending}
        onConfirm={() => action.mutate(async () => { await archiveLead(lead.id, keepWork ? "keep" : "cancel"); setDialog(null); })}
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
  // Ticks show the stages the lead really went through (its stage history), not every stage before the current one.
  const workspace = useWorkspaceContext();
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead", lead.id, "stage-history", lead.updatedAt), queryFn: () => listLeadStageHistory(lead.id) });
  const visited = new Set((history.data ?? []).flatMap((entry) => [entry.fromStage, entry.toStage]).filter(Boolean));
  const passed = (index: number) => index < currentIndex && (!history.data || visited.has(stages[index].code));
  return (
    <ol aria-label="Lead stage" className="flex flex-wrap gap-1">
      {stages.map((stage, index) => {
        const isCurrent = index === currentIndex;
        const mark = isCurrent ? "●" : passed(index) ? "✓" : "○";
        const className = `flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-center text-sm font-medium transition-colors ${
          isCurrent ? "border-brand bg-brand text-text-inverse" : passed(index) ? "border-brand-border bg-brand-soft text-brand-active" : "border-border bg-surface text-text-secondary"}`;
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
              <span className="font-medium">{readableHistory(entry.summary)}</span>
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
        return <li key={field}>{fieldLabel(field)}: {String(change.from ?? "empty")} → {String(change.to ?? "empty")}</li>;
      })}
    </ul>
  );
}
