"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil } from "lucide-react";
import {
  Button,
  ConflictBanner,
  Dialog,
  ErrorState,
  NumberField,
  PermissionState,
  RecordDetailsPage,
  Select,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS, SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { toNumber } from "@/features/crm/shared/format";
import { dueLabel, dueState, formatDate, formatMoney, humanize } from "@/shared/format/human";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { StageProgress } from "@/features/crm/shared/ui/StageProgress";
import { EmailHistoryPanel } from "@/features/crm/shared/EmailHistoryPanel";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { CustomFieldsRuntimePanel } from "@/features/crm/shared/CustomFieldsRuntimePanel";
import {
  archiveOpportunity,
  getOpportunity,
  getOpportunityPredictiveProbability,
  getOpportunityProbabilityHistory,
  moveOpportunityStage,
  OpportunityApiError,
  restoreOpportunity,
  updateOpportunityProbability,
} from "../api/opportunities-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { OpportunityContactRolesPanel } from "../components/OpportunityContactRolesPanel";
import { OpportunityQuotationsPanel } from "../components/OpportunityQuotationsPanel";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  open: "info",
  won: "success",
  lost: "danger",
  archived: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F011 gap-closure — crm_opportunity_probability_history's `source` column
// has existed since migration 099 but was never labeled for a human reader
// anywhere; this is the one place that translates it.
const probabilitySourceLabel: Record<string, string> = {
  manual_override: "Manually set",
  stage_default: "Stage default",
  terminal_won: "Won",
  terminal_lost: "Lost",
  reopen: "Reopened",
  restored: "Restored from archive",
};

export function OpportunityDetailScreen({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);
  const canCreateQuotation = workspace.permissions.includes(SALES_PERMISSIONS.quotationCreate);

  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = useState("");
  const [pendingProbability, setPendingProbability] = useState<number | null>(null);
  const [probabilityNote, setProbabilityNote] = useState("");
  const [outcomeReasonId, setOutcomeReasonId] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreReason, setRestoreReason] = useState("");

  const opportunityQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId),
    queryFn: () => getOpportunity(opportunityId),
  });
  const opportunity = opportunityQuery.data?.record;

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });


  // F011 gap-closure — the probability ledger and the predictive model's
  // per-Opportunity prediction both already existed with no reader; these
  // are that reader. History is shown to every viewer (transparency, not an
  // action); the prediction only matters while the deal is still open.
  const probabilityHistoryQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId, "probability-history"),
    queryFn: () => getOpportunityProbabilityHistory(opportunityId),
    enabled: Boolean(opportunity),
  });
  const predictiveProbabilityQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId, "predictive-probability"),
    queryFn: () => getOpportunityPredictiveProbability(opportunityId),
    enabled: Boolean(opportunity) && opportunity?.status === "open",
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
  }

  function handleError(error: unknown) {
    if (error instanceof OpportunityApiError && (error.code === "CRM_STALE_WRITE" || error.code === "CRM_STAGE_CONFLICT")) {
      setConflictMessage(error.message);
      return;
    }
    setActionError(error instanceof Error ? error.message : "This action could not be completed.");
  }

  const targetStage = useMemo(() => {
    const rows = (optionsQuery.data?.options?.stages ?? []) as Array<{ id: string; isWon: boolean; isLost: boolean }>;
    return rows.find((row) => row.id === pendingStageId);
  }, [optionsQuery.data, pendingStageId]);
  const requiresOutcome = Boolean(targetStage?.isWon || targetStage?.isLost);
  // F026 — moving a won/lost deal back to an open stage is a reopen: the
  // server requires a reason (kept in the immutable stage history next to
  // the prior close reason), so the form must collect one.
  const reopening = Boolean(targetStage && !requiresOutcome && (opportunity?.status === "won" || opportunity?.status === "lost"));

  const stageMutation = useMutation({
    mutationFn: () =>
      moveOpportunityStage(opportunityId, {
        stageId: pendingStageId,
        note: reopening ? reopenReason.trim() : undefined,
        expectedUpdatedAt: opportunity!.updatedAt,
        expectedStageId: opportunity!.stageId,
        outcomeReasonId: requiresOutcome ? outcomeReasonId || null : undefined,
        outcomeNotes: requiresOutcome ? outcomeNotes || null : undefined,
      }),
    onSuccess: () => {
      setActionError(null);
      setPendingStageId("");
      setOutcomeReasonId("");
      setOutcomeNotes("");
      setReopenReason("");
      invalidate();
    },
    onError: handleError,
  });

  const probabilityMutation = useMutation({
    mutationFn: () =>
      updateOpportunityProbability(opportunityId, {
        probability: pendingProbability ?? 0,
        note: probabilityNote.trim() || null,
        expectedUpdatedAt: opportunity!.updatedAt,
        expectedProbability: opportunity!.probability === null ? null : toNumber(opportunity!.probability),
      }),
    onSuccess: () => {
      setActionError(null);
      setProbabilityNote("");
      invalidate();
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId, "probability-history") });
    },
    onError: handleError,
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveOpportunity(opportunityId, opportunity!.updatedAt),
    onSuccess: () => {
      setActionError(null);
      invalidate();
      router.push("/crm/opportunities");
    },
    onError: handleError,
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreOpportunity(opportunityId, restoreReason, opportunity!.updatedAt),
    onSuccess: () => {
      setActionError(null);
      setRestoreDialogOpen(false);
      setRestoreReason("");
      invalidate();
    },
    onError: handleError,
  });

  const stageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.stages ?? []) as Array<{ id: string; name: string; pipelineId: string }>;
    if (!opportunity) return [];
    return rows.filter((row) => row.pipelineId === opportunity.pipelineId).map((row) => ({ value: row.id, label: row.name }));
  }, [optionsQuery.data, opportunity]);

  const stageProgress = useMemo(() => {
    // Open stages in order, then only the outcome this deal actually reached —
    // a lost deal never shows "Closed Won" as a step it passed through.
    const rows = (optionsQuery.data?.options?.stages ?? []) as Array<{ id: string; name: string; pipelineId: string; isWon?: boolean; isLost?: boolean }>;
    if (!opportunity) return [];
    return rows
      .filter((row) => row.pipelineId === opportunity.pipelineId)
      .filter((row) => !(row.isWon || row.isLost) || row.id === opportunity.stageId)
      .map((row) => ({ id: row.id, name: row.name }));
  }, [optionsQuery.data, opportunity]);

  // F026 — only reasons valid for the outcome being recorded (won, lost, or
  // configured for both); the server rejects any other with a 409.
  const targetOutcome = targetStage?.isWon ? "won" : targetStage?.isLost ? "lost" : null;
  const lostReasonOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.lostReasons ?? []) as Array<{ id: string; name: string; outcomeType?: string }>;
    return rows
      .filter((row) => !targetOutcome || row.outcomeType === targetOutcome || row.outcomeType === "both")
      .map((row) => ({ value: String(row.id), label: String(row.name) }));
  }, [optionsQuery.data, targetOutcome]);
  const outcomeReasonName = useMemo(() => {
    const reasonId = opportunity?.outcomeReasonId;
    if (!reasonId) return null;
    const row = (optionsQuery.data?.options?.lostReasons ?? []).find((reason) => String(reason.id) === reasonId);
    return row ? String(row.name) : "A reason that has since been retired";
  }, [optionsQuery.data, opportunity?.outcomeReasonId]);

  if (opportunityQuery.isLoading) return <LoadingState label="Loading opportunity" rows={3} />;
  if (opportunityQuery.isError) {
    if (opportunityQuery.error instanceof OpportunityApiError && opportunityQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Opportunity" />;
    }
    return <ErrorState title="Opportunity not found" action={{ label: "Back to Opportunities", onPress: () => router.push("/crm/opportunities") }} />;
  }
  if (!opportunity) return null;

  const isClosed = opportunity.status === "archived";

  return (
    <>
      <RecordDetailsPage
      header={{
        title: opportunity.name,
        status: <StatusBadge tone={statusTone[opportunity.status] ?? "neutral"}>{opportunity.status}</StatusBadge>,
        fields: [
          { label: "Account", value: opportunity.partyName || "No account" },
          { label: "Stage", value: opportunity.stageName || "" },
          { label: "Amount", value: opportunity.amount !== null ? formatMoney(opportunity.currencyCode, opportunity.amount) : "" },
          { label: "Probability", value: opportunity.probability !== null ? `${toNumber(opportunity.probability)}%` : "" },
          { label: "Expected close", value: opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "Not set" },
          { label: "Owner", value: opportunity.ownerName || "Unassigned" },
        ].filter((field) => field.value !== ""),
        primaryAction:
          canManage && isClosed ? (
            <Button variant="secondary" onPress={() => setRestoreDialogOpen(true)}>
              Restore opportunity
            </Button>
          ) : canManage ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/opportunities/${opportunityId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions:
          !isClosed ? (
            <>
              {canCreateQuotation && opportunity.partyId && (
                <Button
                  variant="secondary"
                  onPress={() => {
                    const params = new URLSearchParams({ customer: opportunity.partyId! });
                    if (opportunity.contactId) params.set("contact", opportunity.contactId);
                    params.set("opportunity", opportunityId);
                    params.set("opportunityName", opportunity.name);
                    router.push(`/sales/quotations/new?${params.toString()}`);
                  }}
                >
                  Convert to Quotation
                </Button>
              )}
              {canManage && (
                <MoreMenu
                  isBusy={archiveMutation.isPending}
                  items={[{ id: "archive", label: "Archive opportunity", danger: true, onAction: () => archiveMutation.mutate(), confirm: { title: "Archive this opportunity?", description: "It leaves your open pipeline and becomes read-only unless later restored. Its history is kept.", confirmLabel: "Archive" } }]}
                />
              )}
            </>
          ) : undefined,
      }}
      tabs={
        <Tabs>
          <TabList aria-label="Opportunity sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="contacts">Contacts</Tab>
            <Tab id="pipeline">Pipeline</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="communications">Communications</Tab>
            <Tab id="notes">Notes</Tab>
            <Tab id="attachments">Attachments</Tab>
            <Tab id="custom-fields">Custom Fields</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-6 py-4">
              {conflictMessage && <ConflictBanner message={conflictMessage} onReload={() => router.refresh()} />}
              {actionError && (
                <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                  {actionError}
                </p>
              )}
              <StageProgress stages={stageProgress} currentId={opportunity.stageId} />
              {opportunity.expectedCloseDate && opportunity.status === "open" && dueState(opportunity.expectedCloseDate) === "overdue" && (
                <p role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                  {`Expected close date passed: ${dueLabel(opportunity.expectedCloseDate)}. Update the date or move the deal.`}
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <PropertyList title="Deal" items={[
                  { label: "Next step", value: opportunity.nextStep },
                  { label: "Contact", value: opportunity.contactName },
                  { label: "Forecast category", value: humanize(opportunity.forecastCategory) },
                  { label: "Amount", value: opportunity.amount !== null ? formatMoney(opportunity.currencyCode, opportunity.amount) : null },
                  { label: "Description", value: opportunity.description, wide: true },
                ]} />
                <PropertyList title="Forecast" items={[
                  { label: "Probability", value: opportunity.probability !== null ? `${toNumber(opportunity.probability)}%` : null },
                  { label: "Expected revenue", value: opportunity.expectedRevenue !== null ? formatMoney(opportunity.currencyCode, opportunity.expectedRevenue) : null },
                  { label: "Expected close", value: formatDate(opportunity.expectedCloseDate) },
                  { label: "Actual close", value: opportunity.status !== "open" ? formatDate(opportunity.actualCloseDate) : null },
                  { label: opportunity.status === "won" ? "Won reason" : "Lost reason", value: opportunity.status === "won" || opportunity.status === "lost" ? outcomeReasonName ?? "No reason recorded" : null },
                  { label: opportunity.status === "won" ? "Why it was won" : "Why it was lost", value: opportunity.status === "won" || opportunity.status === "lost" ? opportunity.outcomeNotes || opportunity.lossNotes : null, wide: true },
                ]} />
              </div>
              {workspace.permissions.includes(SALES_PERMISSIONS.view) && <OpportunityQuotationsPanel opportunityId={opportunityId} />}
            </div>
          </TabPanel>
          <TabPanel id="contacts">
            <div className="py-4">
              <OpportunityContactRolesPanel opportunityId={opportunityId} partyId={opportunity.partyId} canManage={canManage} />
            </div>
          </TabPanel>

          <TabPanel id="pipeline">
            <div className="flex flex-col gap-6 py-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-text">Probability</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-lg font-semibold tabular-nums text-text">{opportunity.probability !== null ? `${toNumber(opportunity.probability)}%` : "Not set"}</span>
                  {(() => {
                    const latest = probabilityHistoryQuery.data?.rows[0];
                    const label = latest?.source ? probabilitySourceLabel[latest.source] : null;
                    return label ? <StatusBadge tone={latest?.source === "manual_override" ? "info" : "neutral"}>{label}</StatusBadge> : null;
                  })()}
                </div>
                {predictiveProbabilityQuery.data?.prediction && (
                  <p className="text-xs text-text-muted">
                    {`Model suggests ${Math.round(predictiveProbabilityQuery.data.prediction.predictedProbability)}% (from the latest forecast snapshot, ${formatDate(predictiveProbabilityQuery.data.prediction.capturedAt)}) — a reference point, not an automatic change.`}
                  </p>
                )}
              </div>

              {!isClosed && canManage && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Probability override</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <NumberField label="Probability %" size="compact" value={pendingProbability ?? toNumber(opportunity.probability)} onChange={setPendingProbability} minValue={0} maxValue={100} className="max-w-[160px]" />
                    {predictiveProbabilityQuery.data?.prediction && (
                      <Button variant="secondary" size="compact" onPress={() => setPendingProbability(Math.round(predictiveProbabilityQuery.data!.prediction!.predictedProbability))}>
                        {`Use model's ${Math.round(predictiveProbabilityQuery.data.prediction.predictedProbability)}%`}
                      </Button>
                    )}
                  </div>
                  <TextArea label="Reason for this change" description="Optional, but it's what shows up in the history below." rows={2} value={probabilityNote} onChange={setProbabilityNote} />
                  <Button variant="secondary" size="compact" className="w-fit" onPress={() => probabilityMutation.mutate()} isLoading={probabilityMutation.isPending}>
                    Update probability
                  </Button>

                  <p className="text-sm font-semibold text-text">Move to stage…</p>
                  <Select label="Destination stage" size="compact" options={stageOptions} selectedKey={pendingStageId} onSelectionChange={(key) => { setPendingStageId(String(key ?? "")); setOutcomeReasonId(""); }} className="max-w-[260px]" placeholder="Choose a stage" />
                  {pendingStageId && requiresOutcome && (
                    <>
                      <Select label={targetOutcome === "won" ? "Why was it won?" : "Why was it lost?"} size="compact" options={lostReasonOptions} selectedKey={outcomeReasonId} onSelectionChange={(key) => setOutcomeReasonId(String(key ?? ""))} className="max-w-[260px]" placeholder="Choose a reason" />
                      <TextArea label="Notes for the review" description="What happened, in a sentence or two. Kept with the close record." value={outcomeNotes} onChange={setOutcomeNotes} />
                    </>
                  )}
                  {pendingStageId && reopening && (
                    <TextArea
                      label="Why are you reopening it?"
                      description={`It was ${opportunity.status}${outcomeReasonName ? ` (${outcomeReasonName})` : ""}. That close stays in the history.`}
                      isRequired
                      value={reopenReason}
                      onChange={setReopenReason}
                    />
                  )}
                  {pendingStageId && (
                    <Button variant="primary" size="compact" className="w-fit" onPress={() => stageMutation.mutate()} isLoading={stageMutation.isPending} isDisabled={(requiresOutcome && !outcomeReasonId) || (reopening && !reopenReason.trim())}>
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Move
                    </Button>
                  )}
                </div>
              )}
              {isClosed && <p className="text-sm text-text-muted">This Opportunity is archived and read-only.</p>}

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-text">Probability history</p>
                {probabilityHistoryQuery.isLoading ? (
                  <p className="text-sm text-text-secondary">Loading history…</p>
                ) : (probabilityHistoryQuery.data?.rows.length ?? 0) === 0 ? (
                  <p className="text-sm text-text-muted">No probability changes recorded yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {probabilityHistoryQuery.data!.rows.map((entry) => (
                      <li key={entry.id} className="flex flex-col gap-0.5 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular-nums text-text">{`${toNumber(entry.fromProbability)}% → ${toNumber(entry.toProbability)}%`}</span>
                          {entry.source && <StatusBadge tone={entry.source === "manual_override" ? "info" : "neutral"}>{probabilitySourceLabel[entry.source] ?? entry.source}</StatusBadge>}
                          <span className="text-xs text-text-muted">{dateTimeFormatter.format(new Date(entry.changedAt))}</span>
                        </div>
                        <span className="text-xs text-text-secondary">{entry.changedByName ? `By ${entry.changedByName}` : "System"}{entry.note ? ` — ${entry.note}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </TabPanel>
          <TabPanel id="activity">
            <div className="py-4">
              <RecordTimelinePanel entityType="opportunity" entityId={opportunityId} />
            </div>
          </TabPanel>

          <TabPanel id="communications">
            <div className="py-4">
              <EmailHistoryPanel entityType="opportunity" entityId={opportunityId} />
            </div>
          </TabPanel>

          <TabPanel id="notes">
            <div className="py-4">
              <NotesPanel entityType="opportunity" entityId={opportunityId} />
            </div>
          </TabPanel>

          <TabPanel id="attachments">
            <div className="py-4">
              <CrmAttachmentPanel entityType="opportunity" entityId={opportunityId} />
            </div>
          </TabPanel>

          <TabPanel id="custom-fields">
            <div className="py-4">
              <CustomFieldsRuntimePanel entityType="opportunity" entityId={opportunityId} />
            </div>
          </TabPanel>
        </Tabs>
      }
    >
      <div />
      </RecordDetailsPage>
      <Dialog isOpen={restoreDialogOpen} onOpenChange={setRestoreDialogOpen} title="Restore this opportunity?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            It returns to the open pipeline in {opportunity.stageName || "its stage"}, or the pipeline&apos;s default stage if that one is no longer active. Its full history is kept.
          </p>
          <TextArea label="Reason for restoring" isRequired value={restoreReason} onChange={setRestoreReason} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setRestoreDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onPress={() => restoreMutation.mutate()} isLoading={restoreMutation.isPending} isDisabled={!restoreReason.trim()}>
              Restore
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
