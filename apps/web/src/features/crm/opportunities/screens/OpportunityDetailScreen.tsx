"use client";

// The deal page. The header keeps the name, number, status, stage and flags, and four facts: company, owner, value ("₹12 L at 40%", the
// weighted value beneath) and close date. The primary action follows the deal: Next stage while it is open, Mark won in the last stage,
// Reopen once closed, Restore when archived. Everything else is in the "…" menu, grouped, with Archive and Delete last. Six tabs: Overview,
// People, Products, Quotes, Activity (one feed with chips) and Files & related.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, Checkbox, Dialog, ErrorState, RecordDetailsPage, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { EmailButton } from "@/features/crm/shared/ui/EmailComposer";
import { FollowButton } from "@/features/crm/shared/ui/FollowButton";
import { ApplyPlanButton } from "@/features/crm/activity-types/ApplyPlanButton";
import { WhatsAppButton } from "@/features/crm/shared/ui/WhatsAppComposer";
import { CallSmsButtons } from "@/features/crm/shared/ui/CallSmsButtons";
import { TagEditor } from "@/features/crm/shared/ui/TagChips";
import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { RelatedDocuments } from "@/shared/related/RelatedDocuments";
import { RecordNotesPanel } from "@/features/crm/notes/components/RecordNotesPanel";
import { RecordActivityFeed, type ActivityChip } from "@/features/crm/shared/RecordActivityFeed";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { MoreMenu, type MoreMenuItem } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/shared/ui/PropertyList";
import { customFieldProperties } from "@/features/crm/shared/ui/CustomFields";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  archiveOpportunity, deleteOpportunity, errorMessage, getOpportunity, getOpportunityOptions, optionsForDeal, restoreOpportunity, setOpportunityProbability,
  type Opportunity, type OpportunityOptions, type OpportunityStage, type OpportunityStageAction,
} from "../api/opportunities-api";
import { AssignOpportunitiesDialog } from "../components/OpportunityActionDialogs";
import { MovePipelineDialog } from "../components/MovePipelineDialog";
import { MergeDealDialog } from "../components/MergeDealDialog";
import { CorrectCloseReasonDialog, MarkLostDialog, MarkWonDialog, ReopenOpportunityDialog } from "@/features/crm/close-reasons/components/CloseDialogs";
import { CloseSummaryPanel } from "@/features/crm/close-reasons/components/CloseSummaryPanel";
import {
  LogActivityDialog, OpportunityContactsPanel, OpportunityHistoryPanel, OpportunityProductsPanel, OpportunityWorkPanel,
} from "../components/OpportunityPanels";
import { OpportunityQuotationsPanel } from "@/features/crm/quotations/components/OpportunityQuotationsPanel";
import { CrmQuotesPanel } from "@/features/crm/quotes/CrmQuotesPanel";
import { createQuotationHref } from "@/features/crm/quotations/screens/CreateQuotationScreen";
import { useStageChange } from "@/features/crm/sales-stages/components/StageChange";
import { RelatedTasksPanel } from "@/features/crm/tasks/components/RelatedTasksPanel";
import { RelatedFollowUpsPanel, ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { LIVE_OPPORTUNITY_QUERY } from "../live-query";
import { ErrorBanner, OpportunityFlags, OpportunityStageBadge, OpportunityStatusBadge, PriorityBadge, days } from "../opportunity-format";
import { useCrmShortcut } from "@/features/crm/shared/shortcuts";

type DialogKind = "assign" | "won" | "lost" | "reopen" | "activity" | "followUp" | "probability" | "archive" | "delete" | "correctReason" | "pipeline" | "merge" | null;

// Old ?tab= values (links from search, Notes & Files, notifications) open the tab — and the Activity chip — that now holds them.
const TAB_OF: Record<string, { tab: string; chip?: ActivityChip }> = {
  overview: { tab: "overview" }, people: { tab: "people" }, contacts: { tab: "people" }, products: { tab: "products" }, quotes: { tab: "quotes" },
  quotations: { tab: "quotes" }, activity: { tab: "activity" }, activities: { tab: "activity", chip: "calls" }, tasks: { tab: "activity", chip: "tasks" },
  followUps: { tab: "activity", chip: "followUps" }, notes: { tab: "activity", chip: "notes" }, history: { tab: "activity", chip: "changes" },
  files: { tab: "files" }, attachments: { tab: "files" }, related: { tab: "files" },
};

export function OpportunityDetailScreen({ opportunityId }: { opportunityId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const requested = TAB_OF[useSearchParams().get("tab") ?? ""] ?? TAB_OF.overview;
  const [tab, setTab] = useState(requested.tab);
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

  if (opportunityQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading deal" />;
  if (opportunityQuery.isError || !opportunity)
    return <ErrorState title="Deal not found" description="It may have been removed, or you may not have access to it." action={{ label: "Back to deals", onPress: () => router.push("/crm/opportunities") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  return (
    <OpportunityDetail opportunity={opportunity} options={optionsForDeal(options, opportunity)} tab={tab} setTab={setTab} initialChip={requested.chip} dialog={dialog} setDialog={setDialog} error={error}
      setError={setError} refresh={refresh} run={(work) => action.mutate(work)} isRunning={action.isPending} />
  );
}

function OpportunityDetail({ opportunity, options, tab, setTab, initialChip, dialog, setDialog, error, setError, refresh, run, isRunning }: {
  opportunity: Opportunity; options: OpportunityOptions; tab: string; setTab: (tab: string) => void; initialChip?: ActivityChip; dialog: DialogKind;
  setDialog: (dialog: DialogKind) => void; error: string | null; setError: (message: string | null) => void; refresh: () => void;
  run: (work: () => Promise<unknown>) => void; isRunning: boolean;
}) {
  const router = useRouter();
  const [keepWork, setKeepWork] = useState(false);
  const workspace = useWorkspaceContext();
  // Set when Mark won is started from an accepted quotation.
  const [winningQuotationId, setWinningQuotationId] = useState<string | undefined>(undefined);
  const canCorrectReason = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.opportunities.edit_close_reason");
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
  const inLastStage = Boolean(currentStage) && !nextStage;
  // What the stage suggests, limited to what this person may do.
  // Create quotation shows to everyone who may quote from a deal. Without the Sales app it makes a CRM quote (the Quotes tab); with
  // Sales but without Sales' own permission it is disabled, with that reason.
  const quoteBlocked = can.createQuotation && can.salesInstalled && !can.quoteInSales ? "Creating a quotation also needs the Sales permission to create quotations." : null;
  const quoteCount = opportunity.quotationCount + (opportunity.crmQuoteCount ?? 0);
  const stageActions: Record<OpportunityStageAction, { label: string; show: boolean; run: () => void; blocked?: string | null }> = {
    log_activity: { label: "Log activity", show: can.edit, run: () => setDialog("activity") },
    schedule_follow_up: { label: "Schedule follow-up", show: can.edit, run: () => setDialog("followUp") },
    edit_details: { label: "Add requirements", show: can.edit, run: () => router.push(`/crm/opportunities/${opportunity.id}/edit`) },
    add_products: { label: "Add products", show: can.edit, run: () => setTab("products") },
    create_quotation: { label: quoteCount ? "Create revised quotation" : "Create quotation", show: can.createQuotation, blocked: quoteBlocked,
      run: () => (can.salesInstalled ? router.push(createQuotationHref(opportunity.id)) : setTab("quotes")) },
    view_quotations: { label: "View quotations", show: quoteCount > 0, run: () => setTab("quotes") },
    mark_won: { label: "Mark won", show: can.markWon, run: () => setDialog("won") },
    mark_lost: { label: "Mark lost", show: can.markLost, run: () => setDialog("lost") },
  };
  const suggestedCodes = open && currentStage ? currentStage.suggestedActions.filter((code) => stageActions[code]?.show) : [];
  // Beside Next stage: the stage's first suggested action (not one already in the buttons), then Log activity.
  const stageFirst = suggestedCodes.find((code) => !["log_activity", "mark_won", "mark_lost"].includes(code));
  // The stage panel leaves out what the header already shows (in the last stage: Mark won, Mark lost and Log activity).
  const inHeader = new Set<OpportunityStageAction>(inLastStage ? ["mark_won", "mark_lost", "log_activity"] : [...(stageFirst ? [stageFirst] : []), "log_activity"]);
  const panelActions = suggestedCodes.filter((code) => !inHeader.has(code)).map((code) => stageActions[code]);
  // Why Create quotation is disabled, wherever it shows.
  const showQuoteBlocked = Boolean(quoteBlocked) && (panelActions.some((entry) => entry.blocked) || (!inLastStage && stageFirst === "create_quotation"));

  const primaryAction = archived
    ? can.delete && <Button variant="primary" onPress={() => run(() => restoreOpportunity(opportunity.id))} isLoading={isRunning}>Restore deal</Button>
    : !open
      ? can.reopen && <Button variant="primary" onPress={() => setDialog("reopen")}>Reopen</Button>
      : inLastStage
        ? can.markWon && <Button variant="primary" onPress={() => setDialog("won")}>Mark won</Button>
        : canMove && nextStage
          ? <Button variant="primary" isLoading={stageChange.isPending} onPress={() => stageChange.move(opportunity, nextStage.id)}>Next stage: {nextStage.name}</Button>
          : undefined;
  const wonInButtons = open && inLastStage && can.markWon;
  const lostInButtons = open && inLastStage && can.markLost;

  // The menu, grouped: Edit · Ownership · Deal · Outcome, then Archive and Delete (red, last).
  const menuActions: Array<MoreMenuItem & { show: boolean }> = [
    { id: "edit", label: "Edit deal", show: canEdit, onAction: () => router.push(`/crm/opportunities/${opportunity.id}/edit`) },
    { id: "assign", group: "Ownership", label: opportunity.ownerUserId ? "Reassign" : "Assign", show: canAssign, onAction: () => setDialog("assign") },
    { id: "probability", group: "Deal", label: "Set probability", show: open && can.changeProbability, onAction: () => setDialog("probability") },
    { id: "followUp", group: "Deal", label: "Schedule follow-up", show: canEdit, onAction: () => setDialog("followUp") },
    { id: "merge", group: "Deal", label: "Merge another deal into this one", show: open && can.edit && can.markLost, onAction: () => setDialog("merge") },
    { id: "pipeline", group: "Deal", label: "Move to another pipeline", show: open && can.changeStage && (options.pipelines?.length ?? 0) > 1, onAction: () => setDialog("pipeline") },
    { id: "won", group: "Outcome", label: "Mark won", show: open && can.markWon && !wonInButtons, onAction: () => setDialog("won") },
    { id: "lost", group: "Outcome", label: "Mark lost", show: open && can.markLost && !lostInButtons, onAction: () => setDialog("lost") },
    { id: "archive", label: "Archive deal", danger: true, show: !archived && can.delete, onAction: () => setDialog("archive") },
    { id: "delete", label: "Delete deal", danger: true, show: can.delete, onAction: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  const valueAmount = opportunity.status === "won" ? opportunity.wonAmount ?? opportunity.amount : opportunity.amount;
  // E edits the deal and L logs an activity on it, while it is open.
  useCrmShortcut("e", canEdit ? () => router.push(`/crm/opportunities/${opportunity.id}/edit`) : undefined);
  useCrmShortcut("l", open && can.edit ? () => setDialog("activity") : undefined);

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
            { label: "Company", value: opportunity.accountId ? <Link className="hover:underline" href={`/crm/accounts/${opportunity.accountId}`}>{opportunity.accountName}</Link> : "Not set" },
            { label: "Owner", value: opportunity.ownerName ?? "Unassigned" },
            {
              label: opportunity.status === "won" ? "Final value" : "Value",
              value: (
                <span className="flex flex-col">
                  <span title={open ? (opportunity.probabilitySource === "manual_override" ? "Probability set by hand" : "The stage's probability") : undefined}>
                    {money(valueAmount)}{opportunity.status === "open" ? ` at ${opportunity.probability}%` : ""}
                  </span>
                  {opportunity.status === "open" && <span className="text-xs font-normal text-text-muted">Weighted {money(opportunity.weightedValue)}</span>}
                </span>
              ),
            },
            opportunity.status === "open"
              ? { label: "Close date", value: opportunity.expectedCloseDate ? <span className={opportunity.isOverdue ? "font-medium text-danger" : ""}>{formatDate(opportunity.expectedCloseDate)}</span> : "Not set" }
              : { label: "Closed", value: formatDate(opportunity.actualCloseDate) },
          ],
          primaryAction: primaryAction || undefined,
          secondaryActions: (
            <>
              {can.edit && !archived && <EmailButton entity="opportunities" recordId={opportunity.id} />}
              <FollowButton entity="opportunities" recordId={opportunity.id} />
              {canEdit && <ApplyPlanButton relatedType="opportunity" relatedId={opportunity.id} onApplied={refresh} />}
              {can.edit && !archived && <WhatsAppButton entity="opportunities" recordId={opportunity.id} />}
              {can.edit && !archived && <CallSmsButtons entity="opportunities" recordId={opportunity.id} />}
              {open && !inLastStage && stageFirst && (
                <Button variant="secondary" isDisabled={Boolean(stageActions[stageFirst].blocked)} onPress={stageActions[stageFirst].run}>{stageActions[stageFirst].label}</Button>
              )}
              {lostInButtons && <Button variant="secondary" onPress={() => setDialog("lost")}>Mark lost</Button>}
              {open && can.edit && <Button variant="secondary" onPress={() => setDialog("activity")}>Log activity</Button>}
              <MoreMenu label="More deal actions" items={menuActions} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            <OutcomeBanner opportunity={opportunity} currency={currency} />
            <StageBar opportunity={opportunity} options={options} canChange={canMove} isChanging={stageChange.isPending} onChange={(stageId) => stageChange.move(opportunity, stageId)} />
            {open && currentStage && (currentStage.description || currentStage.guidance || panelActions.length > 0 || showQuoteBlocked) && (
              <section aria-label={`About ${currentStage.name}`} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
                {currentStage.description && <p><span className="font-medium">{currentStage.name}:</span> {currentStage.description}</p>}
                {currentStage.guidance && (
                  <ul className="list-disc pl-5 text-text-secondary">
                    {currentStage.guidance.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
                {panelActions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {panelActions.map((entry) => <Button key={entry.label} variant="outline" size="compact" isDisabled={Boolean(entry.blocked)} onPress={entry.run}>{entry.label}</Button>)}
                  </div>
                )}
                {showQuoteBlocked && <p className="text-xs text-text-muted">{quoteBlocked}</p>}
              </section>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Deal sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="people">People</Tab>
            <Tab id="products">Products{opportunity.productCount ? ` (${opportunity.productCount})` : ""}</Tab>
            <Tab id="quotes">Quotes{quoteCount ? ` (${quoteCount})` : ""}</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="files">Files &amp; related</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <CloseSummaryPanel opportunity={opportunity} canCorrect={canCorrectReason && !archived} onCorrect={() => setDialog("correctReason")} />
              <PropertyList title="Next step" columns={3} items={[
                { label: "Next step", value: opportunity.nextStep },
                { label: "Next step due", value: opportunity.nextStepDueAt ? formatDateTime(opportunity.nextStepDueAt) : null },
                { label: "Next activity", value: opportunity.nextActivity
                  ? `${opportunity.nextActivity.subject}${opportunity.nextActivity.dueAt ? ` · ${opportunity.nextActivity.dueTimeSet === false ? formatDate(opportunity.nextActivity.dueAt) : formatDateTime(opportunity.nextActivity.dueAt)}` : ""}`
                  : open ? <span className="font-medium text-warning">No next activity</span> : null },
                { label: "Last activity", value: opportunity.lastActivityAt ? `${formatDateTime(opportunity.lastActivityAt)} (${days(opportunity.daysSinceActivity)} ago)` : null },
              ]} />
              <PropertyList title="Deal details" columns={3} items={[
                { label: "Company", value: opportunity.accountId ? <Link className="hover:underline" href={`/crm/accounts/${opportunity.accountId}`}>{opportunity.accountName}</Link> : null },
                { label: "Primary contact", value: opportunity.contactId ? <Link className="hover:underline" href={`/crm/contacts/${opportunity.contactId}`}>{opportunity.contactName}</Link> : null },
                { label: "Owner", value: opportunity.ownerName ?? "Unassigned" },
                { label: "Team", value: opportunity.teamName },
                { label: "Sales stage", value: `${opportunity.stageBeforeCloseName ?? opportunity.stageName ?? "No stage"}${open ? ` · ${days(opportunity.stageAgeDays)} in stage` : ""}` },
                { label: "Priority", value: <PriorityBadge priority={opportunity.priority} /> },
                { label: "Estimated value", value: money(opportunity.amount) },
                { label: "Products total", value: opportunity.productCount ? money(opportunity.productsTotal) : null },
                { label: "Currency", value: currency },
                { label: "Close date", value: opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : null },
                { label: "Recurring", value: opportunity.recurringPlanName && opportunity.recurringRevenue !== null && opportunity.recurringRevenue !== undefined
                  ? `${money(opportunity.recurringRevenue)} ${opportunity.recurringPlanName.toLowerCase()}${opportunity.monthlyRecurringRevenue !== null && opportunity.monthlyRecurringRevenue !== undefined ? ` · ${money(opportunity.monthlyRecurringRevenue)} a month` : ""}`
                  : opportunity.recurringPlanName ?? null },
                { label: "Source", value: opportunity.sourceName },
                { label: "Campaign", value: opportunity.campaignName },
                { label: "Came through", value: opportunity.mediumLabel },
                { label: "Tags", wide: true, value: <TagEditor entity="opportunity" recordId={opportunity.id} tags={opportunity.tags ?? []} available={options.tags ?? []}
                  canEdit={Boolean(can.edit) && !opportunity.archivedAt} onChanged={refresh} /> },
                { label: "Created from lead", value: opportunity.leadId ? <Link className="hover:underline" href={`/crm/leads/${opportunity.leadId}`}>{opportunity.leadCode ?? "Open lead"}</Link> : null },
                { label: "Latest quotation", value: opportunity.latestQuotationId ? (() => {
                  const label = `${opportunity.latestQuotationNumber ?? ""}${opportunity.latestQuotationTotal !== null ? ` · ${formatMoney(opportunity.latestQuotationCurrency ?? currency, opportunity.latestQuotationTotal)}` : ""}`;
                  // A link into Sales only for whoever may open Sales documents (and only while the organization has Sales).
                  return can.seesSales ? <Link className="hover:underline" href={`/sales/quotations/${opportunity.latestQuotationId}`}>{label}</Link> : label;
                })() : null },
                { label: "Sales order", value: opportunity.latestOrder ? (can.seesSales
                  ? <Link className="hover:underline" href={`/sales/orders/${opportunity.latestOrder.id}`}>{opportunity.latestOrder.number}</Link> : opportunity.latestOrder.number) : null },
                { label: "Buyer's PO", value: opportunity.latestOrder?.customerPoNumber
                  ? `${opportunity.latestOrder.customerPoNumber}${opportunity.latestOrder.customerPoDate ? ` · ${formatDate(opportunity.latestOrder.customerPoDate)}` : ""}` : null },
                { label: "Product / service interest", value: opportunity.productInterest, wide: true },
                { label: "Description", value: opportunity.description ? <span className="whitespace-pre-wrap">{opportunity.description}</span> : null, wide: true },
              ]} />
              {customFieldProperties(options.customFields ?? [], opportunity.customFields).length > 0 && (
                <PropertyList title="More about this deal" columns={3} items={customFieldProperties(options.customFields ?? [], opportunity.customFields)} />
              )}
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
          <TabPanel id="people"><OpportunityContactsPanel opportunity={opportunity} options={options} canEdit={can.edit && !archived} onChanged={refresh} /></TabPanel>
          <TabPanel id="products"><OpportunityProductsPanel key={opportunity.updatedAt} opportunity={opportunity} options={options} canEdit={canEdit} onChanged={refresh} /></TabPanel>
          <TabPanel id="quotes">
            {/* Without the Sales app the deal makes its own quotes; with Sales, quotations are made there and older CRM quotes stay listed. */}
            {!can.salesInstalled ? <CrmQuotesPanel opportunityId={opportunity.id} open={open} hasCompany={Boolean(opportunity.accountId)} /> : <>
            <OpportunityQuotationsPanel opportunity={{ id: opportunity.id, status: opportunity.status, archivedAt: opportunity.archivedAt, estimatedValue: opportunity.amount, currencyCode: opportunity.currencyCode }}
              canCreate={can.createQuotation} createBlocked={quoteBlocked} canEdit={can.edit && !archived} onChanged={refresh}
              onMarkWon={can.markWon ? (quotationId) => { setWinningQuotationId(quotationId); setDialog("won"); } : undefined} />
            <CrmQuotesPanel opportunityId={opportunity.id} open={open} hasCompany={Boolean(opportunity.accountId)} hideWhenEmpty />
            </>}
          </TabPanel>
          <TabPanel id="activity">
            <RecordActivityFeed entityType="opportunity" entityId={opportunity.id} initial={initialChip} canAdd={can.edit && !archived}
              onLogActivity={() => setDialog("activity")} onScheduleFollowUp={canEdit ? () => setDialog("followUp") : undefined}
              sections={{
                calls: <OpportunityWorkPanel kind="activities" opportunity={opportunity} options={options} canEdit={canEdit} onChanged={refresh} />,
                tasks: <RelatedTasksPanel relatedType="opportunity" relatedId={opportunity.id} relatedName={opportunity.name} canCreate={can.edit && !archived} onChanged={refresh} />,
                followUps: <RelatedFollowUpsPanel related={{ type: "opportunity", id: opportunity.id, name: opportunity.name, accountId: opportunity.accountId }} canCreate={can.edit && !archived} onChanged={refresh} />,
                notes: <RecordNotesPanel relatedType="opportunity" relatedId={opportunity.id} />,
                changes: (
                  <>
                    <RecordTimelinePanel entityType="opportunity" entityId={opportunity.id} kinds={["stage", "history"]} />
                    <OpportunityHistoryPanel opportunity={opportunity} />
                  </>
                ),
              }} />
          </TabPanel>
          <TabPanel id="files">
            <div className="flex flex-col gap-6">
              <RecordAttachmentsPanel relatedType="opportunity" relatedId={opportunity.id} />
              <RelatedDocuments type="opportunity" id={opportunity.id} />
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {stageChange.dialog}
      <AssignOpportunitiesDialog isOpen={dialog === "assign"} onOpenChange={close} opportunityIds={[opportunity.id]} opportunity={opportunity} options={options} onDone={refresh} />
      {/* Re-created when the deal changes, so each dialog starts from its current value and version. */}
      <MarkWonDialog key={`won:${opportunity.updatedAt}:${winningQuotationId ?? ""}`} isOpen={dialog === "won"} onOpenChange={close} options={options} opportunity={opportunity} onDone={refresh} winningQuotationId={winningQuotationId} />
      <CorrectCloseReasonDialog key={`correct:${opportunity.updatedAt}`} isOpen={dialog === "correctReason"} onOpenChange={close} options={options} opportunity={opportunity} onDone={refresh} />
      <MarkLostDialog key={`lost:${opportunity.updatedAt}`} isOpen={dialog === "lost"} onOpenChange={close} options={options} opportunity={opportunity} onDone={refresh} />
      <ReopenOpportunityDialog isOpen={dialog === "reopen"} onOpenChange={close} options={options} opportunity={opportunity} onDone={refresh} />
      {dialog === "merge" && <MergeDealDialog isOpen onOpenChange={close} opportunity={opportunity} onDone={refresh} />}
      {dialog === "pipeline" && <MovePipelineDialog isOpen onOpenChange={close} opportunity={opportunity} pipelines={options.pipelines ?? []} onDone={refresh} />}
      <LogActivityDialog isOpen={dialog === "activity"} onOpenChange={close} opportunity={opportunity} options={options} onDone={refresh} />
      <ScheduleFollowUpForRecord isOpen={dialog === "followUp"} onOpenChange={close} related={{ type: "opportunity", id: opportunity.id, name: opportunity.name, accountId: opportunity.accountId }} onDone={refresh} />
      <ProbabilityDialog key={`probability:${opportunity.updatedAt}`} isOpen={dialog === "probability"} onOpenChange={close} opportunity={opportunity} options={options} onDone={refresh} />
      <AlertDialog
        isOpen={dialog === "archive"} onOpenChange={close} tone="danger" confirmLabel="Archive deal" isConfirming={isRunning}
        title="Archive this deal?"
        description={<span className="flex flex-col gap-2"><span>It leaves the working lists and the pipeline but keeps its history, notes, files, activities and quotations. It can be restored from the Archived view.
          Its open tasks and follow-ups are cancelled so no reminders keep firing.</span>
          <Checkbox isSelected={keepWork} onChange={setKeepWork}>Keep its open tasks and follow-ups instead</Checkbox></span>}
        onConfirm={() => run(async () => { await archiveOpportunity(opportunity.id, keepWork ? "keep" : "cancel"); setDialog(null); })}
      />
      <AlertDialog
        isOpen={dialog === "delete"} onOpenChange={close} tone="danger" confirmLabel="Delete deal" isConfirming={isRunning}
        title="Delete this deal?"
        description="Only a deal that was never used can be deleted: no quotations, activities, products, notes or files, and never won or lost. Otherwise archive it instead. This cannot be undone."
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

// What a stage needs before a deal may enter it, with a tick or a cross for this deal (shown in the step's tooltip, so a refusal is expected).
function requirementLines(stage: OpportunityStage, opportunity: Opportunity) {
  const met = { contact: Boolean(opportunity.contactId), value: opportunity.amount > 0, closeDate: Boolean(opportunity.expectedCloseDate) };
  return (stage.requirements ?? []).map((requirement) => `${met[requirement.key] ? "✓" : "✗"} ${requirement.label}`);
}

// The sales stages as a clickable track. Stage is where the deal is in the process; status (open, won, lost) is its outcome and is shown in
// the header. An open deal can move to any stage, forwards or backwards. Each step's tooltip lists what the stage needs.
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
        const needs = requirementLines(stage, opportunity);
        const tip = [`${canChange && !isCurrent ? "Move to " : ""}${stage.name} (${stage.probability}%)`, ...(needs.length ? ["Needs:", ...needs] : [])].join("\n");
        const className = `flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-center text-sm font-medium transition-colors ${
          isCurrent ? "border-brand bg-brand text-text-inverse" : index < currentIndex ? "border-brand-border bg-brand-soft text-brand-active" : "border-border bg-surface text-text-secondary"}`;
        return (
          <li key={stage.id} className="flex min-w-32 flex-1" aria-current={isCurrent ? "step" : undefined}>
            {canChange && !isCurrent ? (
              <button type="button" disabled={isChanging} className={`${className} hover:border-brand disabled:opacity-60`} onClick={() => onChange(stage.id)} title={tip}>
                <span aria-hidden="true">{mark} </span>{stage.name}
                {needs.length > 0 && <span className="sr-only">. Needs: {needs.join(", ")}</span>}
              </button>
            ) : (
              <span className={className} title={tip}>
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
