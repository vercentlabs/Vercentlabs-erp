"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button, Checkbox, Dialog, PermissionState, Select, StatusBadge, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  addLeadStageTransition,
  createLeadStage,
  createLeadStageTransitionReason,
  deactivateLeadStage,
  LeadLifecycleApiError,
  listLeadStages,
  listLeadStageTransitionReasons,
  listLeadStageTransitions,
  reactivateLeadStage,
  removeLeadStageTransition,
  setLeadStageTransitionReasonActive,
  updateLeadStage,
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
      <StagesSection />
      <TransitionsSection />
      <ReasonsSection />
    </div>
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
      {query.isLoading && <p className="text-sm text-text-secondary">Loading stages…</p>}
      <div className="flex flex-col gap-2">
        {stages.map((stage) => (
          <div key={stage.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
            <div className="flex flex-col text-sm">
              <span className="font-medium text-text">
                {stage.name} {stage.isInitial && <span className="text-text-muted">(initial)</span>}
              </span>
              <span className="text-text-secondary">
                {stage.code} · order {stage.sortOrder} · {stage.leadCount} Lead{stage.leadCount === 1 ? "" : "s"}
                {stage.dwellWarningHours ? ` · warn ${stage.dwellWarningHours}h` : ""}
                {stage.dwellBreachHours ? ` · breach ${stage.dwellBreachHours}h` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={stage.status === "active" ? "success" : "neutral"}>{stage.status}</StatusBadge>
              <Button variant="outline" size="compact" onPress={() => setEditingStage(stage)}>
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              {stage.status === "active" ? (
                !stage.isInitial && (
                  <Button variant="danger" size="compact" onPress={() => setDeactivatingStage(stage)}>
                    <Archive className="size-4" aria-hidden="true" />
                  </Button>
                )
              ) : (
                <Button variant="outline" size="compact" onPress={() => reactivateMutation.mutate(stage)} isLoading={reactivateMutation.isPending}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

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
        <TextField label="Order" value={sortOrder} onChange={setSortOrder} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Dwell warning (hours)" placeholder="Optional" value={dwellWarningHours} onChange={setDwellWarningHours} />
          <TextField label="Dwell breach (hours)" placeholder="Optional" value={dwellBreachHours} onChange={setDwellBreachHours} />
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
        setBlocked("Migration started — this stage will finish deactivating once existing Leads have moved.");
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
    <Dialog isOpen={Boolean(stage)} onOpenChange={onOpenChange} title={stage ? `Deactivate ${stage.name}` : "Deactivate stage"}>
      <div className="flex flex-col gap-4">
        {blocked && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {blocked}
          </p>
        )}
        <p className="text-sm text-text-secondary">If Leads are still on this stage, choose a replacement stage to migrate them through the governed transition path.</p>
        <Select label="Migrate active Leads to" options={[{ value: "", label: "No migration (fails if Leads remain)" }, ...otherStageOptions]} selectedKey={migrateToStageId} onSelectionChange={(key) => setMigrateToStageId(String(key ?? ""))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            Deactivate
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
  const transitions = transitionsQuery.data?.rows ?? [];
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
          <h2 className="text-base font-semibold text-text">Allowed transitions</h2>
          <p className="text-sm text-text-secondary">Only these directed moves appear in a Lead&apos;s &quot;Move to stage&quot; picker.</p>
        </div>
        <Button variant="primary" onPress={() => setAddOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add transition
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {transitionsQuery.isLoading && <p className="text-sm text-text-secondary">Loading transitions…</p>}
      {!transitionsQuery.isLoading && transitions.length === 0 && <p className="text-sm text-text-muted">No transitions configured.</p>}
      <div className="flex flex-col gap-2">
        {transitions.map((edge) => (
          <div key={`${edge.fromStageId}-${edge.toStageId}`} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
            <span className="text-text">
              {edge.fromStageName} → {edge.toStageName} {edge.reasonRequired && <span className="text-text-muted">(reason required)</span>}
            </span>
            <Button variant="ghost" size="compact" onPress={() => removeMutation.mutate(edge)} isLoading={removeMutation.isPending}>
              Remove
            </Button>
          </div>
        ))}
      </div>
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
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Add transition">
      <div className="flex flex-col gap-4">
        <Select label="From stage" options={stageOptions} selectedKey={fromStageId} onSelectionChange={(key) => setFromStageId(String(key ?? ""))} />
        <Select label="To stage" options={stageOptions} selectedKey={toStageId} onSelectionChange={(key) => setToStageId(String(key ?? ""))} />
        <Checkbox isSelected={reasonRequired} onChange={setReasonRequired}>
          Require a reason for this transition
        </Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!fromStageId || !toStageId || fromStageId === toStageId}>
            Add transition
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
  const stageName = (id: string | null) => stageOptions.find((option) => option.value === id)?.label ?? "—";

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
          <h2 className="text-base font-semibold text-text">Transition reasons</h2>
          <p className="text-sm text-text-secondary">Shown when a transition marked &quot;reason required&quot; is used.</p>
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
      {reasonsQuery.isLoading && <p className="text-sm text-text-secondary">Loading reasons…</p>}
      <div className="flex flex-col gap-2">
        {reasons.map((reason) => (
          <div key={reason.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
            <span className="text-text">
              {reason.label} <span className="text-text-muted">
                ({reason.scopeType === "transition" ? `${stageName(reason.fromStageId)} → ${stageName(reason.toStageId)}` : reason.scopeType === "destination" ? `any → ${stageName(reason.toStageId)}` : "any transition"})
              </span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge tone={reason.status === "active" ? "success" : "neutral"}>{reason.status}</StatusBadge>
              <Button variant="ghost" size="compact" onPress={() => toggleMutation.mutate(reason)} isLoading={toggleMutation.isPending}>
                {reason.status === "active" ? "Deactivate" : "Activate"}
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
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New transition reason">
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
        <TextField label="Code" description="Lowercase letters, numbers and underscores." isRequired value={code} onChange={(v) => setCode(v.toLowerCase())} />
        <TextField label="Label" isRequired value={label} onChange={setLabel} />
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
