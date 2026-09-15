"use client";

import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listAccountCommunications } from "../api/accounts-api";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F002 Tranche E — tenant.crm_communications is populated by email/call
// sync integrations (provider/provider_message_id columns), not manual
// entry, so this is deliberately read-only — no create form, matching
// what the record actually is.
export function AccountCommunicationsPanel({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "communications", accountId),
    queryFn: () => listAccountCommunications(accountId),
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading communications…</p>;
  const rows = query.data?.rows ?? [];
  if (rows.length === 0) return <p className="text-sm text-text-muted">No synced communications for this account.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
          <div className="flex flex-col">
            <span className="font-medium text-text">{row.subject || `${row.channel} ${row.direction}`}</span>
            <span className="text-text-secondary">
              {row.fromAddress || "—"} · {dateFormatter.format(new Date(row.occurredAt))}
            </span>
          </div>
          <StatusBadge tone="neutral">{row.channel}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}
