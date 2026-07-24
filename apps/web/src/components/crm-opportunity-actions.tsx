"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function move(next: string) {
    setPending(true);
    const result = await requestJson(`/api/crm/opportunities/${id}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stageId: next,
        note: "Updated from opportunity detail",
      }),
    });
    setMessage(result.message || "Stage updated.");
    setPending(false);
    if (result.ok) router.refresh();
  }
  return (
    <div className="crm-action-panel">
      <label>
        Move to stage
        <select
          value={stageId}
          disabled={pending}
          onChange={(event) => void move(event.target.value)}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
