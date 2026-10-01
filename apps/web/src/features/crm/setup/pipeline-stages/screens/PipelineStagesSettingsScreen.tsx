"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  History,
  Plus,
  Power,
  Timer,
} from "lucide-react";
import {
  Button,
  IconButton,
  PermissionState,
  StatusBadge,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { humanize } from "@/shared/format/human";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  archivePipeline,
  listPipelines,
  listStages,
  listStageSlaPolicies,
  PipelineStagesApiError,
  reorderStages,
  setStageActive,
  type StageSlaPolicy,
} from "../api/pipeline-stages-api";
import { type CrmPipeline, type CrmSalesStage } from "../types";
import { DeactivateStageDialog } from "../components/DeactivateStageDialog";
import { StageHistoryDialog } from "../components/StageHistoryDialog";
import { SlaPolicyDialog } from "../components/SlaPolicyDialog";
import { PipelineDialog } from "../components/PipelineDialog";
import { StageDialog } from "../components/StageDialog";

// F012 Sales Stages — pipelines reuse the generic resource boundary;
// stages go through the dedicated sales-stage-operations.js module
// (governed sequence/terminal-stage/history rules, not re-derived here).
export function PipelineStagesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(
    CRM_PERMISSIONS.settingsManage,
  );

  const [pipelineId, setPipelineId] = useState("");
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pipelinesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "pipelines"),
    queryFn: listPipelines,
  });
  const pipelines = pipelinesQuery.data?.rows ?? [];
  const activePipelineId = pipelineId || pipelines[0]?.id || "";

  const stagesQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "pipeline-stages",
      activePipelineId,
    ),
    queryFn: () => listStages(activePipelineId),
    enabled: Boolean(activePipelineId),
  });
  const stages = useMemo(
    () =>
      [...(stagesQuery.data?.rows ?? [])].sort(
        (a, b) => a.sequence - b.sequence,
      ),
    [stagesQuery.data],
  );
  const activeStages = useMemo(
    () => stages.filter((stage) => stage.status === "active"),
    [stages],
  );

  // F010 gap-closure — crm_opportunity_stage_sla_policies previously had no
  // admin UI at all: an auto-seeded, probability-tiered default was frozen
  // at migration time with no way to view, edit, or deactivate it.
  const slaPoliciesQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "pipeline-stages",
      "sla-policies",
      activePipelineId,
    ),
    queryFn: () => listStageSlaPolicies(activePipelineId),
    enabled: Boolean(activePipelineId) && canManage,
  });
  const slaPolicyByStageId = useMemo(() => {
    const map = new Map<string, StageSlaPolicy>();
    for (const row of slaPoliciesQuery.data?.rows ?? [])
      map.set(row.stageId, row);
    return map;
  }, [slaPoliciesQuery.data]);
  const [slaDialogStage, setSlaDialogStage] = useState<CrmSalesStage | null>(
    null,
  );
  const [deactivateDialogStage, setDeactivateDialogStage] =
    useState<CrmSalesStage | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  function invalidatePipelines() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "pipelines"),
    });
  }
  function invalidateStages() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(
        workspace,
        "crm",
        "pipeline-stages",
        activePipelineId,
      ),
    });
  }
  function invalidateSlaPolicies() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(
        workspace,
        "crm",
        "pipeline-stages",
        "sla-policies",
        activePipelineId,
      ),
    });
  }
  function handleError(err: unknown) {
    setError(
      err instanceof PipelineStagesApiError
        ? err.message
        : "This action could not be completed.",
    );
    if (
      err instanceof PipelineStagesApiError &&
      (err.code === "CRM_STALE_WRITE" ||
        err.code === "CRM_SALES_STAGE_STALE_WRITE" ||
        err.code === "CRM_SALES_STAGE_ORDER_CONFLICT")
    ) {
      invalidateStages();
    }
  }

  const archivePipelineMutation = useMutation({
    mutationFn: (pipeline: CrmPipeline) =>
      archivePipeline(pipeline.id, pipeline.updatedAt),
    onSuccess: invalidatePipelines,
    onError: handleError,
  });
  // Reactivation stays a plain toggle — only deactivation can be blocked by
  // open Opportunities, so only it needs the migration-aware dialog below.
  const reactivateStageMutation = useMutation({
    mutationFn: (stage: CrmSalesStage) =>
      setStageActive(stage.id, true, stage.updatedAt),
    onSuccess: () => {
      setError(null);
      invalidateStages();
    },
    onError: handleError,
  });
  const reorderMutation = useMutation({
    mutationFn: (entries: Array<{ id: string; expectedUpdatedAt: string }>) =>
      reorderStages(activePipelineId, entries),
    onSuccess: () => {
      setError(null);
      invalidateStages();
    },
    onError: handleError,
  });

  function moveStage(stage: CrmSalesStage, direction: -1 | 1) {
    const index = activeStages.findIndex((row) => row.id === stage.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= activeStages.length)
      return;
    const reordered = [...activeStages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    reorderMutation.mutate(
      reordered.map((row) => ({
        id: row.id,
        expectedUpdatedAt: row.updatedAt,
      })),
    );
  }

  if (!canManage)
    return (
      <PermissionState
        title="You don't have access to CRM Setup"
        description="Ask an administrator to grant crm.settings.manage."
      />
    );

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Pipelines</h2>
          <Button
            variant="secondary"
            size="compact"
            onPress={() => setPipelineDialogOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New pipeline
          </Button>
        </div>
        {pipelines.length === 0 ? (
          <p className="text-sm text-text-muted">
            No pipelines yet. A pipeline is the set of stages a deal moves
            through, from first contact to won or lost. Create one to start.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {pipelines.map((pipeline) => (
              <div
                key={pipeline.id}
                className="flex items-center justify-between gap-2 py-2"
              >
                <button
                  type="button"
                  onClick={() => setPipelineId(pipeline.id)}
                  className={`text-left text-sm ${pipeline.id === activePipelineId ? "font-semibold text-brand" : "text-text"}`}
                >
                  {pipeline.name}
                  {pipeline.isDefault && (
                    <StatusBadge tone="info">Default</StatusBadge>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={pipeline.status === "active" ? "success" : "neutral"}
                  >
                    {pipeline.status}
                  </StatusBadge>
                  {pipeline.status === "active" && (
                    <IconButton
                      aria-label={`Archive ${pipeline.name}`}
                      size="compact"
                      variant="danger"
                      onPress={() => archivePipelineMutation.mutate(pipeline)}
                    >
                      <Archive className="size-4" aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activePipelineId && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text">{`Stages in ${pipelines.find((p) => p.id === activePipelineId)?.name ?? "this pipeline"}`}</h2>
              <p className="text-xs text-text-muted">
                Deals move left to right in this order. Use the arrows to
                reorder.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="compact"
                onPress={() => setHistoryDialogOpen(true)}
              >
                <History className="size-4" aria-hidden="true" />
                History
              </Button>
              <Button
                variant="secondary"
                size="compact"
                onPress={() => setStageDialogOpen(true)}
              >
                <Plus className="size-4" aria-hidden="true" />
                New stage
              </Button>
            </div>
          </div>
          {stages.length === 0 ? (
            <p className="text-sm text-text-muted">
              No stages yet. Add the steps a deal goes through, for example
              Qualification, Proposal, Negotiation, Won and Lost.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {stages.map((stage) => {
                const activeIndex = activeStages.findIndex(
                  (row) => row.id === stage.id,
                );
                return (
                  <div
                    key={stage.id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-text">
                        {stage.name}
                      </span>
                      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-secondary">
                        <div className="flex gap-1">
                          <dt className="text-text-muted">Type</dt>
                          <dd>
                            {stage.stageType === "won"
                              ? "Closed won"
                              : stage.stageType === "lost"
                                ? "Closed lost"
                                : "Open"}
                          </dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className="text-text-muted">Win probability</dt>
                          <dd>{`${Math.round(Number(stage.probability))}%`}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className="text-text-muted">Forecast as</dt>
                          <dd>{humanize(stage.forecastCategory)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className="text-text-muted">
                            Flagged stale after
                          </dt>
                          <dd>
                            {stage.staleAfterDays
                              ? `${stage.staleAfterDays} days`
                              : "Never"}
                          </dd>
                        </div>
                        {(() => {
                          const policy = slaPolicyByStageId.get(stage.id);
                          const overrideActive =
                            policy?.overrideStatus === "active" &&
                            policy.overrideDays != null;
                          return (
                            <div className="flex gap-1">
                              <dt className="text-text-muted">SLA override</dt>
                              <dd>
                                {overrideActive
                                  ? `${policy!.overrideDays} days`
                                  : "Uses stale-after default"}
                              </dd>
                            </div>
                          );
                        })()}
                        {typeof stage.openOpportunityCount === "number" && (
                          <div className="flex gap-1">
                            <dt className="text-text-muted">Open deals</dt>
                            <dd>{stage.openOpportunityCount}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge
                        tone={stage.status === "active" ? "success" : "neutral"}
                      >
                        {stage.status}
                      </StatusBadge>
                      {stage.status === "active" && (
                        <>
                          <IconButton
                            aria-label={`Edit SLA for ${stage.name}`}
                            size="compact"
                            variant="ghost"
                            onPress={() => setSlaDialogStage(stage)}
                          >
                            <Timer className="size-4" aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            aria-label={`Move ${stage.name} up`}
                            size="compact"
                            variant="ghost"
                            isDisabled={
                              activeIndex <= 0 || reorderMutation.isPending
                            }
                            onPress={() => moveStage(stage, -1)}
                          >
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            aria-label={`Move ${stage.name} down`}
                            size="compact"
                            variant="ghost"
                            isDisabled={
                              activeIndex < 0 ||
                              activeIndex >= activeStages.length - 1 ||
                              reorderMutation.isPending
                            }
                            onPress={() => moveStage(stage, 1)}
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        aria-label={
                          stage.status === "active"
                            ? `Deactivate ${stage.name}`
                            : `Activate ${stage.name}`
                        }
                        size="compact"
                        variant={stage.status === "active" ? "danger" : "ghost"}
                        onPress={() =>
                          stage.status === "active"
                            ? setDeactivateDialogStage(stage)
                            : reactivateStageMutation.mutate(stage)
                        }
                        isDisabled={reactivateStageMutation.isPending}
                      >
                        <Power className="size-4" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <PipelineDialog
        isOpen={pipelineDialogOpen}
        onOpenChange={setPipelineDialogOpen}
        onCreated={(pipeline) => {
          invalidatePipelines();
          setPipelineId(pipeline.id);
        }}
        onError={handleError}
      />
      {activePipelineId && (
        <StageDialog
          isOpen={stageDialogOpen}
          onOpenChange={setStageDialogOpen}
          pipelineId={activePipelineId}
          onCreated={invalidateStages}
          onError={handleError}
        />
      )}
      {slaDialogStage && (
        <SlaPolicyDialog
          stage={slaDialogStage}
          pipelineId={activePipelineId}
          policy={slaPolicyByStageId.get(slaDialogStage.id) ?? null}
          onOpenChange={(open) => {
            if (!open) setSlaDialogStage(null);
          }}
          onSaved={() => {
            setSlaDialogStage(null);
            invalidateSlaPolicies();
          }}
          onError={handleError}
        />
      )}
      {deactivateDialogStage && (
        <DeactivateStageDialog
          stage={deactivateDialogStage}
          allStages={stages}
          onOpenChange={(open) => {
            if (!open) setDeactivateDialogStage(null);
          }}
          onDone={invalidateStages}
          onError={handleError}
        />
      )}
      {historyDialogOpen && (
        <StageHistoryDialog
          pipelineId={activePipelineId}
          onOpenChange={setHistoryDialogOpen}
        />
      )}
    </div>
  );
}
