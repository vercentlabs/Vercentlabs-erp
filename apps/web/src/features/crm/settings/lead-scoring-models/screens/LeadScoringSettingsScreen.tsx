"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Sparkles } from "lucide-react";
import { Button, Checkbox, Dialog, PermissionState, Select, StatusBadge, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  activateLeadScoringModel,
  createLeadScoringModel,
  createLeadScoringModelRule,
  listLeadScoringModels,
  ScoringModelApiError,
  setLeadScoringModelRuleStatus,
  trainLeadScoringModel,
} from "../api/lead-scoring-models-api";
import { PREDICTIVE_TRAINING_VARIABLES, SIGNAL_TYPES, type LeadScoringModel, type LeadScoringModelRule, type PredictiveTrainingVariable, type SignalType } from "../types";

const TRAINING_VARIABLE_LABELS: Record<PredictiveTrainingVariable, string> = {
  sourceId: "Lead source",
  industry: "Industry",
  countryCode: "Country",
  rating: "Rating",
  priority: "Priority",
};

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

// A rule's condition in words: "Industry is Manufacturing", "Email opened in the last 30 days".
function describePredicate(predicate: Record<string, unknown>): string {
  if (predicate.eventType) return `${humanize(predicate.eventType)} in the last ${Number(predicate.withinDays) || 30} days`;
  const operator = OPERATOR_OPTIONS.find((o) => o.value === predicate.operator)?.label ?? humanize(predicate.operator);
  return `${humanize(predicate.field)} ${String(operator).toLowerCase()} ${predicate.value === undefined || predicate.value === "" ? "" : String(predicate.value)}`.trim();
}

function ScoreBands({ model }: { model: LeadScoringModel }) {
  const t = model.qualification_thresholds;
  return (
    <ul aria-label="Score bands" className="flex flex-wrap gap-2 text-xs">
      <li className="rounded-full border border-border px-2.5 py-1">{`Cold: below ${t.warm}`}</li>
      <li className="rounded-full border border-warning-emphasis/30 bg-warning-soft px-2.5 py-1 text-warning">{`Warm: ${t.warm} to ${t.hot - 1}`}</li>
      <li className="rounded-full border border-danger-emphasis/30 bg-danger-soft px-2.5 py-1 text-danger">{`Hot: ${t.hot} and above`}</li>
      <li className="rounded-full border border-success-emphasis/30 bg-success-soft px-2.5 py-1 text-success">{`Sales-qualified at ${t.qualified}`}</li>
    </ul>
  );
}

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
          <p className="text-sm text-text-secondary">The score comes from one active rules model: points you can read rule by rule. A predictive model can be active alongside it and adds a separate “likelihood to qualify” estimate. It never changes the score. Activating a new version retires the previous one of the same kind and recalculates existing Leads.</p>
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

      {query.isLoading && <LoadingState label="Loading scoring models" rows={3} onRetry={() => query.refetch()} />}
      {query.isError && <p role="alert" className="text-sm text-danger">The scoring models could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>}
      {query.isSuccess && models.length === 0 && <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">No scoring model yet. A model gives every lead a score from rules you choose, such as industry, country or recent email activity, so sellers know whom to call first. Create a model, add rules, then activate it.</p>}

      <div className="flex flex-col gap-4">
        {models.map((model) => (
          <div key={model.id} className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border-strong p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-2 font-medium text-text">
                  {model.name} <span className="text-text-muted">{`Version ${model.version}`}</span>
                  {model.model_type === "predictive" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-xs text-text-secondary">
                      <Sparkles className="size-3" aria-hidden="true" /> Predictive
                    </span>
                  )}
                </p>
                <p className="text-sm text-text-secondary">
                  {model.model_type === "predictive"
                    ? "Estimates each Lead's likelihood to qualify from this org's own qualified vs unqualified history, using the training variables below. Shown beside the score, never added to it."
                    : `Starts at ${model.base_score}, stays between ${model.score_floor} and ${model.score_ceiling}. Activity signals fade with a half-life of ${model.decay_half_life_days} days.`}
                </p>
                <div className="mt-2"><ScoreBands model={model} /></div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={model.status === "active" ? "success" : model.status === "draft" ? "neutral" : "warning"}>{model.status === "active" ? "Live" : model.status === "draft" ? "Draft, not scoring yet" : "Retired"}</StatusBadge>
                {model.status === "draft" && model.model_type === "predictive" && !model.trained_at && (
                  <span className="text-xs text-text-muted">Train before activating</span>
                )}
                {model.status === "draft" && (
                  <Button
                    variant="secondary"
                    size="compact"
                    onPress={() => activateMutation.mutate(model)}
                    isLoading={activateMutation.isPending}
                    isDisabled={model.model_type === "predictive" && !model.trained_at}
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Activate
                  </Button>
                )}
              </div>
            </div>
            {model.model_type === "predictive" ? (
              <PredictiveModelPanel model={model} onError={handleError} onChanged={invalidate} />
            ) : (
              <RuleList model={model} onManage={() => setRuleModel(model)} onError={handleError} onChanged={invalidate} />
            )}
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
      {model.rules.length === 0 && <p className="text-sm text-text-muted">No rules yet. A model with no rules scores every lead at its starting value.</p>}
      {model.rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 flex-col">
            <span className="text-text">{rule.name}</span>
            <span className="text-xs text-text-muted">{`${humanize(rule.signal_type)}: when ${describePredicate(rule.predicate)}`}</span>
          </span>
          <span className={`shrink-0 font-semibold tabular-nums ${rule.points >= 0 ? "text-success" : "text-danger"}`}>{`${rule.points >= 0 ? "Adds" : "Removes"} ${Math.abs(rule.points)} point${Math.abs(rule.points) === 1 ? "" : "s"}`}</span>
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

const MODEL_TYPE_OPTIONS: SelectOption[] = [
  { value: "rule_based", label: "Rule-based (points you configure)" },
  { value: "predictive", label: "Predictive (trained on this org's own history)" },
];

function CreateModelDialog({ isOpen, onOpenChange, onCreated, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState("");
  const [modelType, setModelType] = useState<"rule_based" | "predictive">("rule_based");
  const [baseScore, setBaseScore] = useState("0");
  const [scoreFloor, setScoreFloor] = useState("-100");
  const [scoreCeiling, setScoreCeiling] = useState("100");
  const [decayHalfLifeDays, setDecayHalfLifeDays] = useState("30");
  const [warm, setWarm] = useState("30");
  const [hot, setHot] = useState("60");
  const [qualified, setQualified] = useState("75");
  const [trainingVariables, setTrainingVariables] = useState<PredictiveTrainingVariable[]>(["sourceId", "industry"]);
  const [minimumClassSize, setMinimumClassSize] = useState("40");

  const isPredictive = modelType === "predictive";
  const mutation = useMutation({
    mutationFn: () =>
      createLeadScoringModel({
        name,
        modelType,
        ...(isPredictive
          ? { trainingVariables, minimumClassSize: Number(minimumClassSize) || 40 }
          : { baseScore: Number(baseScore) || 0, scoreFloor: Number(scoreFloor) || -100, decayHalfLifeDays: Number(decayHalfLifeDays) || 30 }),
        scoreCeiling: Number(scoreCeiling) || 100,
        qualificationThresholds: { warm: Number(warm) || 30, hot: Number(hot) || 60, qualified: Number(qualified) || 75 },
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
    },
    onError,
  });

  function toggleVariable(variable: PredictiveTrainingVariable, checked: boolean) {
    setTrainingVariables((current) => (checked ? [...new Set([...current, variable])] : current.filter((v) => v !== variable)));
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New scoring model">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Model type" options={MODEL_TYPE_OPTIONS} selectedKey={modelType} onSelectionChange={(key) => setModelType((key as "rule_based" | "predictive") ?? "rule_based")} />
        {isPredictive ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-text">Training variables</legend>
              <p className="text-xs text-text-muted">Which Lead attributes should the model learn from qualified vs unqualified history?</p>
              {PREDICTIVE_TRAINING_VARIABLES.map((variable) => (
                <Checkbox key={variable} isSelected={trainingVariables.includes(variable)} onChange={(checked) => toggleVariable(variable, checked)}>
                  {TRAINING_VARIABLE_LABELS[variable]}
                </Checkbox>
              ))}
            </fieldset>
            <TextField label="Minimum qualified/unqualified Leads required to train" value={minimumClassSize} onChange={setMinimumClassSize} />
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <TextField label="Base score" value={baseScore} onChange={setBaseScore} />
              <TextField label="Floor" value={scoreFloor} onChange={setScoreFloor} />
              <TextField label="Ceiling" value={scoreCeiling} onChange={setScoreCeiling} />
            </div>
            <TextField label="Decay half-life (days)" value={decayHalfLifeDays} onChange={setDecayHalfLifeDays} />
          </>
        )}
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Warm threshold" value={warm} onChange={setWarm} />
          <TextField label="Hot threshold" value={hot} onChange={setHot} />
          <TextField label="Qualified threshold" value={qualified} onChange={setQualified} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || (isPredictive && trainingVariables.length === 0)}>
            Create model
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PredictiveModelPanel({ model, onError, onChanged }: { model: LeadScoringModel; onError: (error: unknown) => void; onChanged: () => void }) {
  const trainMutation = useMutation({
    mutationFn: () => trainLeadScoringModel(model.id),
    onSuccess: onChanged,
    onError,
  });
  const summary = model.training_summary || {};
  const editable = model.status !== "active";

  return (
    <div className="flex flex-col gap-2 border-t border-border-strong pt-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(model.training_variables || []).map((variable) => (
          <span key={variable} className="rounded-full border border-border px-2.5 py-1">{TRAINING_VARIABLE_LABELS[variable] ?? humanize(variable)}</span>
        ))}
      </div>
      {model.trained_at ? (
        <p className="text-sm text-text-secondary">
          {`Trained on ${summary.qualifiedCount ?? 0} qualified and ${summary.unqualifiedCount ?? 0} unqualified Leads, last trained ${new Date(model.trained_at).toLocaleString()}.`}
        </p>
      ) : (
        <p className="text-sm text-text-muted">
          {`Not trained yet. Needs at least ${model.minimum_class_size} qualified and ${model.minimum_class_size} unqualified Leads.`}
        </p>
      )}
      {editable && (
        <Button variant="secondary" size="compact" className="self-start" onPress={() => trainMutation.mutate()} isLoading={trainMutation.isPending}>
          <Sparkles className="size-4" aria-hidden="true" />
          {model.trained_at ? "Retrain model" : "Train model"}
        </Button>
      )}
      {!editable && <p className="text-xs text-text-muted">Create a new model version to retrain an active model.</p>}
    </div>
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
