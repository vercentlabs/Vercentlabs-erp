"use client";

import { BoardArchetype, StatePanel, StatusBadge } from "@/shared/design";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type DragEvent, type FormEvent } from "react";

import { requestJson } from "@/shared/http/client-request";

type Pipeline = { id: string; name: string };
type Stage = {
  id: string;
  pipelineId: string;
  name: string;
  sequence: number;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
  staleAfterDays?: number | null;
};
type OutcomeReason = {
  id: string;
  name: string;
  outcomeType?: "won" | "lost" | "both";
};
type Opportunity = {
  id: string;
  code: string;
  name: string;
  pipelineId: string;
  stageId: string;
  amount: string | number;
  currencyCode?: string | null;
  expectedCloseDate?: string | null;
  updatedAt: string;
  status: string;
  warnings?: string[];
  inactiveDays?: number;
};
type CloseRequest = {
  opportunity: Opportunity;
  stage: Stage;
  outcomeType: "won" | "lost";
};

function formatMoney(value: unknown, currencyCode: unknown) {
  const currency = /^[A-Z]{3}$/.test(String(currencyCode || "").toUpperCase())
    ? String(currencyCode).toUpperCase()
    : "INR";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-IN")}`;
  }
}

function agingBadge(row: Opportunity, stage: Stage) {
  const inactiveDays = row.inactiveDays ?? 0;
  const warnings = row.warnings ?? [];
  const overdue = warnings.includes("Expected close date is overdue.");
  const staleThreshold = stage.staleAfterDays ?? 14;
  const stale = inactiveDays >= staleThreshold;
  if (!overdue && !stale) return null;
  const label = overdue
    ? `Close date overdue · ${inactiveDays}d inactive`
    : `Stale · ${inactiveDays}d inactive`;
  return (
    <StatusBadge tone={overdue ? "danger" : "warning"} title={warnings.join(" ")}>
      {label}
    </StatusBadge>
  );
}

function stageValue(rows: Opportunity[]) {
  if (!rows.length) return "No open value";
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = String(row.currencyCode || "INR").toUpperCase();
    totals.set(currency, (totals.get(currency) || 0) + Number(row.amount || 0));
  }
  return [...totals.entries()]
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
}

export default function CrmPipelineBoard({
  pipelines,
  selectedPipelineId,
  stages,
  outcomeReasons,
  opportunities,
  total,
  canManage,
}: {
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  stages: Stage[];
  outcomeReasons: OutcomeReason[];
  opportunities: Opportunity[];
  total: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState("");
  const [message, setMessage] = useState("");
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null);
  const [reasonId, setReasonId] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const selectedPipeline = pipelines.find(
    (pipeline) => pipeline.id === selectedPipelineId,
  );
  const orderedStages = useMemo(
    () => [...stages].sort((a, b) => a.sequence - b.sequence),
    [stages],
  );
  const groups = useMemo(
    () =>
      orderedStages.map((stage) => ({
        stage,
        rows: opportunities.filter(
          (opportunity) => opportunity.stageId === stage.id,
        ),
      })),
    [opportunities, orderedStages],
  );
  const availableReasons = useMemo(() => {
    if (!closeRequest) return [];
    return outcomeReasons.filter(
      (reason) =>
        !reason.outcomeType ||
        reason.outcomeType === closeRequest.outcomeType ||
        reason.outcomeType === "both",
    );
  }, [closeRequest, outcomeReasons]);

  function resetCloseRequest() {
    setCloseRequest(null);
    setReasonId("");
    setCloseNotes("");
  }

  async function commitMove(
    opportunity: Opportunity,
    stage: Stage,
    outcome?: { reasonId: string; notes: string },
  ) {
    if (!canManage || opportunity.stageId === stage.id) return false;
    setMoving(opportunity.id);
    setMessage("");
    try {
      const result = await requestJson(
        `/api/crm/opportunities/${opportunity.id}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stageId: stage.id,
            note: outcome?.notes || "Moved from CRM pipeline",
            expectedUpdatedAt: opportunity.updatedAt,
            expectedStageId: opportunity.stageId,
            outcomeReasonId: outcome?.reasonId || null,
            outcomeNotes: outcome?.notes || null,
          }),
        },
      );
      if (!result.ok)
        throw new Error(result.message || "Stage update failed.");
      setMessage(
        result.message ||
          (stage.isWon || stage.isLost
            ? "Opportunity closed and removed from the open pipeline."
            : "Opportunity stage updated."),
      );
      router.refresh();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Stage update failed.",
      );
      return false;
    } finally {
      setMoving("");
    }
  }

  function requestMove(opportunity: Opportunity, stageId: string) {
    if (!canManage || opportunity.stageId === stageId) return;
    const stage = orderedStages.find((candidate) => candidate.id === stageId);
    if (!stage) {
      setMessage("The selected stage is not available in this pipeline.");
      return;
    }
    if (stage.isWon || stage.isLost) {
      setReasonId("");
      setCloseNotes("");
      setCloseRequest({
        opportunity,
        stage,
        outcomeType: stage.isWon ? "won" : "lost",
      });
      return;
    }
    void commitMove(opportunity, stage);
  }

  async function confirmClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!closeRequest || !reasonId) return;
    const completed = await commitMove(closeRequest.opportunity, closeRequest.stage, {
      reasonId,
      notes: closeNotes.trim(),
    });
    if (completed) resetCloseRequest();
  }

  function dragStart(event: DragEvent, id: string) {
    event.dataTransfer.setData("text/opportunity-id", id);
    event.dataTransfer.effectAllowed = "move";
  }

  function drop(event: DragEvent, stageId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/opportunity-id");
    const opportunity = opportunities.find((row) => row.id === id);
    if (opportunity) requestMove(opportunity, stageId);
  }

  if (!selectedPipeline || !selectedPipelineId) {
    return (
      <BoardArchetype aria-label="Opportunity pipeline board">
        <StatePanel
          title="No active opportunity pipeline"
          description="Configure an active CRM pipeline before creating or moving opportunities."
          action={
            canManage ? (
              <Link href="/crm/pipelines">Open pipeline setup</Link>
            ) : undefined
          }
        />
      </BoardArchetype>
    );
  }

  return (
    <BoardArchetype aria-label="Opportunity pipeline board">
      <section className="crm-action-panel" aria-label="Pipeline controls">
        <div>
          <p className="eyebrow">Active pipeline</p>
          <h2>{selectedPipeline.name}</h2>
          <p className="field-help">
            Only open opportunities from this pipeline and your permitted
            company, branch and record scope are shown.
          </p>
        </div>
        <label>
          Pipeline
          <select
            aria-label="Select opportunity pipeline"
            value={selectedPipelineId}
            onChange={(event) => {
              resetCloseRequest();
              setMessage("");
              router.push(
                `/crm/pipeline?pipeline=${encodeURIComponent(event.target.value)}`,
              );
            }}
          >
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {total > opportunities.length ? (
        <p className="notice" role="status">
          Showing the first {opportunities.length.toLocaleString("en-IN")} of{" "}
          {total.toLocaleString("en-IN")} open opportunities in this pipeline.
          Use the opportunity table for the remaining records.
        </p>
      ) : null}

      {message ? (
        <p className="notice" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      {closeRequest ? (
        <form
          className="crm-action-panel crm-opportunity-stage-action"
          aria-label={`Close ${closeRequest.opportunity.name} as ${closeRequest.outcomeType}`}
          onSubmit={(event) => void confirmClose(event)}
        >
          <div>
            <p className="eyebrow">Governed close</p>
            <h2>
              {closeRequest.outcomeType === "won" ? "Close won" : "Close lost"}
              : {closeRequest.opportunity.name}
            </h2>
            <p className="field-help">
              A valid {closeRequest.outcomeType} reason is required before the
              terminal pipeline transition is committed.
            </p>
          </div>
          <div className="crm-opportunity-stage-action__fields">
            <label>
              {closeRequest.outcomeType === "won" ? "Won reason" : "Lost reason"}
              <select
                required
                value={reasonId}
                disabled={moving === closeRequest.opportunity.id}
                onChange={(event) => setReasonId(event.target.value)}
              >
                <option value="">Select a reason</option>
                {availableReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-opportunity-stage-action__note">
              Outcome notes
              <textarea
                rows={3}
                maxLength={1000}
                value={closeNotes}
                disabled={moving === closeRequest.opportunity.id}
                onChange={(event) => setCloseNotes(event.target.value)}
                placeholder="Optional context for the team…"
              />
            </label>
          </div>
          {!availableReasons.length ? (
            <p className="notice" role="alert">
              No active {closeRequest.outcomeType} reason is configured. Add a
              governed outcome reason before closing this opportunity.
            </p>
          ) : null}
          <div className="form-row">
            <button
              className="primary-button"
              type="submit"
              disabled={
                !reasonId ||
                !availableReasons.length ||
                moving === closeRequest.opportunity.id
              }
            >
              {moving === closeRequest.opportunity.id
                ? "Updating…"
                : `Confirm ${closeRequest.outcomeType}`}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={moving === closeRequest.opportunity.id}
              onClick={resetCloseRequest}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {!orderedStages.length ? (
        <StatePanel
          title="No active stages"
          description="This pipeline needs at least one active stage before it can be used."
        />
      ) : (
        <div className="crm-kanban" aria-label={`${selectedPipeline.name} opportunity pipeline`}>
          {groups.map(({ stage, rows }) => (
            <section
              className="crm-kanban-column"
              key={stage.id}
              onDragOver={(event) => {
                if (canManage) event.preventDefault();
              }}
              onDrop={(event) => drop(event, stage.id)}
            >
              <header>
                <div>
                  <strong>{stage.name}</strong>
                  <small>
                    {stage.isWon
                      ? "Terminal won stage"
                      : stage.isLost
                        ? "Terminal lost stage"
                        : `${stage.probability}% configured probability`}
                  </small>
                </div>
                <span>{rows.length}</span>
              </header>
              <div className="crm-kanban-total">{stageValue(rows)}</div>
              <div className="crm-kanban-cards">
                {rows.map((row) => (
                  <article
                    className="crm-opportunity-card"
                    draggable={canManage && moving !== row.id}
                    onDragStart={(event) => dragStart(event, row.id)}
                    aria-busy={moving === row.id}
                    key={row.id}
                  >
                    <StatusBadge tone="neutral">{row.code}</StatusBadge>
                    {agingBadge(row, stage)}
                    <Link href={`/crm/opportunities/${row.id}`}>
                      <strong>{row.name}</strong>
                    </Link>
                    <b>{formatMoney(row.amount, row.currencyCode)}</b>
                    <small>
                      {row.expectedCloseDate
                        ? new Intl.DateTimeFormat("en-IN", {
                            dateStyle: "medium",
                          }).format(new Date(row.expectedCloseDate))
                        : "No close date"}
                    </small>
                    {canManage ? (
                      <label className="kanban-stage-select">
                        <span className="sr-only">Move {row.name}</span>
                        <select
                          aria-label={`Move ${row.name} to stage`}
                          value={row.stageId}
                          disabled={moving === row.id}
                          onChange={(event) =>
                            requestMove(row, event.target.value)
                          }
                        >
                          {orderedStages.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </article>
                ))}
                {!rows.length ? (
                  <div className="crm-kanban-empty">
                    {stage.isWon || stage.isLost
                      ? "Move an opportunity here to close it"
                      : "Drop opportunities here"}
                  </div>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </BoardArchetype>
  );
}
