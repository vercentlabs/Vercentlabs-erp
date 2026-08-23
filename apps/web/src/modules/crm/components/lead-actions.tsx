"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/core/client-request";
export default function CrmLeadActions({
  leadId,
  status,
  duplicates,
}: {
  leadId: string;
  status: string;
  duplicates: Array<{
    id: string;
    fullName?: string;
    companyName?: string;
    code?: string;
  }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function convert() {
    if (!confirm("Convert this lead into a customer, contact and opportunity?"))
      return;
    setPending(true);
    const result = await requestJson(`/api/crm/leads/${leadId}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createOpportunity: true }),
    });
    setMessage(result.message || "Conversion completed.");
    setPending(false);
    if (result.ok) router.refresh();
  }
  async function merge(targetLeadId: string) {
    if (
      !confirm(
        "Merge this lead into the selected record? The current lead will be archived.",
      )
    )
      return;
    setPending(true);
    const result = await requestJson(`/api/crm/leads/${leadId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLeadId }),
    });
    setMessage(result.message || "Merge completed.");
    setPending(false);
    if (result.ok) router.push(`/crm/leads/${targetLeadId}`);
  }
  return (
    <div className="crm-action-panel">
      <div className="form-row">
        {status !== "converted" && status !== "archived" ? (
          <button
            className="primary-button"
            disabled={pending}
            onClick={() => void convert()}
          >
            {pending ? "Working…" : "Convert lead"}
          </button>
        ) : null}
        <Link className="secondary-button" href="/crm/activities">
          Plan follow-up
        </Link>
      </div>
      {duplicates.length ? (
        <details>
          <summary>Potential duplicates ({duplicates.length})</summary>
          <div className="duplicate-list">
            {duplicates.map((duplicate) => (
              <div key={duplicate.id}>
                <span>
                  <strong>{duplicate.fullName || duplicate.code}</strong>
                  <small>{duplicate.companyName || "No company"}</small>
                </span>
                <button
                  className="link-button danger"
                  disabled={pending}
                  onClick={() => void merge(duplicate.id)}
                >
                  Merge into this lead
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {message ? (
        <p role="status" className="notice">
          {message}
        </p>
      ) : null}
    </div>
  );
}
