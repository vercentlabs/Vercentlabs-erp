"use client";

// A lead's or contact's consent history from the ledger (CRM plan 4.3): each agreement and refusal, by channel, when, how it came and
// who recorded it.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { ACTION_LABEL, CHANNEL_LABEL, SOURCE_LABEL, listConsentHistory } from "../consent-api";

export function ConsentHistory({ type, id }: { type: "leads" | "contacts"; id: string }) {
  const workspace = useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "consent-history", type, id), queryFn: () => listConsentHistory(type, id), enabled: open });
  if (!open) return <Button variant="ghost" size="compact" onPress={() => setOpen(true)}>Consent history</Button>;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Consent history</h3>
        <Button variant="ghost" size="compact" onPress={() => setOpen(false)}>Hide</Button>
      </div>
      {query.data?.length === 0 && <p className="text-sm text-text-secondary">No consent recorded yet.</p>}
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
        {(query.data ?? []).map((event) => (
          <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2">
            <span><span className="font-medium">{ACTION_LABEL[event.action] ?? event.action}</span> · {CHANNEL_LABEL[event.channel] ?? event.channel}</span>
            <span className="text-xs text-text-muted">
              {formatDateTime(event.recordedAt)} · {SOURCE_LABEL(event.source)}{event.recordedByName ? ` · ${event.recordedByName}` : ""}{event.evidence ? ` · ${event.evidence}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
