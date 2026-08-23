"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/shared/http/client-request";

type Duplicate = {
  id: string;
  firstName: string;
  lastName?: string;
  accountName?: string;
  matchScore: number;
};

export default function CrmContactMergeActions({
  contactId,
  duplicates,
  canManage,
}: {
  contactId: string;
  duplicates: Duplicate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function merge(survivorId: string) {
    if (
      !confirm(
        "Merge this contact into the selected survivor? Related CRM and transactional references will be repointed.",
      )
    )
      return;
    setPending(true);
    const result = await requestJson(`/api/crm/contacts/${contactId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        survivorId,
        reason: "Confirmed from governed contact duplicate review",
      }),
    });
    setMessage(
      result.message || (result.ok ? "Contacts merged." : "Merge failed."),
    );
    setPending(false);
    if (result.ok) router.push(`/crm/contacts/${survivorId}`);
  }
  return (
    <section className="panel crm-action-panel">
      <p className="eyebrow">Data quality</p>
      <h2>Contact duplicate review</h2>
      {duplicates.length ? (
        <div className="duplicate-list">
          {duplicates.map((duplicate) => (
            <div key={duplicate.id}>
              <span>
                <strong>
                  {`${duplicate.firstName} ${duplicate.lastName || ""}`.trim()}
                </strong>
                <small>
                  {duplicate.accountName || "No account"} · score{" "}
                  {duplicate.matchScore}
                </small>
              </span>
              {canManage ? (
                <button
                  className="link-button danger"
                  disabled={pending}
                  onClick={() => void merge(duplicate.id)}
                >
                  Merge into this contact
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="notice">
          No contact duplicates detected from normalised email, phone or name.
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
