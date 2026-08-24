"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";

type Stage = { id: string; name: string; isWon?: boolean; isLost?: boolean };
type OutcomeReason = { id: string; name: string; outcomeType?: "won" | "lost" | "both" };

export default function CrmOpportunityActions({
  id,
  stageId,
  stages,
  outcomeReasons,
}: {
  id: string;
  stageId: string;
  stages: Stage[];
  outcomeReasons: OutcomeReason[];
}) {
  const router = useRouter();
  const [selectedStageId, setSelectedStageId] = useState(stageId);
  const [reasonId, setReasonId] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const selectedStage = stages.find((stage) => stage.id === selectedStageId);
  const outcomeType = selectedStage?.isWon ? "won" : selectedStage?.isLost ? "lost" : null;
  const availableReasons = useMemo(
    () =>
      outcomeType
        ? outcomeReasons.filter((reason) => !reason.outcomeType || reason.outcomeType === outcomeType || reason.outcomeType === "both")
        : [],
    [outcomeReasons, outcomeType],
  );
  const unchanged = !selectedStageId || selectedStageId === stageId;
  const missingOutcome = Boolean(outcomeType && !reasonId);

  async function run(action: "move" | "approval") {
    if (unchanged || missingOutcome) return;
    setPending(true);
    setMessage("");
    const payload = {
      stageId: selectedStageId,
      note: notes.trim() || null,
      outcomeReasonId: outcomeType ? reasonId : null,
      outcomeNotes: outcomeType ? notes.trim() || null : null,
    };
    try {
      const result =
        action === "move"
          ? await requestJson(`/api/crm/opportunities/${id}/stage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await requestJson("/api/approvals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                commandKey: "crm.opportunity.stage_change",
                commandPayload: { opportunityId: id, ...payload },
              }),
            });
      if (!result.ok) throw new Error(result.message || "The action could not be completed.");
      setMessage(result.message || (action === "move" ? "Stage updated." : "Stage-change approval requested."));
      if (action === "move") router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="crm-action-panel crm-opportunity-stage-action" aria-label="Opportunity stage action">
      <div className="crm-action-panel__heading">
        <div>
          <p className="eyebrow">Pipeline action</p>
          <h2>Move opportunity</h2>
        </div>
        {outcomeType ? <span className={`status-badge ${outcomeType === "won" ? "success" : "warning"}`}>{outcomeType === "won" ? "Closing won" : "Closing lost"}</span> : null}
      </div>

      <div className="crm-opportunity-stage-action__fields">
        <label>
          Target stage
          <select
            value={selectedStageId}
            disabled={pending}
            onChange={(event) => {
              setSelectedStageId(event.target.value);
              setReasonId("");
              setMessage("");
            }}
          >
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        </label>

        {outcomeType ? (
          <label>
            {outcomeType === "won" ? "Won reason" : "Lost reason"}
            <select value={reasonId} required onChange={(event) => setReasonId(event.target.value)} disabled={pending}>
              <option value="">Select a reason</option>
              {availableReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
          </label>
        ) : null}

        <label className="crm-opportunity-stage-action__note">
          {outcomeType ? "Outcome notes" : "Stage note"}
          <textarea
            rows={3}
            value={notes}
            maxLength={4000}
            placeholder={outcomeType ? "Add useful context for the team…" : "Optional context for this stage change…"}
            onChange={(event) => setNotes(event.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <div className="form-row">
        <button className="primary-button" type="button" disabled={pending || unchanged || missingOutcome} onClick={() => void run("move")}>
          {pending ? "Updating…" : "Move now"}
        </button>
        <button className="secondary-button" type="button" disabled={pending || unchanged || missingOutcome} onClick={() => void run("approval")}>
          Request approval
        </button>
      </div>
      {outcomeType && missingOutcome ? <p className="field-help">A governed {outcomeType} reason is required before the deal can close.</p> : <p className="field-help">Stage movement updates probability and forecast status through the governed CRM action.</p>}
      {message ? <p className="notice" role="status">{message}</p> : null}
    </section>
  );
}
