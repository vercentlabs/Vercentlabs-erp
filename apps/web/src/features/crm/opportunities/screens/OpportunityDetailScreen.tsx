"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog, Button, Dialog, ErrorState, Menu, MenuItem, MenuTrigger, RecordDetailsPage, Tab, TabList, TabPanel, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  archiveOpportunity, deleteOpportunity, errorMessage, getOpportunity, getOpportunityOptions, restoreOpportunity, setOpportunityProbability,
  type Opportunity, type OpportunityOptions, type OpportunityStageAction,
} from "../api/opportunities-api";
import { AssignOpportunitiesDialog, MarkLostDialog, MarkWonDialog, ReopenOpportunityDialog } from "../components/OpportunityActionDialogs";
import {
  LogActivityDialog, OpportunityContactsPanel, OpportunityHistoryPanel, OpportunityProductsPanel, OpportunityQuotationsPanel, OpportunityWorkPanel,
  useStartQuotation,
} from "../components/OpportunityPanels";
import { useStageChange } from "@/features/crm/sales-stages/components/StageChange";
import { RelatedTasksPanel } from "@/features/crm/tasks/components/RelatedTasksPanel";
import { RelatedFollowUpsPanel, ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { LIVE_OPPORTUNITY_QUERY } from "../live-query";
import { ErrorBanner, OpportunityFlags, OpportunityStageBadge, OpportunityStatusBadge, PriorityBadge, days } from "../opportunity-format";

type DialogKind = "assign" | "won" | "lost" | "reopen" | "activity" | "followUp" | "probability" | "archive" | "delete" | null;

export function OpportunityDetailScreen({ opportunityId }: { opportunityId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);

  const key = scopedQueryKey(workspace, "crm", "opportunity", opportunityId);
  const opportunityQuery = useQuery({ queryKey: key, queryFn: () => getOpportunity(opportunityId), ...LIVE_OPPORTUNITY_QUERY });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const opportunity = opportunityQuery.data;
  const options = optionsQuery.data;

  // Any change to the deal refreshes the record, its panels and the list.
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
    onError: (failure) => setError(errorMessage(failure)),
  });

  if (opportunityQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading opportunity" />;
  if (opportunityQuery.isError || !opportunity)
    return <ErrorState title="Opportunity not found" description="It may have been removed, or you may not have access to it." action={{ label: "Back to opportunities", onPress: () => router.push("/crm/opportunities") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  return (
    <OpportunityDetail opportunity={opportunity} options={options} tab={tab} setTab={setTab} dialog={dialog} setDialog={setDialog} error={error} setError={setError}
      refresh={refresh} run={(work) => action.mutate(work)} isRunning={action.isPending} />
  );
}

function OpportunityDetail({ opportunity, options, tab, setTab, dialog, setDialog, error, setError, refresh, run, isRunning }: {
  opportunity: Opportunity; options: OpportunityOptions; tab: string; setTab: (tab: string) => void; dialog: DialogKind; setDialog: (dialog: DialogKind) => void;
  error: string | null; setError: (message: string | null) => void; refresh: () => void; run: (work: () => Promise<unknown>) => void; isRunning: boolean;
}) {
  const router = useRouter();
  const startQuotation = useStartQuotation(setError);
  // The stage bar, Next stage and the pipeline all move a deal through the same operation.
  const stageChange = useStageChange({ onDone: refresh, onError: setError });
  const can = options.capabilities;
  const archived = Boolean(opportunity.archivedAt);
  const open = opportunity.status === "open" && !archived;
  const canEdit = can.edit && open;
  const canAssign = !archived && (opportunity.ownerUserId ? can.reassign : can.assign);
  const currency = opportunity.currencyCode ?? options.baseCurrency;
  const money = (amount: number | null) => (amount === null ? null : formatMoney(currency, amount));
  const close = (isOpen: boolean) => !isOpen && setDialog(null);
  const canMove = open && can.changeStage;
  const currentStage = options.stages.find((stage) => stage.id === opportunity.stageId);
  const nextStage = currentStage ? options.stages[options.stages.indexOf(currentStage) + 1] : undefined;
  // What the stage suggests, limited to what this person may do.
  const stageActions: Record<OpportunityStageAction, { label: string; show: boolean; run: () => void }> = {
    log_activity: { label: "Log activity", show: can.edit, run: () => setDialog("activity") },
    schedule_follow_up: { label: "Schedule follow-up", show: can.edit, run: () => setDialog("followUp") },
    edit_details: { label: "Add requirements", show: can.edit, run: () => router.push(`/crm/opportunities/${opportunity.id}/edit`) },
    add_products: { label: "Add products", show: can.edit, run: () => setTab("products") },
    create_quotation: { label: opportunity.quotationCount ? "Create revised quotation" : "Create quotation", show: can.createQuotation, run: () => startQuotation.mutate(opportunity) },
    view_quotations: { label: "View quotations", show: opportunity.quotationCount > 0, run: () => setTab("quotations") },
    mark_won: { label: "Mark won", show: can.markWon, run: () => setDialog("won") },
    mark_lost: { label: "Mark lost", show: can.markLost, run: () => setDialog("lost") },
  };
  const suggested = open && currentStage ? currentStage.suggestedActions.map((action) => stageActions[action]).filter((action) => action?.show) : [];

  const primaryAction = archived
    ? can.delete && <Button variant="primary" onPress={() => run(() => restoreOpportunity(opportunity.id))} isLoading={isRunning}>Restore opportunity</Button>
    : open && can.markWon
      ? <Button variant="primary" onPress={() => setDialog("won")}>Mark won</Button>
      : opportunity.status !== "open" && can.reopen
        ? <Button variant="primary" onPress={() => setDialog("reopen")}>Reopen</Button>
        : undefined;

  const menuActions = [
    { id: "edit", label: "Edit opportunity", show: canEdit, run: () => router.push(`/crm/opportunities/${opportunity.id}/edit`) },
    { id: "assign", label: opportunity.ownerUserId ? "Reassign" : "Assign", show: canAssign, run: () => setDialog("assign") },
    { id: "probability", label: "Set probability", show: open && can.changeProbability, run: () => setDialog("probability") },
    { id: "archive", label: "Archive opportunity", show: !archived && can.delete, run: () => setDialog("archive") },
    { id: "delete", label: "Delete opportunity", show: can.delete, run: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{opportunity.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{opportunity.code}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <OpportunityStatusBadge status={opportunity.status} />
              <OpportunityStageBadge opportunity={opportunity} />
              <OpportunityFlags opportunity={opportunity} />
            </span>
          ),
          fields: [
            { label: "Account", value: opportunity.accountId ? <Link className="hover:underline" href={`/crm/accounts/${opportunity.accountId}`}>{opportunity.accountName}</Link> : "Not set" },
            { label: "Owner", value: opportunity.ownerName ?? "Unassigned" },
            { label: opportunity.status === "won" ? "Final value" : "Estimated value", value: money(opportunity.status === "won" ? opportunity.wonAmount ?? opportunity.amount : opportunity.amount) },
            { label: "Probability", value: `${opportunity.probability}%${open ? (opportunity.probabilitySource === "manual_override" ? " (set by hand)" : " (stage default)") : ""}` },
            { label: "Weighted value", value: money(opportunity.weightedValue) },
            opportunity.status === "open"
              ? { label: "Expected close", value: opportunity.expectedCloseDate ? <span className={opportunity.isOverdue ? "font-medium text-danger" : ""}>{formatDate(opportunity.expectedCloseDate)}</span> : "Not set" }
              : { label: "Closed", value: formatDate(opportunity.actualCloseDate) },
          ],
          primaryAction,
          secondaryActions: (
            <>
              {open && can.markLost && <Button variant="secondary" onPress={() => setDialog("lost")}>Mark lost</Button>}
              {open && can.createQuotation && <Button variant="secondary" onPress={() => startQuotation.mutate(opportunity)} isLoading={startQuotation.isPending}>Create quotation</Button>}
              {can.edit && !archived && <Button variant="secondary" onPress={() => setDialog("activity")}>Log activity</Button>}
              {canEdit && <Button variant="secondary" onPress={() => setDialog("followUp")}>Schedule follow-up</Button>}
              {menuActions.length > 0 && (
                <MenuTrigger>
                  <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
                  <Menu onAction={(id) => menuActions.find((entry) => entry.id === id)?.run()}>
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
            <OutcomeBanner opportunity={opportunity} currency={currency} />
            <StageBar opportunity={opportunity} options={options} canChange={canMove} isChanging={stageChange.isPending} onChange={(stageId) => stageChange.move(opportunity, stageId)} />
            {open && currentStage && (currentStage.description || currentStage.guidance || suggested.length > 0 || nextStage) && (
              <section aria-label={`About ${currentStage.name}`} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
                {currentStage.description && <p><span className="font-medium">{currentStage.name}:</span> {currentStage.description}</p>}
                {currentStage.guidance && (
                  <ul className="list-disc pl-5 text-text-secondary">
                    {currentStage.guidance.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {suggested.map((action) => <Button key={action.label} variant="outline" size="compact" onPress={action.run}>{action.label}</Button>)}
                  {canMove && nextStage && (
                    <Button variant="secondary" size="compact" isLoading={stageChange.isPending} onPress={() => stageChange.move(opportunity, nextStage.id)}>Next stage: {nextStage.name}</Button>
                  )}
                </div>
              </section>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Opportunity sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="contacts">Contacts</Tab>
            <Tab id="products">Products{opportunity.productCount ? ` (${opportunity.productCount})` : ""}</Tab>
            <Tab id="activities">Activities</Tab>
            <Tab id="tasks">Tasks</Tab>
            <Tab id="followUps">Follow-ups</Tab>
            <Tab id="quotations">Quotations{opportunity.quotationCount ? ` (${opportunity.quotationCount})` : ""}</Tab>
            <Tab id="notes">Notes</Tab>
            <Tab id="attachments">Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <PropertyList title="Next step" columns={3} items={[
                { label: "Next step", value: opportunity.nextStep },
                { label: "Next step due", value: opportunity.nextStepDueAt ? formatDateTime(opportunity.nextStepDueAt) : null },
                { label: "Next activity", value: opportunity.nextActivity
                  ? `${opportunity.nextActivity.subject}${opportunity.nextActivity.dueAt ? ` · ${formatDateTime(opportunity.nextActivity.dueAt)}` : ""}`
                  : open ? <span className="font-medium text-warning">No next activity</span> : null },
                { label: "Last activity", value: opportunity.lastActivityAt ? `${formatDateTime(opportunity.lastActivityAt)} (${days(opportunity.daysSinceActivity)} ago)` : null },
              ]} />
              <PropertyList title="Opportunity details" columns={3} items={[
                { label: "Account", value: opportunity.accountId ? <Link className="hover:underline" href={`/crm/accounts/${opportunity.accountId}`}>{opportunity.accountName}</Link> : null },
                { label: "Primary contact", value: opportunity.contactId ? <Link className="hover:underline" href={`/crm/contacts/${opportunity.contactId}`}>{opportunity.contactName}</Link> : null },
                { label: "Owner", value: opportunity.ownerName ?? "Unassigned" },
                { label: "Team", value: opportunity.teamName },
                { label: "Sales stage", value: `${opportunity.stageBeforeCloseName ?? opportunity.stageName ?? "No stage"}${open ? ` · ${days(opportunity.stageAgeDays)} in stage` : ""}` },
                { label: "Priority", value: <PriorityBadge priority={opportunity.priority} /> },
                { label: "Estimated value", value: money(opportunity.amount) },
                { label: "Products total", value: opportunity.productCount ? money(opportunity.productsTotal) : null },
                { label: "Currency", value: currency },
                { label: "Expected close date", value: opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : null },
                { label: "Source", value: opportunity.sourceName },
                { label: "Created from lead", value: opportunity.leadId ? <Link className="hover:underline" href={`/crm/leads/${opportunity.leadId}`}>{opportunity.leadCode ?? "Open lead"}</Link> : null },
                { label: "Latest quotation", value: opportunity.latestQuotationId ? (
                  <Link className="hover:underline" href={`/sales/quotations/${opportunity.latestQuotationId}`}>
                    {opportunity.latestQuotationNumber}{opportunity.latestQuotationTotal !== null ? ` · ${formatMoney(opportunity.latestQuotationCurrency ?? currency, opportunity.latestQuotationTotal)}` : ""}
                  </Link>
                ) : null },
                { label: "Product / service interest", value: opportunity.productInterest, wide: true },
                { label: "Description", value: opportunity.description ? <span className="whitespace-pre-wrap">{opportunity.description}</span> : null, wide: true },
              ]} />
              <PropertyList title="The deal" columns={2} items={[
                { label: "Business problem", value: opportunity.businessProblem ? <span className="whitespace-pre-wrap">{opportunity.businessProblem}</span> : null },
                { label: "Requirements", value: opportunity.requirements ? <span className="whitespace-pre-wrap">{opportunity.requirements}</span> : null },
                { label: "Proposed solution", value: opportunity.proposedSolution ? <span className="whitespace-pre-wrap">{opportunity.proposedSolution}</span> : null },
                { label: "Commercial notes", value: opportunity.commercialNotes ? <span className="whitespace-pre-wrap">{opportunity.commercialNotes}</span> : null },
              ]} />
              <PropertyList title="Record" columns={3} items={[
                { label: "Created", value: `${formatDateTime(opportunity.createdAt)}${opportunity.createdByName ? ` by ${opportunity.createdByName}` : ""}` },
                { label: "Updated", value: `${formatDateTime(opportunity.updatedAt)}${opportunity.updatedByName ? ` by ${opportunity.updatedByName}` : ""}` },
              ]} />
            </div>
          </TabPanel>
          <TabPanel id="contacts"><OpportunityContactsPanel opportunity={opportunity} options={options} canEdit={can.edit && !archived} onChanged={refresh} /></TabPanel>
          <TabPanel id="products"><OpportunityProductsPanel key={opportunity.updatedAt} opportunity={opportunity} options={options} canEdit={canEdit} onChanged={refresh} /></TabPanel>
          <TabPanel id="activities"><OpportunityWorkPanel kind="activities" opportunity={opportunity} options={options} canEdit={canEdit} onChanged={refresh} /></TabPanel>
          <TabPanel id="tasks"><RelatedTasksPanel relatedType="opportunity" relatedId={opportunity.id} relatedName={opportunity.name} canCreate={can.edit && !archived} onChanged={refresh} /></TabPanel>
          <TabPanel id="followUps"><RelatedFollowUpsPanel related={{ type: "opportunity", id: opportunity.id, name: opportunity.name, accountId: opportunity.accountId }} canCreate={can.edit && !archived} onChanged={refresh} /></TabPanel>
          <TabPanel id="quotations"><OpportunityQuotationsPanel opportunity={opportunity} options={options} canEdit={can.edit && !archived} onChanged={refresh} /></TabPanel>
          <TabPanel id="notes"><NotesPanel entityType="opportunity" entityId={opportunity.id} /></TabPanel>
          <TabPanel id="attachments"><CrmAttachmentPanel entityType="opportunity" entityId={opportunity.id} /></TabPanel>
          <TabPanel id="history">
            <div className="flex flex-col gap-6">
              <RecordTimelinePanel entityType="opportunity" entityId={opportunity.id} />
              <OpportunityHistoryPanel opportunity={opportunity} />
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {stageChange.dialog}
      <AssignOpportunitiesDialog isOpen={dialog === "assign"} onOpenChange={close} opportunityIds={[opportunity.id]} opportunity={opportunity} options={options} onDone={refresh} />
      {/* Re-created when the deal changes, so each dialog starts from its current value and version. */}
      <MarkWonDialog key={`won:${opportunity.updatedAt}`} isOpen={dialog === "won"} onOpenChange={close} opportunity={opportunity} onDone={refresh} />
      <MarkLostDialog key={`lost:${opportunity.updatedAt}`} isOpen={dialog === "lost"} onOpenChange={close} options={options} opportunity={opportunity} onDone={refresh} />
      <ReopenOpportunityDialog isOpen={dialog === "reopen"} onOpenChange={close} options={options} opportunity={opportunity} onDone={refresh} />
      <LogActivityDialog isOpen={dialog === "activity"} onOpenChange={close} opportunity={opportunity} options={options} onDone={refresh} />
      <ScheduleFollowUpForRecord isOpen={dialog === "followUp"} onOpenChange={close} related={{ type: "opportunity", id: opportunity.id, name: opportunity.name, accountId: opportunity.accountId }} onDone={refresh} />
      <ProbabilityDialog key={`probability:${opportunity.updatedAt}`} isOpen={dialog === "probability"} onOpenChange={close} opportunity={opportunity} options={options} onDone={refresh} />
      <AlertDialog
        isOpen={dialog === "archive"} onOpenChange={close} tone="danger" confirmLabel="Archive opportunity" isConfirming={isRunning}
        title="Archive this opportunity?"
        description="It leaves the working lists and the pipeline but keeps its history, notes, files, activities and quotations. It can be restored from the Archived view."
        onConfirm={() => run(async () => { await archiveOpportunity(opportunity.id); setDialog(null); })}
      />
      <AlertDialog
        isOpen={dialog === "delete"} onOpenChange={close} tone="danger" confirmLabel="Delete opportunity" isConfirming={isRunning}
        title="Delete this opportunity?"
        description="Only an opportunity that was never used can be deleted: no quotations, activities, products, notes or files, and never won or lost. Otherwise archive it instead. This cannot be undone."
        onConfirm={() => run(async () => {
          try { await deleteOpportunity(opportunity.id); } finally { setDialog(null); }
          router.replace("/crm/opportunities");
        })}
      />
    </>
  );
}

// How the deal ended, shown above the stages once it is won or lost.
function OutcomeBanner({ opportunity, currency }: { opportunity: Opportunity; currency: string }) {
  if (opportunity.status === "open") return null;
  const won = opportunity.status === "won";
  const facts = won
    ? [
        `Won ${formatDate(opportunity.actualCloseDate)}${opportunity.wonByName ? ` by ${opportunity.wonByName}` : ""}`,
        opportunity.wonAmount !== null ? `Final value ${formatMoney(currency, opportunity.wonAmount)} (estimated ${formatMoney(currency, opportunity.amount)})` : null,
      ]
    : [
        `Lost ${formatDate(opportunity.actualCloseDate ?? opportunity.lostAt)}${opportunity.lostByName ? ` by ${opportunity.lostByName}` : ""}`,
        opportunity.lostReasonName ? `Reason: ${opportunity.lostReasonName}` : null,
        opportunity.competitorName ? `Competitor: ${opportunity.competitorName}` : null,
      ];
  const notes = won ? opportunity.outcomeNotes : opportunity.lossNotes ?? opportunity.outcomeNotes;
  return (
    <div role="status" className={`flex flex-col gap-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm ${won ? "border-success-emphasis/30 bg-success-soft" : "border-danger-emphasis/30 bg-danger-soft"}`}>
      <p className="font-medium">{facts.filter(Boolean).join(" · ")}</p>
      {notes && <p className="whitespace-pre-wrap text-text-secondary">{notes}</p>}
    </div>
  );
}

// The sales stages as a clickable track. Stage is where the deal is in the
// process; status (open, won, lost) is its outcome and is shown in the
// header. An open deal can move to any stage, forwards or backwards.
function StageBar({ opportunity, options, canChange, isChanging, onChange }: {
  opportunity: Opportunity; options: OpportunityOptions; canChange: boolean; isChanging: boolean; onChange: (stageId: string) => void;
}) {
  const isOpen = opportunity.status === "open";
  // A closed deal shows the stage it was won or lost from.
  const currentIndex = options.stages.findIndex((stage) => (isOpen ? stage.id === opportunity.stageId : stage.name === opportunity.stageBeforeCloseName));
  return (
    <ol aria-label="Sales stage" className="flex flex-wrap gap-1">
      {options.stages.map((stage, index) => {
        const isCurrent = index === currentIndex;
        const mark = isCurrent ? "●" : index < currentIndex ? "✓" : "○";
        const className = `flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-center text-sm font-medium transition-colors ${
          isCurrent ? "border-brand bg-brand text-text-inverse" : index < currentIndex ? "border-brand-border bg-brand-soft text-brand-active" : "border-border bg-surface text-text-secondary"}`;
        return (
          <li key={stage.id} className="flex min-w-32 flex-1" aria-current={isCurrent ? "step" : undefined}>
            {canChange && !isCurrent ? (
              <button type="button" disabled={isChanging} className={`${className} hover:border-brand disabled:opacity-60`} onClick={() => onChange(stage.id)}
                title={`Move to ${stage.name} (${stage.probability}%)`}>
                <span aria-hidden="true">{mark} </span>{stage.name}
              </button>
            ) : (
              <span className={className}>
                <span aria-hidden="true">{mark} </span>{stage.name}
                {isCurrent && isOpen && <span className="font-normal"> · {days(opportunity.stageAgeDays)}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Each stage suggests a probability; the owner can set their own. Returning
// to the stage's figure removes the override.
function ProbabilityDialog({ isOpen, onOpenChange, opportunity, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; opportunity: Opportunity; options: OpportunityOptions; onDone: () => void;
}) {
  const [probability, setProbability] = useState(String(opportunity.probability));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stageProbability = options.stages.find((stage) => stage.id === opportunity.stageId)?.probability;
  const value = Number(probability);
  const valid = probability.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;
  const mutation = useMutation({
    mutationFn: () => setOpportunityProbability(opportunity.id, { probability: value, reason: reason.trim() || undefined }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Set probability"
      description={stageProbability === undefined ? undefined : `${opportunity.stageName} suggests ${stageProbability}%. A probability set by hand is kept when the stage changes.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Probability (%)" isRequired inputMode="numeric" value={probability} onChange={setProbability}
          description={valid ? `Weighted value ${formatMoney(opportunity.currencyCode ?? options.baseCurrency, Math.round(opportunity.amount * value) / 100)}` : "Enter a number from 0 to 100."} />
        <TextArea label="Reason" description="Optional. Kept in the audit trail." value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          {stageProbability !== undefined && stageProbability !== opportunity.probability && (
            <Button variant="outline" onPress={() => setProbability(String(stageProbability))}>Use the stage&apos;s {stageProbability}%</Button>
          )}
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!valid}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
