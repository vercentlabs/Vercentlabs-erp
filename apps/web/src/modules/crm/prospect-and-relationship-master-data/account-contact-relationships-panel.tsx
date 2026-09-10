"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { requestJson } from "@/shared/http/client-request";
import { StatePanel } from "@/shared/design";

type Relationship = Record<string, unknown>;

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

export default function AccountContactRelationshipsPanel({ accountId }: { accountId: string }) {
  const [relationships, setRelationships] = useState<Relationship[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<{ relationships?: Relationship[] }>(
        `/api/crm/accounts/${accountId}/relationships`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Related contacts could not be loaded.");
        setRelationships([]);
        return;
      }
      setRelationships(Array.isArray(result.relationships) ? result.relationships : []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (relationships === null) {
    return <StatePanel title="Loading related contacts…" />;
  }
  if (loadError) {
    return <StatePanel title="Related contacts could not be loaded." description={loadError} />;
  }
  if (!relationships.length) {
    return <StatePanel title="No contacts are linked to this account yet." />;
  }

  return (
    <ul className="crm-account-relationships-list">
      {relationships.map((relationship) => {
        const id = str(relationship, "id");
        const name = [str(relationship, "firstName"), str(relationship, "lastName")].filter(Boolean).join(" ");
        return (
          <li key={id}>
            <Link href={`/crm/contacts/${str(relationship, "contactId")}`}>{name || "Contact"}</Link>
            {relationship.isPrimary ? <span className="status-badge success">Primary</span> : null}
            <span>{str(relationship, "designation") || "—"}</span>
            <span>{STAKEHOLDER_ROLE_LABELS[str(relationship, "stakeholderRole")] || "No role set"}</span>
          </li>
        );
      })}
    </ul>
  );
}
