"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { getAccount } from "@/features/crm/accounts/api/accounts-api";
import { getContact } from "@/features/crm/contacts/api/contacts-api";
import { getLead } from "@/features/crm/leads/api/leads-api";
import { getOpportunity } from "@/features/crm/opportunities/api/opportunities-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const KIND: Record<string, { label: string; path: string }> = {
  lead: { label: "Lead", path: "/crm/leads" },
  party: { label: "Account", path: "/crm/accounts" },
  contact: { label: "Contact", path: "/crm/contacts" },
  opportunity: { label: "Opportunity", path: "/crm/opportunities" },
};

async function loadName(type: string, id: string): Promise<string> {
  if (type === "lead") {
    const { record } = await getLead(id);
    return record.fullName || [record.firstName, record.lastName].filter(Boolean).join(" ");
  }
  if (type === "party") return (await getAccount(id)).record.displayName;
  if (type === "contact") {
    const { record } = await getContact(id);
    return [record.firstName, record.lastName].filter(Boolean).join(" ");
  }
  return (await getOpportunity(id)).record.name;
}

// The CRM record an activity belongs to, by name and with a link, so an activity is never an orphan.
export function RelatedRecordCard({ entityType, entityId }: { entityType: string | null | undefined; entityId: string | null | undefined }) {
  const workspace = useWorkspaceContext();
  const kind = entityType ? KIND[entityType] : undefined;
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "related-name", entityType ?? "none", entityId ?? "none"),
    queryFn: () => loadName(entityType!, entityId!),
    enabled: Boolean(kind && entityId),
    staleTime: 60_000,
  });
  if (!kind || !entityId) return <span className="text-text-muted">Not linked to a record</span>;
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-xs uppercase tracking-wide text-text-muted">{kind.label}</span>
      <Link href={`${kind.path}/${entityId}`} className="font-medium text-brand hover:underline">
        {query.isSuccess ? query.data : query.isError ? `Open ${kind.label.toLowerCase()}` : "…"}
      </Link>
    </span>
  );
}
