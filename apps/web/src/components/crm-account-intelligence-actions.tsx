"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client-request";

type AccountOption = { id: string; name: string };
type Duplicate = { id: string; displayName: string; matchScore: number };

export default function CrmAccountIntelligenceActions({
  accountId,
  currentParentId,
  accounts,
  duplicates,
  canManage,
  canRecordService,
}: {
  accountId: string;
  currentParentId: string | null;
  accounts: AccountOption[];
  duplicates: Duplicate[];
  canManage: boolean;
  canRecordService: boolean;
}) {
  const router = useRouter();
  const [parentId, setParentId] = useState(currentParentId || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function saveParent() {
    setPending(true);
    const result = await requestJson(
      `/api/crm/accounts/${accountId}/hierarchy`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentPartyId: parentId || null,
          reason: "Updated from Customer 360 workspace",
        }),
      },
    );
    setMessage(
      result.message || (result.ok ? "Hierarchy updated." : "Update failed."),
    );
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function merge(survivorId: string) {
    if (
      !confirm(
        "Merge this account into the selected survivor? All governed references will be repointed and this account will be deactivated.",
      )
    )
      return;
    setPending(true);
    const result = await requestJson(`/api/crm/accounts/${accountId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        survivorId,
        reason: "Confirmed from Customer 360 duplicate review",
      }),
    });
    setMessage(
      result.message || (result.ok ? "Accounts merged." : "Merge failed."),
    );
    setPending(false);
    if (result.ok) router.push(`/crm/accounts/${survivorId}`);
  }

  async function addServiceEvent() {
    const title = prompt("Customer service event title");
    if (!title?.trim()) return;
    const description = prompt("Description (optional)") || "";
    setPending(true);
    const result = await requestJson(
      `/api/crm/accounts/${accountId}/service-events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "service_note",
          title,
          description,
          status: "open",
          priority: "medium",
        }),
      },
    );
    setMessage(
      result.message ||
        (result.ok ? "Service event recorded." : "Event failed."),
    );
    setPending(false);
    if (result.ok) router.refresh();
  }

  return (
    <section className="panel crm-action-panel">
      <div className="module-section-heading">
        <div>
          <p className="eyebrow">Governed actions</p>
          <h2>Hierarchy, service and duplicate controls</h2>
        </div>
      </div>
      {canManage ? (
        <div className="form-row">
          <label>
            Parent account
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">No parent account</option>
              {accounts
                .filter((item) => item.id !== accountId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => void saveParent()}
          >
            Save hierarchy
          </button>
        </div>
      ) : null}
      {canRecordService ? (
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => void addServiceEvent()}
        >
          Record service event
        </button>
      ) : null}
      {duplicates.length ? (
        <details>
          <summary>Potential account duplicates ({duplicates.length})</summary>
          <div className="duplicate-list">
            {duplicates.map((duplicate) => (
              <div key={duplicate.id}>
                <span>
                  <strong>{duplicate.displayName}</strong>
                  <small>Match score {duplicate.matchScore}</small>
                </span>
                {canManage ? (
                  <button
                    className="link-button danger"
                    disabled={pending}
                    onClick={() => void merge(duplicate.id)}
                  >
                    Merge into this account
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : (
        <p className="notice">
          No account duplicates detected from GSTIN, PAN or normalised legal
          name.
        </p>
      )}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
