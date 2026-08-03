"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client-request";

export default function CrmPrivacyActions({
  requestId,
  requestType,
  ready,
  blockers,
}: {
  requestId: string;
  requestType: string;
  ready: boolean;
  blockers: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [erasureMode, setErasureMode] = useState<"anonymize" | "erase">(
    "anonymize",
  );
  async function execute() {
    const operation = requestType === "deletion" ? erasureMode : requestType;
    if (
      !confirm(
        `Execute the governed ${operation.replaceAll("_", " ")} privacy operation? This action is audited and irreversibly redacts personal data.`,
      )
    )
      return;
    setPending(true);
    const result = await requestJson(`/api/crm/privacy/${requestId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutionNotes: "Executed from privacy request workspace",
        ...(requestType === "deletion" ? { erasureMode } : {}),
      }),
    });
    setMessage(
      result.message ||
        (result.ok ? "Privacy request executed." : "Execution failed."),
    );
    setPending(false);
    if (result.ok) router.refresh();
  }
  return (
    <section className="panel crm-action-panel">
      <p className="eyebrow">Privacy execution</p>
      <h2>Fail-closed request processing</h2>
      {blockers.length ? (
        <div className="notice danger">
          {blockers.map((blocker) => (
            <p key={blocker}>{blocker}</p>
          ))}
        </div>
      ) : (
        <p className="notice">Identity, status and legal-hold checks passed.</p>
      )}
      {requestType === "deletion" ? (
        <label className="field-group">
          <span>Deletion treatment</span>
          <select
            value={erasureMode}
            onChange={(event) =>
              setErasureMode(event.target.value as "anonymize" | "erase")
            }
            disabled={pending}
          >
            <option value="anonymize">Anonymize personal fields</option>
            <option value="erase">Erase personal fields and mark erased</option>
          </select>
          <small>
            Both choices preserve the minimum transactional shell required for
            audit and financial integrity.
          </small>
        </label>
      ) : null}
      <button
        className="primary-button"
        disabled={!ready || pending}
        onClick={() => void execute()}
      >
        {pending ? "Executing…" : "Execute privacy request"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
