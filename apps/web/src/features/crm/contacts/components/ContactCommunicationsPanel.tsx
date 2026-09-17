"use client";

import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

type Communication = { id: string; channel: string; direction: string; subject: string | null; fromAddress: string | null; occurredAt: string };

async function listContactCommunications(contactId: string): Promise<{ rows: Communication[] }> {
  const response = await fetch(`/api/crm/communications?contactId=${encodeURIComponent(contactId)}&limit=25`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "Communications could not be loaded.");
  return payload;
}

// F003 Tranche F — mirrors AccountCommunicationsPanel; read-only, the
// table is sync-populated (provider/provider_message_id), not manually
// entered.
export function ContactCommunicationsPanel({ contactId }: { contactId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "communications", "contact", contactId),
    queryFn: () => listContactCommunications(contactId),
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading communications…</p>;
  const rows = query.data?.rows ?? [];
  if (rows.length === 0) return <p className="text-sm text-text-muted">No synced communications for this contact.</p>;

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
