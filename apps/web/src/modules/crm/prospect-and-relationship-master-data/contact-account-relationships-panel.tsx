"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import ContactAccountLookup from "@/modules/crm/prospect-and-relationship-master-data/contact-account-lookup";
import { requestJson } from "@/shared/http/client-request";
import { ActionButton, StatePanel } from "@/shared/design";

type Relationship = Record<string, unknown>;

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  employment: "Works here",
  affiliated: "Affiliated",
  other: "Other",
};

const STAKEHOLDER_ROLE_LABELS: Record<string, string> = {
  economic_buyer: "Economic buyer",
  decision_maker: "Decision maker",
  champion: "Champion",
  influencer: "Influencer",
  user: "User",
  blocker: "Blocker",
  procurement: "Procurement",
  legal: "Legal",
  technical: "Technical",
  other: "Other",
};

function str(row: Relationship, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

export default function ContactAccountRelationshipsPanel({
  contactId,
  canManage,
}: {
  contactId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [relationships, setRelationships] = useState<Relationship[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<{ relationships?: Relationship[] }>(
        `/api/crm/contacts/${contactId}/relationships`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Account relationships could not be loaded.");
        setRelationships([]);
        return;
      }
      setRelationships(Array.isArray(result.relationships) ? result.relationships : []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function addRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("accountId") || "");
    if (!accountId) {
      setMessage("Choose an account to link.");
      return;
    }
    setPending("add");
    setMessage("");
    const result = await requestJson<{ relationships?: Relationship[] }>(
      `/api/crm/contacts/${contactId}/relationships`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          relationshipType: String(form.get("relationshipType") || "employment"),
          stakeholderRole: String(form.get("stakeholderRole") || "") || null,
        }),
      },
    );
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "The relationship could not be added.");
      return;
    }
    setRelationships(result.relationships || []);
    setAdding(false);
    router.refresh();
  }

  async function setPrimary(relationshipId: string) {
    setPending(relationshipId);
    setMessage("");
    const result = await requestJson<{ relationships?: Relationship[] }>(
      `/api/crm/contacts/${contactId}/relationships/${relationshipId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      },
    );
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "Could not change the primary Account.");
      return;
    }
    setRelationships(result.relationships || []);
    router.refresh();
  }

  async function updateRole(relationshipId: string, stakeholderRole: string) {
    setPending(relationshipId);
    const result = await requestJson<{ relationships?: Relationship[] }>(
      `/api/crm/contacts/${contactId}/relationships/${relationshipId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeholderRole: stakeholderRole || null }),
      },
    );
    setPending("");
    if (result.ok) setRelationships(result.relationships || []);
  }

  async function remove(relationship: Relationship) {
    const isPrimary = relationship.isPrimary === true;
    const others = (relationships || []).filter((r) => r.id !== relationship.id);
    let promoteRelationshipId: string | undefined;
    if (isPrimary && others.length) {
      const proceed = window.confirm(
        `Remove this relationship? "${str(others[0], "accountName")}" will become the new primary Account.`,
      );
      if (!proceed) return;
      promoteRelationshipId = String(others[0].id);
    } else if (
      !window.confirm(
        isPrimary
          ? "Remove this relationship? The Contact will have no primary Account afterward."
          : "Remove this relationship?",
      )
    ) {
      return;
    }
    setPending(String(relationship.id));
    setMessage("");
    const result = await requestJson<{ relationships?: Relationship[] }>(
      `/api/crm/contacts/${contactId}/relationships/${relationship.id}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoteRelationshipId }),
      },
    );
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "The relationship could not be removed.");
      return;
    }
    setRelationships(result.relationships || []);
    router.refresh();
  }

  if (relationships === null) {
    return <StatePanel title="Loading Account relationships…" />;
  }
  if (loadError) {
    return <StatePanel title="Account relationships could not be loaded." description={loadError} />;
  }

  return (
    <div className="crm-contact-relationships-panel">
      {message ? <p role="status">{message}</p> : null}
      {relationships.length ? (
        <ul className="crm-contact-relationships-list">
          {relationships.map((relationship) => {
            const id = str(relationship, "id");
            const isPrimary = relationship.isPrimary === true;
            return (
              <li key={id}>
                <div>
                  <Link href={`/crm/accounts/${str(relationship, "partyId")}`}>
                    {str(relationship, "accountName") || "Account"}
                  </Link>
                  {isPrimary ? <span className="status-badge success">Primary</span> : null}
                  <span>{RELATIONSHIP_TYPE_LABELS[str(relationship, "relationshipType")] || str(relationship, "relationshipType")}</span>
                </div>
                {canManage ? (
                  <label>
                    <span>Stakeholder role</span>
                    <select
                      value={str(relationship, "stakeholderRole")}
                      disabled={pending === id}
                      onChange={(event) => void updateRole(id, event.currentTarget.value)}
                    >
                      <option value="">Not set</option>
                      {Object.entries(STAKEHOLDER_ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span>{STAKEHOLDER_ROLE_LABELS[str(relationship, "stakeholderRole")] || "No role set"}</span>
                )}
                {canManage ? (
                  <div className="crm-contact-relationship-actions">
                    {!isPrimary ? (
                      <ActionButton
                        tone="quiet"
                        busy={pending === id}
                        onClick={() => void setPrimary(id)}
                      >
                        Make primary
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      tone="danger"
                      busy={pending === id}
                      onClick={() => void remove(relationship)}
                    >
                      Remove
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <StatePanel title="No Account relationships yet." />
      )}

      {canManage ? (
        adding ? (
          <form className="crm-contact-relationship-form" onSubmit={addRelationship}>
            <ContactAccountLookup label="Add Account" />
            <label>
              <span>Relationship type</span>
              <select name="relationshipType" defaultValue="employment">
                <option value="employment">Works here</option>
                <option value="affiliated">Affiliated</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <span>Stakeholder role</span>
              <select name="stakeholderRole" defaultValue="">
                <option value="">Not set</option>
                {Object.entries(STAKEHOLDER_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <footer>
              <ActionButton onClick={() => setAdding(false)} disabled={pending === "add"}>
                Cancel
              </ActionButton>
              <ActionButton tone="primary" type="submit" busy={pending === "add"}>
                Add relationship
              </ActionButton>
            </footer>
          </form>
        ) : (
          <ActionButton onClick={() => setAdding(true)}>Add Account relationship</ActionButton>
        )
      ) : null}
    </div>
  );
}
