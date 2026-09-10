"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  Dialog,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

type Row = Record<string, unknown>;
type Rule = Row & { id: string; name: string; signal_type: string; points: number; status: string; decay_enabled: boolean; maximum_occurrences: number | null };
type Model = Row & {
  id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";
  base_score: number;
  score_floor: number;
  score_ceiling: number;
  decay_half_life_days: number;
  qualification_thresholds: { warm: number; hot: number; qualified: number };
  rules: Rule[];
};
type RecalcJob = { id: string; status: string; resultManifest?: { percent?: number; processed?: number; requested?: number } };

const SIGNAL_TYPES = [
  { value: "demographic", label: "Demographic (lead field)" },
  { value: "firmographic", label: "Firmographic (company field)" },
  { value: "behavioral", label: "Behavioral (event, positive)" },
  { value: "negative", label: "Negative signal" },
];

function ModelForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    const result = await requestJson("/api/crm/lead-scoring-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") || ""),
        baseScore: Number(form.get("baseScore") || 0),
        scoreFloor: Number(form.get("scoreFloor") || -100),
        scoreCeiling: Number(form.get("scoreCeiling") || 100),
        decayHalfLifeDays: Number(form.get("decayHalfLifeDays") || 30),
        qualificationThresholds: {
          warm: Number(form.get("warm") || 30),
          hot: Number(form.get("hot") || 60),
          qualified: Number(form.get("qualified") || 75),
        },
      }),
    });
    setPending(false);
    if (!result.ok) {
      setError(String(result.message || "Model could not be created."));
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog title="New scoring model version" description="A new model starts as a draft — add rules, then activate it." onClose={onClose} canDismiss={!pending} busy={pending}>
      <form className="crm-suite-form" onSubmit={submit}>
        <FormField label="Name" htmlFor="model-name" required>
          <input id="model-name" name="name" required maxLength={160} placeholder="Default behavioural lead model" />
        </FormField>
        <FormField label="Base score" htmlFor="model-base">
          <input id="model-base" name="baseScore" type="number" defaultValue={0} />
        </FormField>
        <FormField label="Floor" htmlFor="model-floor">
          <input id="model-floor" name="scoreFloor" type="number" defaultValue={-100} />
        </FormField>
        <FormField label="Ceiling" htmlFor="model-ceiling">
          <input id="model-ceiling" name="scoreCeiling" type="number" defaultValue={100} />
        </FormField>
        <FormField label="Decay half-life (days)" htmlFor="model-decay">
          <input id="model-decay" name="decayHalfLifeDays" type="number" min={1} max={3650} defaultValue={30} />
        </FormField>
        <FormField label="Warm threshold" htmlFor="model-warm">
          <input id="model-warm" name="warm" type="number" defaultValue={30} />
        </FormField>
        <FormField label="Hot threshold" htmlFor="model-hot">
          <input id="model-hot" name="hot" type="number" defaultValue={60} />
        </FormField>
        <FormField label="Qualified threshold" htmlFor="model-qualified">
          <input id="model-qualified" name="qualified" type="number" defaultValue={75} />
        </FormField>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <footer>
          <ActionButton type="button" onClick={onClose} disabled={pending}>Cancel</ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending}>{pending ? "Saving…" : "Create draft model"}</ActionButton>
        </footer>
      </form>
    </Dialog>
  );
}

function RuleForm({ modelId, onClose }: { modelId: string; onClose: () => void }) {
  const router = useRouter();
  const [signalType, setSignalType] = useState("demographic");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const predicate =
      signalType === "demographic" || signalType === "firmographic"
        ? { field: String(form.get("field") || ""), operator: String(form.get("operator") || "not_empty") }
        : { eventType: String(form.get("eventType") || ""), withinDays: Number(form.get("withinDays") || 90) };
    setPending(true);
    setError("");
    const result = await requestJson(`/api/crm/lead-scoring-models/${modelId}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") || ""),
        signalType,
        predicate,
        points: Number(form.get("points") || 0),
        maximumOccurrences: form.get("maximumOccurrences") ? Number(form.get("maximumOccurrences")) : null,
        decayEnabled: signalType === "behavioral" && form.get("decayEnabled") === "on",
        sequence: Number(form.get("sequence") || 100),
      }),
    });
    setPending(false);
    if (!result.ok) {
      setError(String(result.message || "Rule could not be saved."));
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog title="Add scoring rule" onClose={onClose} canDismiss={!pending} busy={pending}>
      <form className="crm-suite-form" onSubmit={submit}>
        <FormField label="Name" htmlFor="rule-name" required>
          <input id="rule-name" name="name" required maxLength={160} placeholder="Work email present" />
        </FormField>
        <FormField label="Signal type" htmlFor="rule-signal">
          <select id="rule-signal" value={signalType} onChange={(event) => setSignalType(event.currentTarget.value)}>
            {SIGNAL_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </FormField>
        {signalType === "demographic" || signalType === "firmographic" ? (
          <>
            <FormField label="Lead field" htmlFor="rule-field" required>
              <input id="rule-field" name="field" required placeholder="email" />
            </FormField>
            <FormField label="Operator" htmlFor="rule-operator">
              <select id="rule-operator" name="operator" defaultValue="not_empty">
                <option value="not_empty">Not empty</option>
                <option value="empty">Empty</option>
                <option value="equals">Equals</option>
                <option value="not_equals">Not equals</option>
                <option value="contains">Contains</option>
                <option value="greater_than">Greater than</option>
                <option value="less_than">Less than</option>
              </select>
            </FormField>
          </>
        ) : (
          <>
            <FormField label="Event type" htmlFor="rule-event" required>
              <input id="rule-event" name="eventType" required placeholder="form_submitted" />
            </FormField>
            <FormField label="Within days" htmlFor="rule-within-days">
              <input id="rule-within-days" name="withinDays" type="number" min={1} defaultValue={90} />
            </FormField>
            <FormField label="Maximum occurrences" htmlFor="rule-max-occurrences" hint="Leave blank for unlimited.">
              <input id="rule-max-occurrences" name="maximumOccurrences" type="number" min={1} />
            </FormField>
            {signalType === "behavioral" ? (
              <label><input type="checkbox" name="decayEnabled" /> Decay contribution over time (half-life above)</label>
            ) : null}
          </>
        )}
        <FormField label="Points" htmlFor="rule-points" required>
          <input id="rule-points" name="points" type="number" min={-1000} max={1000} required />
        </FormField>
        <FormField label="Sequence" htmlFor="rule-sequence">
          <input id="rule-sequence" name="sequence" type="number" min={0} max={100000} defaultValue={100} />
        </FormField>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <footer>
          <ActionButton type="button" onClick={onClose} disabled={pending}>Cancel</ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending}>{pending ? "Saving…" : "Save rule"}</ActionButton>
        </footer>
      </form>
    </Dialog>
  );
}

export default function LeadScoringWorkspace({ models }: { models: Model[] }) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [showModelForm, setShowModelForm] = useState(false);
  const [ruleModelId, setRuleModelId] = useState<string | null>(null);
  const [recalcJob, setRecalcJob] = useState<RecalcJob | null>(null);

  const active = models.find((model) => model.status === "active") || null;
  const others = models.filter((model) => model.status !== "active");

  useEffect(() => {
    if (!recalcJob || recalcJob.status === "completed" || recalcJob.status === "dead") return;
    const timer = setTimeout(async () => {
      const result = await requestJson<{ record?: RecalcJob }>(`/api/crm/lead-score-recalc-jobs/${recalcJob.id}`);
      if (result.ok && result.record) setRecalcJob(result.record);
    }, 2000);
    return () => clearTimeout(timer);
  }, [recalcJob]);

  async function activate(model: Model) {
    setPending(model.id);
    setMessage("");
    const result = await requestJson<{ recalcJob?: RecalcJob }>(`/api/crm/lead-scoring-models/${model.id}/activate`, { method: "POST" });
    setPending("");
    if (!result.ok) {
      setMessage(String(result.message || "Model could not be activated."));
      return;
    }
    setMessage(String(result.message || "Model activated."));
    if (result.recalcJob) setRecalcJob(result.recalcJob);
    router.refresh();
  }

  async function toggleRule(model: Model, rule: Rule) {
    setPending(`rule-${rule.id}`);
    const result = await requestJson(`/api/crm/lead-scoring-models/${model.id}/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: rule.status === "active" ? "inactive" : "active" }),
    });
    setPending("");
    if (result.ok) router.refresh();
    else setMessage(String(result.message || "Rule could not be updated."));
  }

  const ruleColumns: DataGridColumn<Rule>[] = [
    { id: "name", header: "Rule", cell: (rule) => <strong>{rule.name}</strong> },
    { id: "signal", header: "Signal", cell: (rule) => rule.signal_type },
    { id: "points", header: "Points", cell: (rule) => (Number(rule.points) > 0 ? `+${rule.points}` : rule.points) },
    { id: "decay", header: "Decay", cell: (rule) => (rule.decay_enabled ? "Yes" : "No") },
    { id: "cap", header: "Cap", cell: (rule) => rule.maximum_occurrences ?? "Unlimited" },
    { id: "status", header: "Status", cell: (rule) => <StatusBadge tone={rule.status === "active" ? "success" : "neutral"}>{rule.status}</StatusBadge> },
  ];

  function ruleActionsColumn(model: Model): DataGridColumn<Rule> {
    return {
      id: "actions",
      header: "Actions",
      cell: (rule) => (
        <ActionButton
          tone="quiet"
          type="button"
          disabled={model.status === "active" || pending === `rule-${rule.id}`}
          onClick={() => void toggleRule(model, rule)}
        >
          {rule.status === "active" ? "Deactivate" : "Activate"}
        </ActionButton>
      ),
    };
  }

  return (
    <div className="module-workbench crm-scoring-page">
      <header className="crm-suite-command">
        <div>
          <p className="eyebrow">CRM setup · Lead management</p>
          <h1>Lead scoring</h1>
          <p>One deterministic model is active at a time. Editing an active model&apos;s rules is blocked — create a new version instead, so historical scores stay explainable.</p>
        </div>
        <ActionButton tone="primary" type="button" onClick={() => setShowModelForm(true)}>
          New model version
        </ActionButton>
      </header>
      {message ? <p className="notice" role="status">{message}</p> : null}

      <section className="crm-suite-surface" aria-labelledby="active-model-title">
        <div className="crm-suite-section-heading">
          <div>
            <p className="eyebrow">Currently scoring every Lead</p>
            <h2 id="active-model-title">{active ? `${active.name} · v${active.version}` : "No active model"}</h2>
            {active ? (
              <p>
                Base {active.base_score} · Floor {active.score_floor} · Ceiling {active.score_ceiling} · Decay half-life {active.decay_half_life_days}d ·
                Warm ≥{active.qualification_thresholds?.warm} · Hot ≥{active.qualification_thresholds?.hot} · Qualified ≥{active.qualification_thresholds?.qualified}
              </p>
            ) : (
              <p>Leads will not be scored until a model is activated.</p>
            )}
          </div>
        </div>
        {active ? (
          <EnterpriseDataGrid
            caption="Active model rules"
            rows={active.rules}
            rowKey={(rule) => rule.id}
            columns={ruleColumns}
            emptyState={<StatePanel title="No rules configured." description="Create a draft model version to add rules." />}
          />
        ) : null}
      </section>

      <section className="crm-suite-surface" aria-labelledby="other-models-title">
        <div className="crm-suite-section-heading">
          <div>
            <p className="eyebrow">Versions</p>
            <h2 id="other-models-title">Draft &amp; retired models</h2>
          </div>
        </div>
        {others.length ? (
          others.map((model) => (
            <article key={model.id} className="crm-suite-surface">
              <header className="crm-suite-section-heading">
                <div>
                  <h3>{model.name} · v{model.version}</h3>
                  <StatusBadge tone={model.status === "draft" ? "info" : "neutral"}>{model.status}</StatusBadge>
                </div>
                <div>
                  {model.status === "draft" ? (
                    <>
                      <ActionButton type="button" onClick={() => setRuleModelId(model.id)}>Add rule</ActionButton>
                      <ActionButton
                        tone="primary"
                        type="button"
                        busy={pending === model.id}
                        disabled={!model.rules.some((rule) => rule.status === "active")}
                        onClick={() => void activate(model)}
                      >
                        Activate
                      </ActionButton>
                    </>
                  ) : null}
                </div>
              </header>
              <EnterpriseDataGrid
                caption={`${model.name} rules`}
                rows={model.rules}
                rowKey={(rule) => rule.id}
                columns={model.status === "draft" ? [...ruleColumns, ruleActionsColumn(model)] : ruleColumns}
                emptyState={<StatePanel title="No rules yet." description="Add at least one active rule before this model can be activated." />}
              />
            </article>
          ))
        ) : (
          <p>No other model versions.</p>
        )}
      </section>

      {showModelForm ? <ModelForm onClose={() => setShowModelForm(false)} /> : null}
      {ruleModelId ? <RuleForm modelId={ruleModelId} onClose={() => setRuleModelId(null)} /> : null}
      {recalcJob ? (
        <Dialog
          title={`Recalculating scores — ${recalcJob.resultManifest?.percent ?? 0}%`}
          description={`${recalcJob.resultManifest?.processed ?? 0} of ${recalcJob.resultManifest?.requested ?? 0} Lead(s) recalculated under the newly activated model.`}
          onClose={() => setRecalcJob(null)}
        >
          <footer>
            <ActionButton type="button" onClick={() => setRecalcJob(null)}>
              {recalcJob.status === "completed" ? "Done" : "Continue in background"}
            </ActionButton>
          </footer>
        </Dialog>
      ) : null}
    </div>
  );
}
