"use client";

// The customer's automatic payment reminders (Sales report Phase 2): the latest sent (or skipped, with why), and a switch to leave the
// customer out — a key account, or a dispute handled by hand.
import { useMutation, useQuery } from "@tanstack/react-query";
import { StatusBadge, Switch } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request } from "@/features/sales/shared/http";
import { calendarDate } from "@/features/sales/shared/format";

type Entry = { id: string; ruleName: string | null; invoiceNumber: string | null; runOn: string; status: "previewed" | "sent" | "failed" | "skipped"; detail: string | null };
const TONE = { previewed: "info", sent: "success", failed: "danger", skipped: "neutral" } as const;
const LABEL = { previewed: "Would send", sent: "Sent", failed: "Not sent", skipped: "Skipped" } as const;

export function CustomerRemindersPanel({ customerId }: { customerId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer-reminders", customerId),
    queryFn: () => request<{ paused: boolean; log: Entry[] }>(`/customers/${customerId}/reminders`),
  });
  const pause = useMutation({ mutationFn: (paused: boolean) => post(`/customers/${customerId}/reminders`, { paused }), onSuccess: () => void query.refetch() });
  if (query.isError) return null;
  return (
    <Panel title="Payment reminders" description="Sent automatically by the rules in Sales › Setup."
      actions={query.data ? <Switch isSelected={!query.data.paused} isDisabled={pause.isPending} onChange={(on) => pause.mutate(!on)}>{query.data.paused ? "Paused" : "On"}</Switch> : undefined}>
      {pause.isError && <Notice tone="danger">{(pause.error as Error).message}</Notice>}
      {!query.data ? <p className="text-sm text-text-muted">Loading…</p> : query.data.log.length === 0 ? <p className="text-sm text-text-secondary">No reminders yet.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {query.data.log.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{[entry.invoiceNumber, entry.ruleName].filter(Boolean).join(" · ")}</span>
                <span className="text-xs text-text-secondary">{[calendarDate(entry.runOn), entry.detail].filter(Boolean).join(" · ")}</span>
              </span>
              <StatusBadge tone={TONE[entry.status]}>{LABEL[entry.status]}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
