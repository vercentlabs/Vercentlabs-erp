"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil } from "lucide-react";
import {
  Button,
  ConflictBanner,
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
  Timeline,
  type SelectOption,
  type TimelineEntry,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { toNumber } from "@/features/crm/shared/format";
import { dueLabel, dueState, formatDate, formatMoney, humanize } from "@/features/crm/shared/human";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { StageProgress } from "@/features/crm/shared/ui/StageProgress";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { CustomFieldsRuntimePanel } from "@/features/crm/shared/CustomFieldsRuntimePanel";
import { archiveOpportunity, getOpportunity, getOpportunityTimeline, moveOpportunityStage, OpportunityApiError, updateOpportunityProbability } from "../api/opportunities-api";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  open: "info",
  won: "success",
  lost: "danger",
  archived: "neutral",
};

const timelineTone: Record<string, TimelineEntry["tone"]> = { activity: "info", communication: "neutral", note: "neutral", attachment: "neutral" };
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function OpportunityDetailScreen({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);

  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = useState("");
  const [pendingProbability, setPendingProbability] = useState<number | null>(null);
  const [outcomeReasonId, setOutcomeReasonId] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");

  const opportunityQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId),
    queryFn: () => getOpportunity(opportunityId),
  });
  const opportunity = opportunityQuery.data?.record;

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });

  const timelineQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", opportunityId, "timeline"),
    queryFn: () => getOpportunityTimeline(opportunityId),
    enabled: Boolean(opportunity),
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

  const stageMutation = useMutation({
    mutationFn: () =>
      moveOpportunityStage(opportunityId, {
        stageId: pendingStageId,
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
      invalidate();
    },
    onError: handleError,
  });

  const probabilityMutation = useMutation({
    mutationFn: () => updateOpportunityProbability(opportunityId, { probability: pendingProbability ?? 0, expectedUpdatedAt: opportunity!.updatedAt, expectedProbability: opportunity!.probability === null ? null : toNumber(opportunity!.probability) }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
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

  const stageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.stages ?? []) as Array<{ id: string; name: string; pipelineId: string }>;
    if (!opportunity) return [];
    return rows.filter((row) => row.pipelineId === opportunity.pipelineId).map((row) => ({ value: row.id, label: row.name }));
  }, [optionsQuery.data, opportunity]);

  const stageProgress = useMemo(() => {
    const rows = (optionsQuery.data?.options?.stages ?? []) as Array<{ id: string; name: string; pipelineId: string }>;
    return opportunity ? rows.filter((row) => row.pipelineId === opportunity.pipelineId).map((row) => ({ id: row.id, name: row.name })) : [];
  }, [optionsQuery.data, opportunity]);

  const lostReasonOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.lostReasons ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.name) }));
  }, [optionsQuery.data]);

  const timelineEntries: TimelineEntry[] = useMemo(() => {
    const rows = timelineQuery.data?.page.rows ?? [];
    return rows.map((row) => ({
      id: row.id,
      tone: timelineTone[row.kind] ?? "neutral",
      title: `${humanize(row.kind)}${row.subtype ? ` · ${humanize(row.subtype)}` : ""}${row.title ? `: ${row.title}` : ""}`,
      description: row.status ? `Status: ${humanize(row.status)}` : undefined,
      timestamp: dateTimeFormatter.format(new Date(row.occurredAt)),
    }));
  }, [timelineQuery.data]);

  if (opportunityQuery.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading opportunity…</p>;
  if (opportunityQuery.isError) {
    if (opportunityQuery.error instanceof OpportunityApiError && opportunityQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Opportunity" />;
    }
    return <ErrorState title="Opportunity not found" action={{ label: "Back to Opportunities", onPress: () => router.push("/crm/opportunities") }} />;
  }
  if (!opportunity) return null;

  const isClosed = opportunity.status === "archived";

  return (
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
          canManage && !isClosed ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/opportunities/${opportunityId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions:
          canManage && !isClosed ? (
            <MoreMenu
              isBusy={archiveMutation.isPending}
              items={[{ id: "archive", label: "Archive opportunity", danger: true, onAction: () => archiveMutation.mutate(), confirm: { title: "Archive this opportunity?", description: "It leaves your open pipeline and becomes read-only. Its history is kept.", confirmLabel: "Archive" } }]}
            />
          ) : undefined,
      }}
      tabs={
        <Tabs>
          <TabList aria-label="Opportunity sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="pipeline">Pipeline</Tab>
            <Tab id="activity">Activity</Tab>
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
                  { label: "Loss notes", value: opportunity.status === "lost" ? opportunity.lossNotes || opportunity.outcomeNotes : null, wide: true },
                ]} />
              </div>
            </div>
          </TabPanel>
          <TabPanel id="pipeline">
            <div className="flex flex-col gap-6 py-4">
              {!isClosed && canManage && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Probability override</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <NumberField label="Probability %" size="compact" value={pendingProbability ?? toNumber(opportunity.probability)} onChange={setPendingProbability} minValue={0} maxValue={100} className="max-w-[160px]" />
                    <Button variant="secondary" size="compact" onPress={() => probabilityMutation.mutate()} isLoading={probabilityMutation.isPending}>
                      Update probability
                    </Button>
                  </div>

                  <p className="text-sm font-semibold text-text">Move to stage…</p>
                  <Select label="Destination stage" size="compact" options={stageOptions} selectedKey={pendingStageId} onSelectionChange={(key) => setPendingStageId(String(key ?? ""))} className="max-w-[260px]" placeholder="Choose a stage" />
                  {pendingStageId && requiresOutcome && (
                    <>
                      <Select label="Outcome reason" size="compact" options={lostReasonOptions} selectedKey={outcomeReasonId} onSelectionChange={(key) => setOutcomeReasonId(String(key ?? ""))} className="max-w-[260px]" placeholder="Choose a reason" />
                      <TextArea label="Outcome notes" value={outcomeNotes} onChange={setOutcomeNotes} />
                    </>
                  )}
                  {pendingStageId && (
                    <Button variant="primary" size="compact" className="w-fit" onPress={() => stageMutation.mutate()} isLoading={stageMutation.isPending} isDisabled={requiresOutcome && !outcomeReasonId}>
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Move
                    </Button>
                  )}
                </div>
              )}
              {isClosed && <p className="text-sm text-text-muted">This Opportunity is archived and read-only.</p>}
            </div>
          </TabPanel>
          <TabPanel id="activity">
            <div className="py-4">
              {timelineQuery.isLoading ? <p className="text-sm text-text-secondary">Loading activity…</p> : <Timeline entries={timelineEntries} emptyMessage="No activity recorded yet." />}
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
  );
}
