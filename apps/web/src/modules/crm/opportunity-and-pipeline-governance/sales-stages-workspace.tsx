"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrmCommandDialog } from "@/modules/crm/ui/crm-command-dialog-provider";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  cx,
  Dialog,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";
import styles from "./sales-stages-workspace.module.css";

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
  const { confirm: confirmAction } = useCrmCommandDialog();
  const [editing, setEditing] = useState<Stage | null | undefined>(undefined);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [stageTypeValue, setStageTypeValue] = useState<Stage["stageType"]>("open");
  const [migrating, setMigrating] = useState<{ stage: Stage; affectedCount: number } | null>(null);
  const [migrationJob, setMigrationJob] = useState<{ id: string; status: string } | null>(null);

  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId) || null;
  const activeStages = useMemo(
    () => stages.filter((stage) => stage.status === "active").sort((a, b) => a.sequence - b.sequence),
    [stages],
  );
  const inactiveStages = useMemo(
    () => stages.filter((stage) => stage.status === "inactive").sort((a, b) => a.sequence - b.sequence),
    [stages],
  );

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
    if (!active && !(await confirmAction({ title: `Deactivate ${stage.name}?`, description: "This stage will stop accepting new opportunities. Open opportunities may require migration.", confirmLabel: "Deactivate" }))) return;
    setPending(stage.id);
    setMessage("");
    const result = await requestJson<{ code?: string; affectedCount?: number }>(`/api/crm/sales-stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: active ? "reactivate" : "deactivate", expectedUpdatedAt: stage.updatedAt }),
    });
    setPending("");
    if (!result.ok && result.code === "CRM_SALES_STAGE_OPEN_OPPORTUNITIES") {
      setMigrating({ stage, affectedCount: Number(result.affectedCount || stage.openOpportunityCount) });
      return;
    }
    setMessage(result.message || (result.ok ? "Sales stage updated." : "Sales stage could not be updated."));
    if (result.ok) router.refresh();
  }

  async function migrateAndDeactivate(targetStageId: string) {
    if (!migrating) return;
    setPending(migrating.stage.id);
    setMessage("");
    const result = await requestJson<{ migrationJob?: { id: string; status: string } }>(`/api/crm/sales-stages/${migrating.stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deactivate", expectedUpdatedAt: migrating.stage.updatedAt, migrateToStageId: targetStageId }),
    });
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "Migration could not be started.");
      return;
    }
    setMessage(result.message || "Migration started.");
    if (result.migrationJob) setMigrationJob(result.migrationJob);
    setMigrating(null);
    router.refresh();
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
          <p>Define one ordered, governed stage catalogue per pipeline. Stage defaults feed pipeline movement and probability without rewriting existing deals retroactively.</p>
        </div>
        <ActionButton tone="primary" type="button" disabled={!selectedPipeline || selectedPipeline.status !== "active"} onClick={() => openEditor(null)}>
          <AppIcon name="modules" size={16} /> Add stage
        </ActionButton>
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
        <StatePanel
          title="No visible pipeline"
          description="Create or select a CRM pipeline before configuring Sales Stages."
        />
      ) : (
        <>
          {(() => {
            const actionsFor = (stage: Stage, index: number) => {
              const terminal = stage.stageType !== "open";
              const previous = activeStages[index - 1];
              const next = activeStages[index + 1];
              return (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Move ${stage.name} earlier`}
                    disabled={
                      !previous ||
                      terminal !== (previous.stageType !== "open") ||
                      pending.startsWith("order:")
                    }
                    type="button"
                    onClick={() => void move(stage, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${stage.name} later`}
                    disabled={
                      !next ||
                      terminal !== (next.stageType !== "open") ||
                      pending.startsWith("order:")
                    }
                    type="button"
                    onClick={() => void move(stage, 1)}
                  >
                    ↓
                  </button>
                  <ActionButton type="button" onClick={() => openEditor(stage)}>
                    Edit
                  </ActionButton>
                  <ActionButton
                    tone="quiet"
                    disabled={pending === stage.id || stage.openOpportunityCount > 0}
                    title={
                      stage.openOpportunityCount > 0
                        ? "Move open Opportunities before deactivating this stage."
                        : undefined
                    }
                    type="button"
                    onClick={() => void setActive(stage, false)}
                  >
                    Deactivate
                  </ActionButton>
                </>
              );
            };
            const columns: DataGridColumn<Stage>[] = [
              {
                id: "order",
                header: "Order",
                width: "70px",
                cell: (stage, index) => (
                  <span className="crm-sales-stages-order">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                ),
              },
              {
                id: "stage",
                header: "Stage",
                cell: (stage) => (
                  <div className="crm-sales-stages-copy">
                    <div>
                      <strong>{stage.name}</strong>
                      <StatusBadge
                        tone={
                          stage.stageType === "won"
                            ? "success"
                            : stage.stageType === "lost"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {typeLabel(stage.stageType)}
                      </StatusBadge>
                    </div>
                    <small>
                      {stage.code} · {stage.forecastCategory.replaceAll("_", " ")}
                      {stage.staleAfterDays ? ` · stale after ${stage.staleAfterDays}d` : ""}
                    </small>
                  </div>
                ),
              },
              {
                id: "default",
                header: "Default",
                cell: (stage) => (
                  <div className="crm-sales-stages-default">
                    <strong>
                      {Number(stage.probability).toFixed(Number(stage.probability) % 1 ? 2 : 0)}%
                    </strong>
                    <span>Probability</span>
                  </div>
                ),
              },
              {
                id: "usage",
                header: "Usage",
                cell: (stage) => (
                  <div className="crm-sales-stages-usage">
                    <strong>{stage.openOpportunityCount}</strong>
                    <span>open · {stage.opportunityCount} retained</span>
                  </div>
                ),
              },
              {
                id: "actions",
                header: "Actions",
                cell: (stage, index) => (
                  <div className="crm-sales-stages-actions">{actionsFor(stage, index)}</div>
                ),
              },
            ];
            return (
              <EnterpriseDataGrid
                caption="Active sales stages"
                rows={activeStages}
                rowKey={(stage) => stage.id}
                columns={columns}
                renderMobileCard={(stage, index) => (
                  <article className={cx("crm-sales-stages-card", styles.card)}>
                    <header>
                      <span className="crm-sales-stages-order">{String(index + 1).padStart(2, "0")}</span>
                      <StatusBadge
                        tone={
                          stage.stageType === "won"
                            ? "success"
                            : stage.stageType === "lost"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {typeLabel(stage.stageType)}
                      </StatusBadge>
                    </header>
                    <div className="crm-sales-stages-copy">
                      <strong>{stage.name}</strong>
                      <small>
                        {stage.code} · {stage.forecastCategory.replaceAll("_", " ")}
                        {stage.staleAfterDays ? ` · stale after ${stage.staleAfterDays}d` : ""}
                      </small>
                    </div>
                    <dl className={cx("crm-sales-stages-card__metrics", styles.metrics)}>
                      <div>
                        <dt>Probability</dt>
                        <dd>{Number(stage.probability).toFixed(Number(stage.probability) % 1 ? 2 : 0)}%</dd>
                      </div>
                      <div>
                        <dt>Usage</dt>
                        <dd>{stage.openOpportunityCount} open · {stage.opportunityCount} retained</dd>
                      </div>
                    </dl>
                    <footer className="crm-sales-stages-actions">{actionsFor(stage, index)}</footer>
                  </article>
                )}
              />
            );
          })()}

          {inactiveStages.length ? (
            <section className="crm-sales-stages-inactive">
              <h2>Inactive stages</h2>
              {inactiveStages.map((stage) => (
                <article key={stage.id}>
                  <div><strong>{stage.name}</strong><span>{typeLabel(stage.stageType)} · {stage.code} · {stage.opportunityCount} retained Opportunity(s)</span></div>
                  <ActionButton disabled={pending === stage.id || selectedPipeline.status !== "active"} type="button" onClick={() => void setActive(stage, true)}>Reactivate</ActionButton>
                </article>
              ))}
            </section>
          ) : null}

          <aside className="crm-sales-stages-note">
            <AppIcon name="audit" size={18} />
            <p><strong>Stage configuration is prospective.</strong> Editing a stage default does not rewrite an existing Opportunity&apos;s stored probability. The pipeline adopts the destination stage default on the next real move; probability remains the governed manual override.</p>
          </aside>

          <section className="crm-sales-stages-history" aria-label="Sales stage configuration history">
            <div><p className="eyebrow">Audit evidence</p><h2>Recent stage configuration changes</h2></div>
            {history.length ? history.map((entry) => (
              <article key={entry.id}>
                <strong>{entry.stageName || entry.stageCode || "Sales stage"}</strong>
                <span>{entry.action.replaceAll("_", " ")} · {entry.changedByName || "System"}</span>
                <time dateTime={entry.changedAt}>{new Date(entry.changedAt).toLocaleString()}</time>
              </article>
            )) : <StatePanel title="No stage-configuration history yet." />}
          </section>
        </>
      )}

      {editing !== undefined ? (
        <Dialog
          title={editing ? "Edit sales stage" : "Add sales stage"}
          description="The stable code and pipeline ownership cannot be changed after creation. Won/Lost semantics are enforced server-side."
          onClose={() => setEditing(undefined)}
          variant="drawer-end"
          canDismiss={pending !== "save"}
          busy={pending === "save"}
          className="crm-sales-stages-drawer"
        >
          <form onSubmit={submit}>
            <p className="eyebrow">{selectedPipeline?.name || "Sales pipeline"}</p>
            <label><span>Stage name</span><input autoFocus maxLength={120} name="name" required defaultValue={editing?.name || ""} /></label>
            <label><span>Stage type</span><select name="stageType" disabled={Boolean(editing && editing.opportunityCount > 0)} value={stageTypeValue} onChange={(event) => setStageTypeValue(event.target.value as Stage["stageType"])}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select>{editing && editing.opportunityCount > 0 ? <small>Type is locked because this stage already has retained Opportunity history.</small> : null}</label>
            <label><span>Probability %</span><input min={0} max={100} step="0.01" name="probability" type="number" disabled={stageTypeValue !== "open"} defaultValue={editing?.probability ?? 0} /><small>{stageTypeValue === "won" ? "Won is fixed at 100%." : stageTypeValue === "lost" ? "Lost is fixed at 0%." : "Default applied when the pipeline moves an Opportunity into this stage."}</small></label>
            <label><span>Forecast category</span><select name="forecastCategory" disabled={stageTypeValue !== "open"} defaultValue={editing?.forecastCategory || "pipeline"}><option value="pipeline">Pipeline</option><option value="best_case">Best case</option><option value="committed">Committed</option><option value="omitted">Omitted</option>{stageTypeValue !== "open" ? <option value="closed">Closed</option> : null}</select></label>
            <label><span>Stale after days</span><input min={1} max={365} name="staleAfterDays" type="number" disabled={stageTypeValue !== "open"} defaultValue={editing?.staleAfterDays ?? ""} /><small>Optional, 1–365 days. Terminal stages never become stale.</small></label>
            {editing && editing.opportunityCount > 0 ? <p className="crm-sales-stages-form-warning">This stage has retained Opportunity history. Its type cannot change between Open, Won and Lost.</p> : null}
            <footer>
              <ActionButton type="button" disabled={pending === "save"} onClick={() => setEditing(undefined)}>Cancel</ActionButton>
              <ActionButton tone="primary" busy={pending === "save"} type="submit">{pending === "save" ? "Saving…" : "Save stage"}</ActionButton>
            </footer>
          </form>
        </Dialog>
      ) : null}

      {migrating ? (
        <StageMigrationDialog
          stage={migrating.stage}
          affectedCount={migrating.affectedCount}
          replacementOptions={activeStages.filter((row) => row.id !== migrating.stage.id && row.pipelineId === migrating.stage.pipelineId)}
          pending={pending === migrating.stage.id}
          onCancel={() => setMigrating(null)}
          onConfirm={(targetStageId) => void migrateAndDeactivate(targetStageId)}
        />
      ) : null}
      {migrationJob ? (
        <p className="notice" role="status">
          Migration job {migrationJob.id.slice(0, 8)}… {migrationJob.status}. Leads move in the background — reload this page shortly to confirm the stage deactivated.
        </p>
      ) : null}
    </main>
  );
}

function StageMigrationDialog({
  stage,
  affectedCount,
  replacementOptions,
  pending,
  onCancel,
  onConfirm,
}: {
  stage: Stage;
  affectedCount: number;
  replacementOptions: Stage[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (targetStageId: string) => void;
}) {
  const [targetStageId, setTargetStageId] = useState("");
  return (
    <Dialog
      title={`Migrate Opportunities off ${stage.name}`}
      description={`${affectedCount} open Opportunity(ies) are on this stage. Choose a replacement stage — they'll move through the governed stage-change command in the background, and ${stage.name} deactivates once every one has moved.`}
      onClose={onCancel}
      busy={pending}
    >
      <FormField label="Replacement stage" htmlFor="stage-migration-target">
        <select id="stage-migration-target" value={targetStageId} onChange={(event) => setTargetStageId(event.target.value)} disabled={pending}>
          <option value="">Choose a stage…</option>
          {replacementOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </FormField>
      <div className="form-row">
        <ActionButton type="button" onClick={onCancel} disabled={pending}>Cancel</ActionButton>
        <ActionButton tone="primary" type="button" disabled={pending || !targetStageId} busy={pending} onClick={() => onConfirm(targetStageId)}>
          Start migration
        </ActionButton>
      </div>
    </Dialog>
  );
}
