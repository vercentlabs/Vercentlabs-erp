"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { Button, Dialog, PermissionState, Select, StatusBadge, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  activateLeadScoringModel,
  createLeadScoringModel,
  createLeadScoringModelRule,
  listLeadScoringModels,
  ScoringModelApiError,
  setLeadScoringModelRuleStatus,
} from "../api/lead-scoring-models-api";
import { SIGNAL_TYPES, type LeadScoringModel, type LeadScoringModelRule, type SignalType } from "../types";

const SIGNAL_OPTIONS: SelectOption[] = SIGNAL_TYPES.map((value) => ({ value, label: value.replace(/^./, (c) => c.toUpperCase()) }));
const OPERATOR_OPTIONS: SelectOption[] = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "not_empty", label: "Is not empty" },
  { value: "empty", label: "Is empty" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
];

// F027 Tranche I (Stage A) — the REAL Lead scoring configuration surface.
// scoring-engine.js's own header explicitly documents that this model
// (crm_lead_scoring_models/crm_lead_scoring_model_rules) replaced a
// retired legacy system ("System B", tenant.crm_scoring_rules) that used
// to silently overwrite crm_leads.score with no version/cap/decay —
// confirmed by reading the engine before wiring anything, so this screen
// governs the table the engine actually reads.
export function LeadScoringSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const [createOpen, setCreateOpen] = useState(false);
  const [ruleModel, setRuleModel] = useState<LeadScoringModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-scoring-models"), queryFn: listLeadScoringModels });
  const models = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-scoring-models") });
  }
  function handleError(err: unknown) {
    setError(err instanceof ScoringModelApiError ? err.message : "This action could not be completed.");
  }

  const activateMutation = useMutation({
    mutationFn: (model: LeadScoringModel) => activateLeadScoringModel(model.id),
    onSuccess: invalidate,
    onError: handleError,
  });

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Lead scoring</h1>
          <p className="text-sm text-text-secondary">Only one model may be active; activating a new version retires the previous one and re-scores existing Leads.</p>
        </div>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New model
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {query.isLoading && <p className="text-sm text-text-secondary">Loading scoring models…</p>}
      {!query.isLoading && models.length === 0 && <p className="text-sm text-text-muted">No scoring models configured yet.</p>}

      <div className="flex flex-col gap-4">
        {models.map((model) => (
          <div key={model.id} className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border-strong p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text">
                  {model.name} <span className="text-text-muted">v{model.version}</span>
                </p>
                <p className="text-sm text-text-secondary">
                  Base {model.base_score} · Range {model.score_floor} to {model.score_ceiling} · Decay {model.decay_half_life_days}d
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={model.status === "active" ? "success" : model.status === "draft" ? "neutral" : "warning"}>{model.status}</StatusBadge>
                {model.status === "draft" && (
                  <Button variant="secondary" size="compact" onPress={() => activateMutation.mutate(model)} isLoading={activateMutation.isPending}>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Activate
                  </Button>
                )}
              </div>
            </div>
            <RuleList model={model} onManage={() => setRuleModel(model)} onError={handleError} onChanged={invalidate} />
          </div>
        ))}
      </div>

      <CreateModelDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} onError={handleError} />
      <RuleDialog model={ruleModel} onOpenChange={(open) => !open && setRuleModel(null)} onSaved={invalidate} onError={handleError} />
    </div>
  );
}

function RuleList({ model, onManage, onError, onChanged }: { model: LeadScoringModel; onManage: () => void; onError: (error: unknown) => void; onChanged: () => void }) {
  const toggleMutation = useMutation({
    mutationFn: (rule: LeadScoringModelRule) => setLeadScoringModelRuleStatus(model.id, rule.id, rule.status === "active" ? "inactive" : "active"),
    onSuccess: onChanged,
    onError,
  });
  const editable = model.status !== "active";

  return (
    <div className="flex flex-col gap-2 border-t border-border-strong pt-3">
      {model.rules.length === 0 && <p className="text-sm text-text-muted">No rules yet.</p>}
      {model.rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-text">
            {rule.name} <span className="text-text-muted">({rule.signal_type}, {rule.points > 0 ? "+" : ""}{rule.points} pts)</span>
          </span>
          <span className="flex items-center gap-2">
            <StatusBadge tone={rule.status === "active" ? "success" : "neutral"}>{rule.status}</StatusBadge>
            {editable && (
              <Button variant="ghost" size="compact" onPress={() => toggleMutation.mutate(rule)} isLoading={toggleMutation.isPending}>
                {rule.status === "active" ? "Deactivate" : "Activate"}
              </Button>
            )}
          </span>
        </div>
      ))}
      {editable && (
        <Button variant="secondary" size="compact" className="self-start" onPress={onManage}>
          <Plus className="size-4" aria-hidden="true" />
          Add rule
        </Button>
      )}
      {!editable && <p className="text-xs text-text-muted">Create a new model version to change rules on an active model.</p>}
    </div>
  );
}

function CreateModelDialog({ isOpen, onOpenChange, onCreated, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState("");
  const [baseScore, setBaseScore] = useState("0");
  const [scoreFloor, setScoreFloor] = useState("-100");
  const [scoreCeiling, setScoreCeiling] = useState("100");
  const [decayHalfLifeDays, setDecayHalfLifeDays] = useState("30");
  const [warm, setWarm] = useState("30");
  const [hot, setHot] = useState("60");
  const [qualified, setQualified] = useState("75");

  const mutation = useMutation({
    mutationFn: () =>
      createLeadScoringModel({
        name,
        baseScore: Number(baseScore) || 0,
        scoreFloor: Number(scoreFloor) || -100,
        scoreCeiling: Number(scoreCeiling) || 100,
        decayHalfLifeDays: Number(decayHalfLifeDays) || 30,
        qualificationThresholds: { warm: Number(warm) || 30, hot: Number(hot) || 60, qualified: Number(qualified) || 75 },
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New scoring model">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Base score" value={baseScore} onChange={setBaseScore} />
          <TextField label="Floor" value={scoreFloor} onChange={setScoreFloor} />
          <TextField label="Ceiling" value={scoreCeiling} onChange={setScoreCeiling} />
        </div>
        <TextField label="Decay half-life (days)" value={decayHalfLifeDays} onChange={setDecayHalfLifeDays} />
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Warm threshold" value={warm} onChange={setWarm} />
          <TextField label="Hot threshold" value={hot} onChange={setHot} />
          <TextField label="Qualified threshold" value={qualified} onChange={setQualified} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Create model
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RuleDialog({ model, onOpenChange, onSaved, onError }: { model: LeadScoringModel | null; onOpenChange: (open: boolean) => void; onSaved: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState("");
  const [signalType, setSignalType] = useState<SignalType>("demographic");
  const [points, setPoints] = useState("10");
  const [field, setField] = useState("");
  const [operator, setOperator] = useState("equals");
  const [value, setValue] = useState("");
  const [eventType, setEventType] = useState("");
  const [withinDays, setWithinDays] = useState("30");

  const isBehavioral = signalType === "behavioral" || signalType === "negative";
  const mutation = useMutation({
    mutationFn: () =>
      createLeadScoringModelRule(model!.id, {
        name,
        signalType,
        points: Number(points) || 0,
        predicate: isBehavioral ? { eventType, withinDays: Number(withinDays) || 30 } : { field, operator, value },
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setName("");
      setField("");
      setValue("");
      setEventType("");
    },
    onError,
  });

  return (
    <Dialog isOpen={Boolean(model)} onOpenChange={onOpenChange} title={model ? `Add rule to ${model.name}` : "Add rule"}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Signal type" options={SIGNAL_OPTIONS} selectedKey={signalType} onSelectionChange={(key) => setSignalType((key as SignalType) ?? "demographic")} />
        <TextField label="Points" description="Negative points are allowed for the 'negative' signal type." value={points} onChange={setPoints} />
        {isBehavioral ? (
          <>
            <TextField label="Event type" placeholder="e.g. email_opened, call_completed" value={eventType} onChange={setEventType} />
            <TextField label="Within days" value={withinDays} onChange={setWithinDays} />
          </>
        ) : (
          <>
            <TextField label="Field" placeholder="e.g. industry, countryCode" value={field} onChange={setField} />
            <Select label="Operator" options={OPERATOR_OPTIONS} selectedKey={operator} onSelectionChange={(key) => setOperator(String(key ?? "equals"))} />
            <TextField label="Value" value={value} onChange={setValue} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Add rule
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
