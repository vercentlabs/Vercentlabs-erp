"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function ApprovalActions({
  id,
  expectedVersion,
}: {
  id: string;
  expectedVersion: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(action: "approve" | "reject") {
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note, expectedVersion }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data.message || "The approval could not be updated.");
        return;
      }
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="approval-actions">
      <input
        aria-label="Decision note"
        maxLength={1000}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Decision note (required when rejecting)"
        value={note}
      />
      <div className="action-row">
        <button
          className="primary-button compact"
          disabled={pending}
          onClick={() => decide("approve")}
          type="button"
        >
          Approve
        </button>
        <button
          className="secondary-button compact danger"
          disabled={pending}
          onClick={() => decide("reject")}
          type="button"
        >
          Reject
        </button>
      </div>
      {error ? (
        <small className="inline-error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
