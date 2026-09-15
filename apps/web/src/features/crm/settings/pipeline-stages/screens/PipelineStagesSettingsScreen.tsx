"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, Plus, Power } from "lucide-react";
import {
  Button,
  Dialog,
  IconButton,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  archivePipeline,
  createPipeline,
  createStage,
  listPipelines,
  listStages,
  PipelineStagesApiError,
  reorderStages,
  setStageActive,
} from "../api/pipeline-stages-api";
import { FORECAST_CATEGORIES, type CrmPipeline, type CrmSalesStage, type CrmStageType } from "../types";

const STAGE_TYPE_OPTIONS: SelectOption[] = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const FORECAST_CATEGORY_OPTIONS: SelectOption[] = FORECAST_CATEGORIES.map((value) => ({
  value,
  label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));

// F012 Sales Stages — pipelines reuse the generic resource boundary;
// stages go through the dedicated sales-stage-operations.js module
// (governed sequence/terminal-stage/history rules, not re-derived here).
export function PipelineStagesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [pipelineId, setPipelineId] = useState("");
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pipelinesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "pipelines"), queryFn: listPipelines });
  const pipelines = pipelinesQuery.data?.rows ?? [];
  const activePipelineId = pipelineId || pipelines[0]?.id || "";

  const stagesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "pipeline-stages", activePipelineId),
    queryFn: () => listStages(activePipelineId),
    enabled: Boolean(activePipelineId),
  });
  const stages = useMemo(() => [...(stagesQuery.data?.rows ?? [])].sort((a, b) => a.sequence - b.sequence), [stagesQuery.data]);
  const activeStages = useMemo(() => stages.filter((stage) => stage.status === "active"), [stages]);

  function invalidatePipelines() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "pipelines") });
  }
  function invalidateStages() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "pipeline-stages", activePipelineId) });
  }
  function handleError(err: unknown) {
    setError(err instanceof PipelineStagesApiError ? err.message : "This action could not be completed.");
    if (err instanceof PipelineStagesApiError && (err.code === "CRM_STALE_WRITE" || err.code === "CRM_SALES_STAGE_STALE_WRITE" || err.code === "CRM_SALES_STAGE_ORDER_CONFLICT")) {
      invalidateStages();
    }
  }

  const archivePipelineMutation = useMutation({ mutationFn: (pipeline: CrmPipeline) => archivePipeline(pipeline.id, pipeline.updatedAt), onSuccess: invalidatePipelines, onError: handleError });
  const toggleStageActiveMutation = useMutation({
    mutationFn: (stage: CrmSalesStage) => setStageActive(stage.id, stage.status !== "active", stage.updatedAt),
    onSuccess: () => {
      setError(null);
      invalidateStages();
    },
    onError: handleError,
  });
  const reorderMutation = useMutation({
    mutationFn: (entries: Array<{ id: string; expectedUpdatedAt: string }>) => reorderStages(activePipelineId, entries),
    onSuccess: () => {
      setError(null);
      invalidateStages();
    },
    onError: handleError,
  });

  function moveStage(stage: CrmSalesStage, direction: -1 | 1) {
    const index = activeStages.findIndex((row) => row.id === stage.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= activeStages.length) return;
    const reordered = [...activeStages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    reorderMutation.mutate(reordered.map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt })));
  }

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Pipelines</h2>
          <Button variant="secondary" size="compact" onPress={() => setPipelineDialogOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New pipeline
          </Button>
        </div>
        {pipelines.length === 0 ? (
          <p className="text-sm text-text-muted">No pipelines yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {pipelines.map((pipeline) => (
              <div key={pipeline.id} className="flex items-center justify-between gap-2 py-2">
                <button type="button" onClick={() => setPipelineId(pipeline.id)} className={`text-left text-sm ${pipeline.id === activePipelineId ? "font-semibold text-brand" : "text-text"}`}>
                  {pipeline.name}
                  {pipeline.isDefault && <span className="ml-1.5 text-xs text-text-muted">(default)</span>}
                </button>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={pipeline.status === "active" ? "success" : "neutral"}>{pipeline.status}</StatusBadge>
                  {pipeline.status === "active" && (
                    <IconButton aria-label={`Archive ${pipeline.name}`} size="compact" variant="danger" onPress={() => archivePipelineMutation.mutate(pipeline)}>
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
            <h2 className="text-sm font-semibold text-text">Stages — {pipelines.find((p) => p.id === activePipelineId)?.name}</h2>
            <Button variant="secondary" size="compact" onPress={() => setStageDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New stage
            </Button>
          </div>
          {stages.length === 0 ? (
            <p className="text-sm text-text-muted">No stages yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {stages.map((stage) => {
                const activeIndex = activeStages.findIndex((row) => row.id === stage.id);
                return (
                  <div key={stage.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-text">{stage.name}</span>
                      <span className="text-xs text-text-muted">
                        {stage.stageType} · {stage.probability}% · {stage.forecastCategory}
                        {stage.staleAfterDays ? ` · stale after ${stage.staleAfterDays}d` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge tone={stage.status === "active" ? "success" : "neutral"}>{stage.status}</StatusBadge>
                      {stage.status === "active" && (
                        <>
                          <IconButton aria-label={`Move ${stage.name} up`} size="compact" variant="ghost" isDisabled={activeIndex <= 0 || reorderMutation.isPending} onPress={() => moveStage(stage, -1)}>
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </IconButton>
                          <IconButton aria-label={`Move ${stage.name} down`} size="compact" variant="ghost" isDisabled={activeIndex < 0 || activeIndex >= activeStages.length - 1 || reorderMutation.isPending} onPress={() => moveStage(stage, 1)}>
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        aria-label={stage.status === "active" ? `Deactivate ${stage.name}` : `Activate ${stage.name}`}
                        size="compact"
                        variant={stage.status === "active" ? "danger" : "ghost"}
                        onPress={() => toggleStageActiveMutation.mutate(stage)}
                        isDisabled={toggleStageActiveMutation.isPending}
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

      <PipelineDialog isOpen={pipelineDialogOpen} onOpenChange={setPipelineDialogOpen} onCreated={(pipeline) => { invalidatePipelines(); setPipelineId(pipeline.id); }} onError={handleError} />
      {activePipelineId && (
        <StageDialog isOpen={stageDialogOpen} onOpenChange={setStageDialogOpen} pipelineId={activePipelineId} onCreated={invalidateStages} onError={handleError} />
      )}
    </div>
  );
}

function PipelineDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (pipeline: CrmPipeline) => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const mutation = useMutation({
    mutationFn: () => createPipeline({ name, code }),
    onSuccess: ({ record }) => {
      onCreated(record);
      onOpenChange(false);
      setName("");
      setCode("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New pipeline">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !code.trim()}>
            Create pipeline
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function StageDialog({
  isOpen,
  onOpenChange,
  pipelineId,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [stageType, setStageType] = useState<CrmStageType>("open");
  const [probability, setProbability] = useState("0");
  const [forecastCategory, setForecastCategory] = useState("pipeline");
  const [staleAfterDays, setStaleAfterDays] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createStage({
        pipelineId,
        name,
        stageType,
        probability: Number(probability) || 0,
        forecastCategory,
        staleAfterDays: staleAfterDays ? Number(staleAfterDays) : null,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setStageType("open");
      setProbability("0");
      setForecastCategory("pipeline");
      setStaleAfterDays("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New stage">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Type" options={STAGE_TYPE_OPTIONS} selectedKey={stageType} onSelectionChange={(key) => setStageType(String(key ?? "open") as CrmStageType)} />
        {stageType === "open" && (
          <>
            <TextField label="Probability (%)" value={probability} onChange={setProbability} />
            <Select label="Forecast category" options={FORECAST_CATEGORY_OPTIONS} selectedKey={forecastCategory} onSelectionChange={(key) => setForecastCategory(String(key ?? "pipeline"))} />
            <TextField label="Stale after (days)" placeholder="Optional" value={staleAfterDays} onChange={setStaleAfterDays} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Create stage
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
