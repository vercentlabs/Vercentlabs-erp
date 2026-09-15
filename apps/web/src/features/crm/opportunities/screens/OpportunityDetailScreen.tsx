"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Pencil } from "lucide-react";
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

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

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
    mutationFn: () => updateOpportunityProbability(opportunityId, { probability: pendingProbability ?? 0, expectedUpdatedAt: opportunity!.updatedAt, expectedProbability: opportunity!.probability }),
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

  const lostReasonOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.lostReasons ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.name) }));
  }, [optionsQuery.data]);

  const timelineEntries: TimelineEntry[] = useMemo(() => {
    const rows = timelineQuery.data?.page.rows ?? [];
    return rows.map((row) => ({
      id: row.id,
      tone: timelineTone[row.kind] ?? "neutral",
      title: `${row.kind}${row.subtype ? ` · ${row.subtype}` : ""}${row.title ? `: ${row.title}` : ""}`,
      description: row.status ? `Status: ${row.status}` : undefined,
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
          { label: "Account", value: opportunity.partyName || "—" },
          { label: "Stage", value: opportunity.stageName || "—" },
          { label: "Amount", value: opportunity.amount !== null ? `${opportunity.currencyCode || ""} ${opportunity.amount}`.trim() : "—" },
          { label: "Owner", value: opportunity.ownerName || "Unassigned" },
        ],
        primaryAction:
          canManage && !isClosed ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/opportunities/${opportunityId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions:
          canManage && !isClosed ? (
            <Button variant="danger" onPress={() => archiveMutation.mutate()} isLoading={archiveMutation.isPending}>
              <Archive className="size-4" aria-hidden="true" />
              Archive
            </Button>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Description" value={opportunity.description} />
                <Field label="Next step" value={opportunity.nextStep} />
                <Field label="Contact" value={opportunity.contactName} />
                <Field label="Forecast category" value={opportunity.forecastCategory} />
                <Field label="Expected revenue" value={opportunity.expectedRevenue} />
                <Field label="Expected close" value={opportunity.expectedCloseDate} />
                {opportunity.status !== "open" && <Field label="Actual close" value={opportunity.actualCloseDate} />}
                {opportunity.status === "lost" && <Field label="Loss notes" value={opportunity.lossNotes || opportunity.outcomeNotes} />}
              </div>
            </div>
          </TabPanel>
          <TabPanel id="pipeline">
            <div className="flex flex-col gap-6 py-4">
              {!isClosed && canManage && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Probability override</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <NumberField label="Probability %" size="compact" value={pendingProbability ?? opportunity.probability ?? 0} onChange={setPendingProbability} minValue={0} maxValue={100} className="max-w-[160px]" />
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
