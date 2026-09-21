"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { AlertDialog, Button, Checkbox, Dialog, ErrorState, PermissionState, Select, StatusBadge, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { formatMinutes, humanize } from "@/features/crm/shared/human";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  addLeadStageTransition,
  applyLeadStageTemplateUpgrade,
  createLeadStage,
  createLeadStageTransitionReason,
  deactivateLeadStage,
  LeadLifecycleApiError,
  listLeadStages,
  listLeadStageTransitionReasons,
  listLeadStageTransitions,
  previewLeadStageTemplateUpgrade,
  reactivateLeadStage,
  removeLeadStageTransition,
  setLeadStageTransitionReasonActive,
  updateLeadStage,
  type LeadStageTemplatePreview,
} from "../api/lead-lifecycle-api";
import type { LeadStage, TransitionReasonScope } from "../types";

// F007 Tranche I (Stage A) — the REAL Lead lifecycle catalog/transition-
// graph setup UI. stage-catalog.js/transition-graph.js/stage-migration.js
// already governed the SAME crm_lead_stages/crm_lead_stage_transitions the
// Lead 360's own "Move to stage" UI already reads (getLeadTransitionGraph)
// — zero setup UI existed before this pass, confirmed by grep.
export function LeadLifecycleSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-8">
      <p className="rounded-[var(--radius-control)] border border-border-strong bg-surface-muted px-3 py-2 text-sm text-text-secondary">
        Lead stage tracks where a prospect is in your engagement process. Qualification and conversion are tracked separately — a Lead&apos;s stage,
        its qualification decision and whether it has converted or been archived are three independent facts, never combined into one status.
      </p>
      <RecommendedTemplateSection />
      <StagesSection />
      <TransitionsSection />
      <ReasonsSection />
    </div>
  );
}

// F007: "Apply recommended Vercentlabs 5-stage template" — only meaningful
// once a customization exists to diff against (an untouched organization is
// already auto-upgraded by ensureDefaultLeadStages, and re-checking here
// would just show an empty preview every time). Purely additive: creates
// only what's missing, never renames/removes an existing stage or edge.
function RecommendedTemplateSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<LeadStageTemplatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const previewMutation = useMutation({
    mutationFn: previewLeadStageTemplateUpgrade,
    onSuccess: (result) => {
      setPreview(result);
      setPreviewOpen(true);
      setError(null);
      setApplied(false);
    },
    onError: (err) => setError(err instanceof LeadLifecycleApiError ? err.message : "The recommended template could not be checked."),
  });
  const applyMutation = useMutation({
    mutationFn: applyLeadStageTemplateUpgrade,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-stages") });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions") });
      setApplied(true);
    },
    onError: (err) => setError(err instanceof LeadLifecycleApiError ? err.message : "The recommended template could not be applied."),
  });

  const hasChanges = Boolean(preview && (preview.stagesToCreate.length > 0 || preview.edgesToAdd.length > 0));

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text">Vercentlabs standard 5-stage template</h2>
          <p className="text-sm text-text-secondary">
            New / Attempting Contact / Connected / Working &amp; Discovery / Nurturing. If your stages have been customized, check what&apos;s missing
            and add it without touching anything you&apos;ve already configured.
          </p>
        </div>
        <Button variant="secondary" onPress={() => previewMutation.mutate()} isLoading={previewMutation.isPending}>
          Check recommended template
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Dialog
        isOpen={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setApplied(false);
        }}
        title="Apply recommended Vercentlabs 5-stage template"
        size="lg"
      >
        <div className="flex flex-col gap-4">
          {applied ? (
            <p role="status" className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm text-success">
              Applied. {preview?.stagesToCreate.length ?? 0} stage(s) and {preview?.edgesToAdd.length ?? 0} transition(s) were added.
            </p>
          ) : !hasChanges ? (
            <p className="text-sm text-text-secondary">Your Lead lifecycle already includes everything in the recommended template. Nothing to add.</p>
          ) : (
            <>
              {preview!.stagesToCreate.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-text">Stages to create</p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-text-secondary">
                    {preview!.stagesToCreate.map((stage) => (
                      <li key={stage.code}>
                        <span className="font-medium text-text">{stage.name}</span> — {stage.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview!.edgesToAdd.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-text">Transitions to add</p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-text-secondary">
                    {preview!.edgesToAdd.map((edge) => (
                      <li key={`${edge.fromCode}-${edge.toCode}`}>
                        {humanize(edge.fromCode)} to {humanize(edge.toCode)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-text-secondary">
                {preview!.affectedLeadCount} active Lead(s) in your pipeline today. This is purely additive — no existing stage, label or transition is
                changed or removed, and no Lead is moved.
              </p>
              {preview!.conflicts.length > 0 && (
                <div className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2">
                  <p className="text-sm font-medium text-warning">Resolve before applying</p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-warning">
                    {preview!.conflicts.map((conflict) => (
                      <li key={conflict.code}>{conflict.issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setPreviewOpen(false)}>
              {applied ? "Close" : "Cancel"}
            </Button>
            {!applied && hasChanges && (
              <Button
                variant="primary"
                onPress={() => applyMutation.mutate()}
                isLoading={applyMutation.isPending}
                isDisabled={(preview?.conflicts.length ?? 0) > 0}
              >
                Apply recommended template
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function StagesSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<LeadStage | null>(null);
  const [deactivatingStage, setDeactivatingStage] = useState<LeadStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-stages"), queryFn: () => listLeadStages("all") });
  const stages = useMemo(() => [...(query.data?.rows ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [query.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-stages") });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions") });
  }
  function handleError(err: unknown) {
    setError(err instanceof LeadLifecycleApiError ? err.message : "This action could not be completed.");
  }

  const reactivateMutation = useMutation({ mutationFn: (stage: LeadStage) => reactivateLeadStage(stage.id), onSuccess: invalidate, onError: handleError });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Lead lifecycle stages</h2>
          <p className="text-sm text-text-secondary">Governs the &quot;Move to stage&quot; options on every Lead.</p>
        </div>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New stage
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {query.isLoading && <LoadingState label="Loading stages" rows={4} onRetry={() => query.refetch()} />}
      {query.isError && <ErrorState title="Could not load stages" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      {query.isSuccess && stages.length === 0 && (
        <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">
          No stages yet. Stages describe how far a prospect has progressed, for example New, Contacted, Working. Use the recommended template above to start with a standard set, or add your own.
        </p>
      )}
      <ol aria-label="Lead stages in order" className="flex flex-col gap-2">
        {stages.map((stage, index) => (
          <li key={stage.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-text-muted">{index + 1}</span>
              <div className="flex min-w-0 flex-col text-sm">
                <span className="font-medium text-text">
                  {stage.name} {stage.isInitial && <span className="font-normal text-text-muted">(where every new lead starts)</span>}
                </span>
                {stage.description && <span className="text-text-secondary">{stage.description}</span>}
                <span className="text-xs text-text-muted">
                  {`${stage.leadCount} lead${stage.leadCount === 1 ? "" : "s"} here now`}
                  {stage.dwellWarningHours ? `. Flagged after ${formatMinutes(Number(stage.dwellWarningHours) * 60)}` : ""}
                  {stage.dwellBreachHours ? `, overdue after ${formatMinutes(Number(stage.dwellBreachHours) * 60)}` : ""}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={stage.status === "active" ? "success" : "neutral"}>{stage.status === "active" ? "In use" : "Retired"}</StatusBadge>
              <Button variant="outline" size="compact" aria-label={`Edit ${stage.name}`} onPress={() => setEditingStage(stage)}>
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              {stage.status === "active" ? (
                !stage.isInitial && (
                  <Button variant="danger" size="compact" aria-label={`Retire ${stage.name}`} onPress={() => setDeactivatingStage(stage)}>
                    <Archive className="size-4" aria-hidden="true" />
                  </Button>
                )
              ) : (
                <Button variant="outline" size="compact" aria-label={`Bring ${stage.name} back`} onPress={() => reactivateMutation.mutate(stage)} isLoading={reactivateMutation.isPending}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <StageDialog
        isOpen={createOpen || Boolean(editingStage)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditingStage(null);
          }
        }}
        stage={editingStage}
        onSaved={invalidate}
        onError={handleError}
      />
      <DeactivateStageDialog stage={deactivatingStage} allStages={stages} onOpenChange={(open) => !open && setDeactivatingStage(null)} onDone={invalidate} onError={handleError} />
    </section>
  );
}

function StageDialog({ isOpen, onOpenChange, stage, onSaved, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; stage: LeadStage | null; onSaved: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState(stage?.name ?? "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(stage?.sortOrder ?? 100));
  const [dwellWarningHours, setDwellWarningHours] = useState(stage?.dwellWarningHours != null ? String(stage.dwellWarningHours) : "");
  const [dwellBreachHours, setDwellBreachHours] = useState(stage?.dwellBreachHours != null ? String(stage.dwellBreachHours) : "");

  const [seededFor, setSeededFor] = useState<LeadStage | null | undefined>(undefined);
  if (isOpen && stage !== seededFor) {
    setSeededFor(stage);
    setName(stage?.name ?? "");
    setDescription(stage?.description ?? "");
    setSortOrder(String(stage?.sortOrder ?? 100));
    setDwellWarningHours(stage?.dwellWarningHours != null ? String(stage.dwellWarningHours) : "");
    setDwellBreachHours(stage?.dwellBreachHours != null ? String(stage.dwellBreachHours) : "");
  }

  const input = {
    name,
    description: description || null,
    sortOrder: Number(sortOrder) || 0,
    dwellWarningHours: dwellWarningHours ? Number(dwellWarningHours) : null,
    dwellBreachHours: dwellBreachHours ? Number(dwellBreachHours) : null,
  };
  const mutation = useMutation({
    mutationFn: () => (stage ? updateLeadStage(stage.id, input) : createLeadStage(input)),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={stage ? `Edit ${stage.name}` : "New Lead lifecycle stage"}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Description" value={description} onChange={setDescription} />
        <TextField label="Position in the list" description="Lower numbers come first. Leave as is to place it at the end." inputMode="numeric" value={sortOrder} onChange={setSortOrder} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Flag as slow after (hours)" description="Optional. Leads stuck this long are highlighted." inputMode="numeric" value={dwellWarningHours} onChange={setDwellWarningHours} />
          <TextField label="Flag as overdue after (hours)" description="Optional. Must be longer than the slow flag." inputMode="numeric" value={dwellBreachHours} onChange={setDwellBreachHours} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            {stage ? "Save changes" : "Create stage"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DeactivateStageDialog({ stage, allStages, onOpenChange, onDone, onError }: { stage: LeadStage | null; allStages: LeadStage[]; onOpenChange: (open: boolean) => void; onDone: () => void; onError: (error: unknown) => void }) {
  const [migrateToStageId, setMigrateToStageId] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  const otherStageOptions: SelectOption[] = allStages.filter((row) => row.id !== stage?.id && row.status === "active").map((row) => ({ value: row.id, label: row.name }));

  const mutation = useMutation({
    mutationFn: () => deactivateLeadStage(stage!.id, migrateToStageId || undefined),
    onSuccess: (result) => {
      if (!result.deactivated) {
        setBlocked("Leads are being moved. The stage retires as soon as the last one has moved.");
        return;
      }
      onDone();
      onOpenChange(false);
      setBlocked(null);
      setMigrateToStageId("");
    },
    onError: (err) => {
      if (err instanceof LeadLifecycleApiError && err.code === "CRM_LEAD_STAGE_HAS_ACTIVE_LEADS") {
        setBlocked(err.message);
        return;
      }
      onError(err);
    },
  });

  return (
    <Dialog isOpen={Boolean(stage)} onOpenChange={onOpenChange} title={stage ? `Retire ${stage.name}` : "Retire stage"}>
      <div className="flex flex-col gap-4">
        {blocked && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {blocked}
          </p>
        )}
        <p className="text-sm text-text-secondary">Retiring a stage removes it from the &quot;Move to stage&quot; options. If leads are still on it, choose the stage they should move to. Nothing is deleted, and you can bring the stage back later.</p>
        <Select label="Migrate active Leads to" options={[{ value: "", label: "Do not move leads (blocked if any remain)" }, ...otherStageOptions]} selectedKey={migrateToStageId} onSelectionChange={(key) => setMigrateToStageId(String(key ?? ""))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            Retire stage
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TransitionsSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stagesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-stages"), queryFn: () => listLeadStages("active") });
  const transitionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions"), queryFn: listLeadStageTransitions });
  const transitions = useMemo(() => transitionsQuery.data?.rows ?? [], [transitionsQuery.data]);
  const [removingEdge, setRemovingEdge] = useState<(typeof transitions)[number] | null>(null);
  const groupedTransitions = useMemo(() => {
    const groups = new Map<string, { fromName: string; edges: typeof transitions }>();
    for (const edge of transitions) {
      const group = groups.get(edge.fromStageId) ?? { fromName: edge.fromStageName, edges: [] };
      group.edges.push(edge);
      groups.set(edge.fromStageId, group);
    }
    return groups;
  }, [transitions]);
  const stageOptions: SelectOption[] = (stagesQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name }));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transitions") });
  }
  function handleError(err: unknown) {
    setError(err instanceof LeadLifecycleApiError ? err.message : "This action could not be completed.");
  }
  const removeMutation = useMutation({
    mutationFn: (edge: { fromStageId: string; toStageId: string }) => removeLeadStageTransition(edge.fromStageId, edge.toStageId),
    onSuccess: invalidate,
    onError: handleError,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Allowed moves</h2>
          <p className="text-sm text-text-secondary">For each stage, the stages a lead may move to. Only these appear in a lead&apos;s &quot;Move to stage&quot; picker.</p>
        </div>
        <Button variant="primary" onPress={() => setAddOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add a move
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {transitionsQuery.isLoading && <LoadingState label="Loading transitions" rows={3} onRetry={() => transitionsQuery.refetch()} />}
      {transitionsQuery.isError && <ErrorState title="Could not load transitions" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void transitionsQuery.refetch() }} />}
      {transitionsQuery.isSuccess && transitions.length === 0 && (
        <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">
          No moves are allowed yet, so sellers cannot change a lead&apos;s stage. Add a transition to say which stage a lead may move to from each stage.
        </p>
      )}
      <ul aria-label="Allowed moves by stage" className="flex flex-col gap-2">
        {[...groupedTransitions.entries()].map(([fromStageId, group]) => (
          <li key={fromStageId} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm sm:flex-row sm:items-center">
            <span className="w-44 shrink-0 font-medium text-text">{group.fromName}</span>
            <span className="text-text-muted">can move to</span>
            <ul className="flex flex-wrap gap-2">
              {group.edges.map((edge) => (
                <li key={edge.toStageId} className="flex items-center gap-1 rounded-full border border-border bg-surface-muted py-0.5 pl-3 pr-1">
                  <span className="text-text">{edge.toStageName}</span>
                  {edge.reasonRequired && <span className="text-xs text-text-muted">(needs a reason)</span>}
                  <Button variant="ghost" size="compact" aria-label={"Stop allowing " + edge.fromStageName + " to " + edge.toStageName} onPress={() => setRemovingEdge(edge)}>
                    <span aria-hidden="true">&times;</span>
                  </Button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {removingEdge && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setRemovingEdge(null); }}
          title="Stop allowing this move?"
          description={"Sellers will no longer be able to move a lead from " + removingEdge.fromStageName + " to " + removingEdge.toStageName + ". Leads already in either stage stay where they are."}
          confirmLabel="Stop allowing"
          isConfirming={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate(removingEdge, { onSettled: () => setRemovingEdge(null) })}
        />
      )}
      <AddTransitionDialog isOpen={addOpen} onOpenChange={setAddOpen} stageOptions={stageOptions} onSaved={invalidate} onError={handleError} />
    </section>
  );
}

function AddTransitionDialog({ isOpen, onOpenChange, stageOptions, onSaved, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; stageOptions: SelectOption[]; onSaved: () => void; onError: (error: unknown) => void }) {
  const [fromStageId, setFromStageId] = useState("");
  const [toStageId, setToStageId] = useState("");
  const [reasonRequired, setReasonRequired] = useState(false);

  const mutation = useMutation({
    mutationFn: () => addLeadStageTransition(fromStageId, toStageId, reasonRequired),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setFromStageId("");
      setToStageId("");
      setReasonRequired(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Allow a stage change">
      <div className="flex flex-col gap-4">
        <Select label="From stage" options={stageOptions} selectedKey={fromStageId} onSelectionChange={(key) => setFromStageId(String(key ?? ""))} />
        <Select label="To stage" options={stageOptions} selectedKey={toStageId} onSelectionChange={(key) => setToStageId(String(key ?? ""))} />
        <Checkbox isSelected={reasonRequired} onChange={setReasonRequired}>
          Ask the seller for a reason when they make this move
        </Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!fromStageId || !toStageId || fromStageId === toStageId}>
            Allow this move
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReasonsSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stagesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-stages"), queryFn: () => listLeadStages("active") });
  const reasonsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transition-reasons"), queryFn: listLeadStageTransitionReasons });
  const reasons = reasonsQuery.data?.rows ?? [];
  const stageOptions: SelectOption[] = (stagesQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name }));
  const stageName = (id: string | null) => stageOptions.find((option) => option.value === id)?.label ?? "a stage that is no longer in use";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-stage-transition-reasons") });
  }
  function handleError(err: unknown) {
    setError(err instanceof LeadLifecycleApiError ? err.message : "This action could not be completed.");
  }
  const toggleMutation = useMutation({
    mutationFn: (reason: { id: string; status: "active" | "inactive" }) => setLeadStageTransitionReasonActive(reason.id, reason.status !== "active"),
    onSuccess: invalidate,
    onError: handleError,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Reasons for stage changes</h2>
          <p className="text-sm text-text-secondary">Sellers choose from these when a move is set to ask for a reason.</p>
        </div>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New reason
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {reasonsQuery.isLoading && <LoadingState label="Loading reasons" rows={3} onRetry={() => reasonsQuery.refetch()} />}
      {reasonsQuery.isError && <ErrorState title="Could not load reasons" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void reasonsQuery.refetch() }} />}
      {reasonsQuery.isSuccess && reasons.length === 0 && <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">No reasons yet. When a move is set to ask for a reason, sellers pick from this list. Add reasons such as &quot;Not interested&quot; or &quot;Wrong contact&quot;.</p>}
      <div className="flex flex-col gap-2">
        {reasons.map((reason) => (
          <div key={reason.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
            <span className="text-text">
              {reason.label} <span className="text-text-muted">
                ({reason.scopeType === "transition" ? `${stageName(reason.fromStageId)} to ${stageName(reason.toStageId)}` : reason.scopeType === "destination" ? `any move into ${stageName(reason.toStageId)}` : "any stage change"})
              </span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge tone={reason.status === "active" ? "success" : "neutral"}>{reason.status === "active" ? "Offered" : "Hidden"}</StatusBadge>
              <Button variant="ghost" size="compact" onPress={() => toggleMutation.mutate(reason)} isLoading={toggleMutation.isPending}>
                {reason.status === "active" ? "Hide" : "Offer again"}
              </Button>
            </span>
          </div>
        ))}
      </div>
      <ReasonDialog isOpen={createOpen} onOpenChange={setCreateOpen} stageOptions={stageOptions} onSaved={invalidate} onError={handleError} />
    </section>
  );
}

function ReasonDialog({ isOpen, onOpenChange, stageOptions, onSaved, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; stageOptions: SelectOption[]; onSaved: () => void; onError: (error: unknown) => void }) {
  const [scopeType, setScopeType] = useState<TransitionReasonScope>("any");
  const [fromStageId, setFromStageId] = useState("");
  const [toStageId, setToStageId] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      createLeadStageTransitionReason({
        scopeType,
        fromStageId: scopeType === "transition" ? fromStageId : undefined,
        toStageId: scopeType !== "any" ? toStageId : undefined,
        code,
        label,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setCode("");
      setLabel("");
      setCodeEdited(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New reason">
      <div className="flex flex-col gap-4">
        <Select
          label="Applies to"
          options={[
            { value: "any", label: "Any transition" },
            { value: "destination", label: "Any transition into a specific stage" },
            { value: "transition", label: "One specific transition" },
          ]}
          selectedKey={scopeType}
          onSelectionChange={(key) => setScopeType((key as TransitionReasonScope) ?? "any")}
        />
        {scopeType === "transition" && <Select label="From stage" options={stageOptions} selectedKey={fromStageId} onSelectionChange={(key) => setFromStageId(String(key ?? ""))} />}
        {scopeType !== "any" && <Select label="To stage" options={stageOptions} selectedKey={toStageId} onSelectionChange={(key) => setToStageId(String(key ?? ""))} />}
        <TextField label="Reason shown to sellers" value={label} onChange={(v) => { setLabel(v); if (!codeEdited) setCode(v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")); }} />
        <TextField label="Short internal code" description="Made from the reason. Lowercase letters, numbers and underscores. Used in reports." value={code} onChange={(v) => { setCodeEdited(true); setCode(v.toLowerCase()); }} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!code.trim() || !label.trim()}>
            Create reason
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
