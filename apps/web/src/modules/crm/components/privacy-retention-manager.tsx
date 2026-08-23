"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/core/client-request";

type Policy = {
  id: string;
  subjectType: string;
  name: string;
  retentionDays: number;
  action: string;
  status: string;
  lastRunAt?: string | null;
};

export default function CrmPrivacyRetentionManager({
  policies,
}: {
  policies: Policy[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function toggle(policy: Policy) {
    setPending(true);
    const result = await requestJson("/api/crm/privacy/retention", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: policy.id,
        name: policy.name,
        retentionDays: policy.retentionDays,
        action: policy.action,
        status: policy.status === "active" ? "inactive" : "active",
      }),
    });
    setMessage(
      result.message || (result.ok ? "Policy updated." : "Update failed."),
    );
    setPending(false);
    if (result.ok) router.refresh();
  }
  async function run() {
    if (!confirm("Run all active CRM privacy retention policies now?")) return;
    setPending(true);
    const result = await requestJson(
      "/api/crm/privacy/retention",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      },
      { timeoutMs: 60_000 },
    );
    setMessage(
      result.message ||
        (result.ok ? "Retention run completed." : "Retention run failed."),
    );
    setPending(false);
    if (result.ok) router.refresh();
  }
  return (
    <section className="panel">
      <div className="module-section-heading">
        <div>
          <p className="eyebrow">Retention policies</p>
          <h2>Automated restriction and anonymisation</h2>
        </div>
        <button
          className="primary-button"
          disabled={pending}
          onClick={() => void run()}
        >
          Run active policies
        </button>
      </div>
      <div className="crm-stage-summary">
        {policies.map((policy) => (
          <div key={policy.id}>
            <span>
              <strong>{policy.name}</strong>
              <small>
                {policy.subjectType} · {policy.retentionDays} days ·{" "}
                {policy.action} · last run {policy.lastRunAt || "never"}
              </small>
            </span>
            <button
              className="link-button"
              disabled={pending}
              onClick={() => void toggle(policy)}
            >
              {policy.status === "active" ? "Disable" : "Enable"}
            </button>
          </div>
        ))}
      </div>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
