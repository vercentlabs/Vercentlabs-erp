"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/core/client-request";

export default function CrmOpportunityActions({
  id,
  stageId,
  stages,
}: {
  id: string;
  stageId: string;
  stages: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [selectedStageId, setSelectedStageId] = useState(stageId);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: "move" | "approval") {
    if (!selectedStageId || selectedStageId === stageId) return;
    setPending(true);
    setMessage("");
    try {
      const result =
        action === "move"
          ? await requestJson(`/api/crm/opportunities/${id}/stage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stageId: selectedStageId,
                note: "Updated from opportunity detail",
              }),
            })
          : await requestJson("/api/approvals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                commandKey: "crm.opportunity.stage_change",
                commandPayload: {
                  opportunityId: id,
                  stageId: selectedStageId,
                  note: "Requested from opportunity detail",
                },
              }),
            });
      if (!result.ok) {
        throw new Error(result.message || "The action could not be completed.");
      }
      setMessage(
        result.message ||
          (action === "move"
            ? "Stage updated."
            : "Stage-change approval requested."),
      );
      if (action === "move") router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The action could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  const unchanged = !selectedStageId || selectedStageId === stageId;

  return (
    <div className="crm-action-panel">
      <label>
        Target stage
        <select
          value={selectedStageId}
          disabled={pending}
          onChange={(event) => setSelectedStageId(event.target.value)}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <button
          className="primary-button"
          type="button"
          disabled={pending || unchanged}
          onClick={() => void run("move")}
        >
          Move now
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={pending || unchanged}
          onClick={() => void run("approval")}
        >
          Request approval
        </button>
      </div>
      <p className="field-help">
        Use approval when another authorised user must review the stage change.
      </p>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
