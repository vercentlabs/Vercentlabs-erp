"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, History, Plus, Power, Timer } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  IconButton,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { humanize } from "@/features/crm/shared/human";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  archivePipeline,
  createPipeline,
  createStage,
  deactivateStageWithMigration,
  listPipelines,
  listStageHistory,
  listStages,
  listStageSlaPolicies,
  PipelineStagesApiError,
  reorderStages,
  saveStageSlaPolicy,
  setStageActive,
  type StageHistoryEntry,
  type StageSlaPolicy,
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

  // F010 gap-closure — crm_opportunity_stage_sla_policies previously had no
  // admin UI at all: an auto-seeded, probability-tiered default was frozen
  // at migration time with no way to view, edit, or deactivate it.
  const slaPoliciesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "pipeline-stages", "sla-policies", activePipelineId),
    queryFn: () => listStageSlaPolicies(activePipelineId),
    enabled: Boolean(activePipelineId) && canManage,
  });
  const slaPolicyByStageId = useMemo(() => {
    const map = new Map<string, StageSlaPolicy>();
    for (const row of slaPoliciesQuery.data?.rows ?? []) map.set(row.stageId, row);
    return map;
  }, [slaPoliciesQuery.data]);
  const [slaDialogStage, setSlaDialogStage] = useState<CrmSalesStage | null>(null);
  const [deactivateDialogStage, setDeactivateDialogStage] = useState<CrmSalesStage | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  function invalidatePipelines() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "pipelines") });
  }
  function invalidateStages() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "pipeline-stages", activePipelineId) });
  }
  function invalidateSlaPolicies() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "pipeline-stages", "sla-policies", activePipelineId) });
  }
  function handleError(err: unknown) {
    setError(err instanceof PipelineStagesApiError ? err.message : "This action could not be completed.");
    if (err instanceof PipelineStagesApiError && (err.code === "CRM_STALE_WRITE" || err.code === "CRM_SALES_STAGE_STALE_WRITE" || err.code === "CRM_SALES_STAGE_ORDER_CONFLICT")) {
      invalidateStages();
    }
  }

  const archivePipelineMutation = useMutation({ mutationFn: (pipeline: CrmPipeline) => archivePipeline(pipeline.id, pipeline.updatedAt), onSuccess: invalidatePipelines, onError: handleError });
  // Reactivation stays a plain toggle — only deactivation can be blocked by
  // open Opportunities, so only it needs the migration-aware dialog below.
  const reactivateStageMutation = useMutation({
    mutationFn: (stage: CrmSalesStage) => setStageActive(stage.id, true, stage.updatedAt),
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
          <p className="text-sm text-text-muted">No pipelines yet. A pipeline is the set of stages a deal moves through, from first contact to won or lost. Create one to start.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {pipelines.map((pipeline) => (
              <div key={pipeline.id} className="flex items-center justify-between gap-2 py-2">
                <button type="button" onClick={() => setPipelineId(pipeline.id)} className={`text-left text-sm ${pipeline.id === activePipelineId ? "font-semibold text-brand" : "text-text"}`}>
                  {pipeline.name}
                  {pipeline.isDefault && <StatusBadge tone="info">Default</StatusBadge>}
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
            <div><h2 className="text-sm font-semibold text-text">{`Stages in ${pipelines.find((p) => p.id === activePipelineId)?.name ?? "this pipeline"}`}</h2><p className="text-xs text-text-muted">Deals move left to right in this order. Use the arrows to reorder.</p></div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="compact" onPress={() => setHistoryDialogOpen(true)}>
                <History className="size-4" aria-hidden="true" />
                History
              </Button>
              <Button variant="secondary" size="compact" onPress={() => setStageDialogOpen(true)}>
                <Plus className="size-4" aria-hidden="true" />
                New stage
              </Button>
            </div>
          </div>
          {stages.length === 0 ? (
            <p className="text-sm text-text-muted">No stages yet. Add the steps a deal goes through, for example Qualification, Proposal, Negotiation, Won and Lost.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {stages.map((stage) => {
                const activeIndex = activeStages.findIndex((row) => row.id === stage.id);
                return (
                  <div key={stage.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-text">{stage.name}</span>
                      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-secondary">
                        <div className="flex gap-1"><dt className="text-text-muted">Type</dt><dd>{stage.stageType === "won" ? "Closed won" : stage.stageType === "lost" ? "Closed lost" : "Open"}</dd></div>
                        <div className="flex gap-1"><dt className="text-text-muted">Win probability</dt><dd>{`${Math.round(Number(stage.probability))}%`}</dd></div>
                        <div className="flex gap-1"><dt className="text-text-muted">Forecast as</dt><dd>{humanize(stage.forecastCategory)}</dd></div>
                        <div className="flex gap-1"><dt className="text-text-muted">Flagged stale after</dt><dd>{stage.staleAfterDays ? `${stage.staleAfterDays} days` : "Never"}</dd></div>
                        {(() => {
                          const policy = slaPolicyByStageId.get(stage.id);
                          const overrideActive = policy?.overrideStatus === "active" && policy.overrideDays != null;
                          return (
                            <div className="flex gap-1">
                              <dt className="text-text-muted">SLA override</dt>
                              <dd>{overrideActive ? `${policy!.overrideDays} days` : "Uses stale-after default"}</dd>
                            </div>
                          );
                        })()}
                        {typeof stage.openOpportunityCount === "number" && <div className="flex gap-1"><dt className="text-text-muted">Open deals</dt><dd>{stage.openOpportunityCount}</dd></div>}
                      </dl>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge tone={stage.status === "active" ? "success" : "neutral"}>{stage.status}</StatusBadge>
                      {stage.status === "active" && (
                        <>
                          <IconButton aria-label={`Edit SLA for ${stage.name}`} size="compact" variant="ghost" onPress={() => setSlaDialogStage(stage)}>
                            <Timer className="size-4" aria-hidden="true" />
                          </IconButton>
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
                        onPress={() => (stage.status === "active" ? setDeactivateDialogStage(stage) : reactivateStageMutation.mutate(stage))}
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

      <PipelineDialog isOpen={pipelineDialogOpen} onOpenChange={setPipelineDialogOpen} onCreated={(pipeline) => { invalidatePipelines(); setPipelineId(pipeline.id); }} onError={handleError} />
      {activePipelineId && (
        <StageDialog isOpen={stageDialogOpen} onOpenChange={setStageDialogOpen} pipelineId={activePipelineId} onCreated={invalidateStages} onError={handleError} />
      )}
      {slaDialogStage && (
        <SlaPolicyDialog
          stage={slaDialogStage}
          pipelineId={activePipelineId}
          policy={slaPolicyByStageId.get(slaDialogStage.id) ?? null}
          onOpenChange={(open) => { if (!open) setSlaDialogStage(null); }}
          onSaved={() => { setSlaDialogStage(null); invalidateSlaPolicies(); }}
          onError={handleError}
        />
      )}
      {deactivateDialogStage && (
        <DeactivateStageDialog
          stage={deactivateDialogStage}
          allStages={stages}
          onOpenChange={(open) => { if (!open) setDeactivateDialogStage(null); }}
          onDone={invalidateStages}
          onError={handleError}
        />
      )}
      {historyDialogOpen && (
        <StageHistoryDialog pipelineId={activePipelineId} onOpenChange={setHistoryDialogOpen} />
      )}
    </div>
  );
}

// F012 gap-closure — deactivateSalesStageWithMigration/enqueueOpportunity
// StageMigrationJob existed, tested, and (the job processor) wired to a
// real worker handler since this file was first written, but nothing ever
// called the enqueue entry point: an admin blocked by
// CRM_SALES_STAGE_OPEN_OPPORTUNITIES had no way to do what the error
// message told them to ("choose a replacement stage to migrate them").
// Mirrors LeadLifecycleSettingsScreen.tsx's DeactivateStageDialog exactly —
// same contract (deactivated:false means "migration enqueued, retry later"),
// same copy pattern, applied to Sales Stages instead of Lead Stages.
function DeactivateStageDialog({
  stage,
  allStages,
  onOpenChange,
  onDone,
  onError,
}: {
  stage: CrmSalesStage;
  allStages: CrmSalesStage[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}) {
  const [migrateToStageId, setMigrateToStageId] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  const otherStageOptions: SelectOption[] = allStages.filter((row) => row.id !== stage.id && row.status === "active").map((row) => ({ value: row.id, label: row.name }));

  const mutation = useMutation({
    mutationFn: () => deactivateStageWithMigration(stage.id, migrateToStageId || undefined, stage.updatedAt),
    onSuccess: (result) => {
      if (!result.deactivated) {
        setBlocked("Opportunities are being moved. The stage deactivates as soon as the last one has moved.");
        return;
      }
      onDone();
      onOpenChange(false);
      setBlocked(null);
      setMigrateToStageId("");
    },
    onError: (err) => {
      if (err instanceof PipelineStagesApiError && err.code === "CRM_SALES_STAGE_OPEN_OPPORTUNITIES") {
        setBlocked(err.message);
        return;
      }
      onError(err);
    },
  });

  return (
    <Dialog isOpen onOpenChange={onOpenChange} title={`Deactivate ${stage.name}`}>
      <div className="flex flex-col gap-4">
        {blocked && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {blocked}
          </p>
        )}
        <p className="text-sm text-text-secondary">Deactivating a stage removes it from the &quot;Move to stage&quot; options. If Opportunities are still on it, choose the stage they should move to. Nothing is deleted, and you can reactivate the stage later.</p>
        <Select label="Migrate open Opportunities to" options={[{ value: "", label: "Do not move Opportunities (blocked if any remain)" }, ...otherStageOptions]} selectedKey={migrateToStageId} onSelectionChange={(key) => setMigrateToStageId(String(key ?? ""))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            Deactivate stage
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// F012 gap-closure — tenant.crm_sales_stage_configuration_history has
// recorded every created/updated/reordered/deactivated/reactivated action
// with before/after snapshots since it shipped, with zero readers anywhere.
function StageHistoryDialog({ pipelineId, onOpenChange }: { pipelineId: string; onOpenChange: (open: boolean) => void }) {
  const workspace = useWorkspaceContext();
  const historyQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "pipeline-stages", "history", pipelineId),
    queryFn: () => listStageHistory(pipelineId),
  });
  const rows = historyQuery.data?.rows ?? [];

  const actionLabel: Record<StageHistoryEntry["action"], string> = {
    created: "Created",
    updated: "Updated",
    reordered: "Reordered",
    deactivated: "Deactivated",
    reactivated: "Reactivated",
  };

  return (
    <Dialog isOpen onOpenChange={onOpenChange} title="Stage configuration history" description="Every change to this pipeline's stages, in one place." size="lg">
      {historyQuery.isLoading ? (
        <p className="text-sm text-text-secondary">Loading history…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">No configuration changes recorded yet.</p>
      ) : (
        <div className="flex max-h-[420px] flex-col divide-y divide-border overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-col gap-0.5 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">{row.stageName}</span>
                <StatusBadge tone={row.action === "deactivated" ? "danger" : row.action === "reactivated" || row.action === "created" ? "success" : "neutral"}>{actionLabel[row.action]}</StatusBadge>
                <span className="text-xs text-text-muted">{new Date(row.changedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <span className="text-xs text-text-secondary">{row.changedByName ? `By ${row.changedByName}` : "System"}</span>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

// F010 gap-closure — the SLA policy table's own natural key is
// (pipeline, stage), so this dialog upserts by that key rather than
// requiring a policy id the caller may not have (a stage created after the
// original migration seed has no policy row at all).
function SlaPolicyDialog({
  stage,
  pipelineId,
  policy,
  onOpenChange,
  onSaved,
  onError,
}: {
  stage: CrmSalesStage;
  pipelineId: string;
  policy: StageSlaPolicy | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const overrideActive = policy?.overrideStatus === "active" && policy.overrideDays != null;
  const [enabled, setEnabled] = useState(overrideActive);
  const [maximumDays, setMaximumDays] = useState(overrideActive ? String(policy!.overrideDays) : "");

  const mutation = useMutation({
    mutationFn: () =>
      saveStageSlaPolicy(stage.id, {
        pipelineId,
        maximumDays: enabled ? Number(maximumDays) || null : policy?.overrideDays ?? null,
        status: enabled ? "active" : "inactive",
        expectedUpdatedAt: policy?.updatedAt ?? null,
      }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <Dialog isOpen onOpenChange={onOpenChange} title={`SLA for ${stage.name}`} description={`Overrides the stage's own "stale after" default with a value specific to this pipeline. Deals in this stage past the threshold are flagged stalled on the dashboard, the Opportunities list, and the Pipeline board.`} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">{`Without an override, this stage falls back to "Stale after" (${stage.staleAfterDays ? `${stage.staleAfterDays} days` : "never"}).`}</p>
        <Checkbox isSelected={enabled} onChange={setEnabled}>Set a pipeline-specific SLA for this stage</Checkbox>
        {enabled && <TextField label="Maximum days in stage" value={maximumDays} onChange={setMaximumDays} placeholder="e.g. 14" />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={enabled && (!maximumDays.trim() || Number(maximumDays) < 1)}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
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
