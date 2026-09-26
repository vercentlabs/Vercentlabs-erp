"use client";

import { humanize } from "@/shared/format/human";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listAccountContactRelationships } from "@/features/crm/contacts/api/contact-relationships-api";

// F002/F003 Stage A2 — the reverse view of ContactRelationshipsPanel:
// every Contact related to this Account, with role and primary flag.
// Read-only here (managed from the Contact's own 360, matching this
// codebase's convention of one governed edit surface per relationship,
// not two competing ones).
export function AccountContactRelationshipsPanel({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId, "contact-relationships"), queryFn: () => listAccountContactRelationships(accountId) });
  const rows = query.data?.rows ?? [];

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading contact relationships…</p>;
  if (rows.length === 0) return <p className="text-sm text-text-muted">No related Contacts yet.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((relationship) => (
        <li key={relationship.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
          <button type="button" className="flex flex-col text-left hover:underline" onClick={() => router.push(`/crm/contacts/${relationship.contactId}`)}>
            <span className="font-medium text-text">
              {relationship.firstName} {relationship.lastName || ""}
            </span>
            <span className="text-text-secondary">
              {relationship.designation || humanize(relationship.relationshipType)}
              {relationship.stakeholderRole ? ` · ${humanize(relationship.stakeholderRole)}` : ""}
            </span>
          </button>
          {relationship.isPrimary && <StatusBadge tone="success">Primary</StatusBadge>}
        </li>
      ))}
    </ul>
  );
}
