"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";

type Pipeline = {
  id: string;
  name: string;
  code: string;
  companyId?: string | null;
  isDefault?: boolean;
  status: "active" | "inactive";
  activeOpenStageCount: number;
  activeWonStageCount: number;
  activeLostStageCount: number;
};

type Stage = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  name: string;
  code: string;
  sequence: number;
  probability: number;
  forecastCategory: string;
  stageType: "open" | "won" | "lost";
  staleAfterDays?: number | null;
  status: "active" | "inactive";
  opportunityCount: number;
  openOpportunityCount: number;
  updatedAt: string;
};

type History = {
  id: string;
  stageName?: string;
  stageCode?: string;
  action: string;
  changedByName?: string | null;
  changedAt: string;
};

function typeLabel(type: Stage["stageType"]) {
  return type === "won" ? "Won" : type === "lost" ? "Lost" : "Open";
}

export default function SalesStagesWorkspace({
  pipelines,
  selectedPipelineId,
  stages,
  history,
}: {
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  stages: Stage[];
  history: History[];
}) {
  const router = useRouter();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Stage | null | undefined>(undefined);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [stageTypeValue, setStageTypeValue] = useState<Stage["stageType"]>("open");

  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId) || null;
  const activeStages = useMemo(
    () => stages.filter((stage) => stage.status === "active").sort((a, b) => a.sequence - b.sequence),
    [stages],
  );
  const inactiveStages = useMemo(
    () => stages.filter((stage) => stage.status === "inactive").sort((a, b) => a.sequence - b.sequence),
    [stages],
  );

  useEffect(() => {
    const drawer = drawerRef.current;
    if (editing !== undefined && drawer && !drawer.open) drawer.showModal();
    if (editing === undefined && drawer?.open) drawer.close();
  }, [editing]);

  function openEditor(stage: Stage | null) {
    setStageTypeValue(stage?.stageType || "open");
    setEditing(stage);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPipelineId) return;
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      pipelineId: editing?.pipelineId || selectedPipelineId,
      name: String(form.get("name") || ""),
      stageType: stageTypeValue,
      probability: Number(form.get("probability") || 0),
      forecastCategory: String(form.get("forecastCategory") || "pipeline"),
      staleAfterDays: String(form.get("staleAfterDays") || "").trim() || null,
    };
    if (editing) body.expectedUpdatedAt = editing.updatedAt;
    setPending("save");
    setMessage("");
    const result = await requestJson(
      editing ? `/api/crm/sales-stages/${editing.id}` : "/api/crm/sales-stages",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "Sales stage could not be saved.");
      return;
    }
    setEditing(undefined);
    setMessage(result.message || "Sales stage saved.");
    router.refresh();
  }

  async function setActive(stage: Stage, active: boolean) {
    if (!active && !confirm(`Deactivate ${stage.name}? Open Opportunities must be moved first.`)) return;
    setPending(stage.id);
    setMessage("");
    const result = await requestJson(`/api/crm/sales-stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: active ? "reactivate" : "deactivate", expectedUpdatedAt: stage.updatedAt }),
    });
    setPending("");
    setMessage(result.message || (result.ok ? "Sales stage updated." : "Sales stage could not be updated."));
    if (result.ok) router.refresh();
  }

  async function move(stage: Stage, direction: -1 | 1) {
    const index = activeStages.findIndex((row) => row.id === stage.id);
    const target = activeStages[index + direction];
    if (!target) return;
    const stageTerminal = stage.stageType !== "open";
    const targetTerminal = target.stageType !== "open";
    if (stageTerminal !== targetTerminal) {
      setMessage("Open stages must stay before Won/Lost terminal stages.");
      return;
    }
    const ordered = [...activeStages];
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    setPending(`order:${stage.id}`);
    setMessage("");
    const result = await requestJson("/api/crm/sales-stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reorder",
        pipelineId: selectedPipelineId,
        entries: ordered.map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt })),
      }),
    });
    setPending("");
    setMessage(result.message || (result.ok ? "Sales stages reordered." : "Sales stages could not be reordered."));
    if (result.ok) router.refresh();
  }

  const ready = Boolean(
    selectedPipeline &&
      Number(selectedPipeline.activeOpenStageCount) > 0 &&
      Number(selectedPipeline.activeWonStageCount) === 1 &&
      Number(selectedPipeline.activeLostStageCount) === 1,
  );

  return (
    <main className="crm-sales-stages-page">
      <header className="crm-sales-stages-heading">
        <div>
          <p className="eyebrow">CRM · Pipeline setup</p>
          <h1>Sales stages</h1>
          <p>Define one ordered, governed stage catalogue per pipeline. Stage defaults feed F010 movement and F011 probability without rewriting existing deals retroactively.</p>
        </div>
        <button className="primary-button" type="button" disabled={!selectedPipeline || selectedPipeline.status !== "active"} onClick={() => openEditor(null)}>
          <AppIcon name="modules" size={16} /> Add stage
        </button>
      </header>

      <section className="crm-sales-stages-toolbar" aria-label="Sales stage pipeline selection">
        <label>
          <span>Pipeline</span>
          <select
            aria-label="Select sales-stage pipeline"
            value={selectedPipelineId || ""}
            onChange={(event) => router.push(`/crm/stages?pipeline=${encodeURIComponent(event.target.value)}`)}
          >
            {pipelines.length ? null : <option value="">No visible pipelines</option>}
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.status === "inactive" ? " · inactive" : ""}</option>
            ))}
          </select>
        </label>
        {selectedPipeline ? (
          <div className={`crm-sales-stages-readiness ${ready ? "is-ready" : "is-warning"}`} role="status">
            <strong>{ready ? "Pipeline stage model ready" : "Pipeline stage model needs attention"}</strong>
            <span>{selectedPipeline.activeOpenStageCount} open · {selectedPipeline.activeWonStageCount} won · {selectedPipeline.activeLostStageCount} lost active stage(s)</span>
          </div>
        ) : null}
      </section>

      {message ? <p className="notice" role="status">{message}</p> : null}

      {!selectedPipeline ? (
        <section className="empty-state"><strong>No visible pipeline</strong><p>Create or select a CRM pipeline before configuring Sales Stages.</p></section>
      ) : (
        <>
          <section className="crm-sales-stages-list" aria-label="Active sales stages">
            <div className="crm-sales-stages-list__header" aria-hidden="true">
              <span>Order</span><span>Stage</span><span>Default</span><span>Usage</span><span>Actions</span>
            </div>
            {activeStages.map((stage, index) => {
              const terminal = stage.stageType !== "open";
              const previous = activeStages[index - 1];
              const next = activeStages[index + 1];
              return (
                <article key={stage.id}>
                  <span className="crm-sales-stages-order">{String(index + 1).padStart(2, "0")}</span>
                  <div className="crm-sales-stages-copy">
                    <div><strong>{stage.name}</strong><span className={`status-badge ${stage.stageType === "won" ? "success" : stage.stageType === "lost" ? "danger" : "neutral"}`}>{typeLabel(stage.stageType)}</span></div>
                    <small>{stage.code} · {stage.forecastCategory.replaceAll("_", " ")}{stage.staleAfterDays ? ` · stale after ${stage.staleAfterDays}d` : ""}</small>
                  </div>
                  <div className="crm-sales-stages-default"><strong>{Number(stage.probability).toFixed(Number(stage.probability) % 1 ? 2 : 0)}%</strong><span>Probability</span></div>
                  <div className="crm-sales-stages-usage"><strong>{stage.openOpportunityCount}</strong><span>open · {stage.opportunityCount} retained</span></div>
                  <div className="crm-sales-stages-actions">
                    <button className="icon-button" aria-label={`Move ${stage.name} earlier`} disabled={!previous || terminal !== (previous.stageType !== "open") || pending.startsWith("order:")} type="button" onClick={() => void move(stage, -1)}>↑</button>
                    <button className="icon-button" aria-label={`Move ${stage.name} later`} disabled={!next || terminal !== (next.stageType !== "open") || pending.startsWith("order:")} type="button" onClick={() => void move(stage, 1)}>↓</button>
                    <button className="secondary-button" type="button" onClick={() => openEditor(stage)}>Edit</button>
                    <button className="link-button" disabled={pending === stage.id || stage.openOpportunityCount > 0} title={stage.openOpportunityCount > 0 ? "Move open Opportunities before deactivating this stage." : undefined} type="button" onClick={() => void setActive(stage, false)}>Deactivate</button>
                  </div>
                </article>
              );
            })}
          </section>

          {inactiveStages.length ? (
            <section className="crm-sales-stages-inactive">
              <h2>Inactive stages</h2>
              {inactiveStages.map((stage) => (
                <article key={stage.id}>
                  <div><strong>{stage.name}</strong><span>{typeLabel(stage.stageType)} · {stage.code} · {stage.opportunityCount} retained Opportunity(s)</span></div>
                  <button className="secondary-button" disabled={pending === stage.id || selectedPipeline.status !== "active"} type="button" onClick={() => void setActive(stage, true)}>Reactivate</button>
                </article>
              ))}
            </section>
          ) : null}

          <aside className="crm-sales-stages-note">
            <AppIcon name="audit" size={18} />
            <p><strong>Stage configuration is prospective.</strong> Editing a stage default does not rewrite an existing Opportunity&apos;s stored probability. F010 adopts the destination stage default on the next real move; F011 remains the governed manual probability override.</p>
          </aside>

          <section className="crm-sales-stages-history" aria-label="Sales stage configuration history">
            <div><p className="eyebrow">Audit evidence</p><h2>Recent stage configuration changes</h2></div>
            {history.length ? history.map((entry) => (
              <article key={entry.id}>
                <strong>{entry.stageName || entry.stageCode || "Sales stage"}</strong>
                <span>{entry.action.replaceAll("_", " ")} · {entry.changedByName || "System"}</span>
                <time dateTime={entry.changedAt}>{new Date(entry.changedAt).toLocaleString()}</time>
              </article>
            )) : <p className="empty-state">No F012 stage-configuration history yet.</p>}
          </section>
        </>
      )}

      <dialog className="crm-sales-stages-drawer" ref={drawerRef} onClose={() => setEditing(undefined)}>
        <form method="dialog" className="crm-sales-stages-drawer__close"><button aria-label="Close sales stage form" type="submit">×</button></form>
        <form onSubmit={submit}>
          <header>
            <p className="eyebrow">{selectedPipeline?.name || "Sales pipeline"}</p>
            <h2>{editing ? "Edit sales stage" : "Add sales stage"}</h2>
            <p>The stable code and pipeline ownership cannot be changed after creation. Won/Lost semantics are enforced server-side.</p>
          </header>
          <label><span>Stage name</span><input autoFocus maxLength={120} name="name" required defaultValue={editing?.name || ""} /></label>
          <label><span>Stage type</span><select name="stageType" disabled={Boolean(editing && editing.opportunityCount > 0)} value={stageTypeValue} onChange={(event) => setStageTypeValue(event.target.value as Stage["stageType"])}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select>{editing && editing.opportunityCount > 0 ? <small>Type is locked because this stage already has retained Opportunity history.</small> : null}</label>
          <label><span>Probability %</span><input min={0} max={100} step="0.01" name="probability" type="number" disabled={stageTypeValue !== "open"} defaultValue={editing?.probability ?? 0} /><small>{stageTypeValue === "won" ? "Won is fixed at 100%." : stageTypeValue === "lost" ? "Lost is fixed at 0%." : "Default applied when F010 moves an Opportunity into this stage."}</small></label>
          <label><span>Forecast category</span><select name="forecastCategory" disabled={stageTypeValue !== "open"} defaultValue={editing?.forecastCategory || "pipeline"}><option value="pipeline">Pipeline</option><option value="best_case">Best case</option><option value="committed">Committed</option><option value="omitted">Omitted</option>{stageTypeValue !== "open" ? <option value="closed">Closed</option> : null}</select></label>
          <label><span>Stale after days</span><input min={1} max={365} name="staleAfterDays" type="number" disabled={stageTypeValue !== "open"} defaultValue={editing?.staleAfterDays ?? ""} /><small>Optional, 1–365 days. Terminal stages never become stale.</small></label>
          {editing && editing.opportunityCount > 0 ? <p className="crm-sales-stages-form-warning">This stage has retained Opportunity history. Its type cannot change between Open, Won and Lost.</p> : null}
          <footer>
            <button className="secondary-button" type="button" onClick={() => setEditing(undefined)}>Cancel</button>
            <button className="primary-button" disabled={pending === "save"} type="submit">{pending === "save" ? "Saving…" : "Save stage"}</button>
          </footer>
        </form>
      </dialog>
    </main>
  );
}
