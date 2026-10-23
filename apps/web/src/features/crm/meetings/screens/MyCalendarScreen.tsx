"use client";

// CRM › Setup › My calendar (CRM plan 4.5): connect your own Google or Outlook calendar, and everything scheduled for you in CRM — meetings,
// follow-ups, tasks, planned calls — is kept in it: added when planned, moved when rescheduled, marked done, removed when cancelled.
// Desktop: the calendars on the left, what goes into them on the right. Tablet and phone: one column, the calendars first; each calendar's
// actions wrap under it, full width on a phone.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button, PageHeader, StatusBadge } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { CrmApiError } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const { request } = crmApiClient(CrmApiError);
type Connection = { provider: "google" | "microsoft"; label: string; available: boolean; connected: boolean; accountEmail: string | null; status: string | null; lastSyncAt: string | null; lastError: string | null };
type SyncResult = { created: number; updated: number; removed: number; failed: number };
const OUTCOME: Record<string, { tone: "success" | "danger"; text: string }> = {
  connected: { tone: "success", text: "Your calendar is connected. Your meetings, follow-ups and tasks appear in it shortly; use Sync now to add them at once." },
  refused: { tone: "danger", text: "Access was not allowed, so the calendar is not connected." },
  mismatch: { tone: "danger", text: "The calendar link belonged to another session. Connect again." },
  failed: { tone: "danger", text: "The calendar could not be connected. Try again." },
};
const PAST_DAYS = 90;

function syncMessage(result: SyncResult, past: boolean) {
  if (result.failed) return "The calendar could not be updated. The reason is shown under the calendar.";
  if (result.created + result.updated + result.removed === 0)
    return past ? `Nothing older to add: your items of the last ${PAST_DAYS} days are already in your calendar.` : "Your calendar is already up to date.";
  const parts = [result.created && `${result.created} added`, result.updated && `${result.updated} changed`, result.removed && `${result.removed} removed`].filter(Boolean);
  return `Calendar updated: ${parts.join(", ")}.`;
}

export function MyCalendarScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const key = scopedQueryKey(workspace, "crm", "calendar-connections");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ connections: Connection[] }>("/api/crm/calendar").then((result) => result.connections) });
  const connect = useMutation({
    mutationFn: (provider: string) => request<{ url: string }>(`/api/crm/calendar/connect/${provider}`),
    onSuccess: (result) => { window.location.href = result.url; },
  });
  const disconnect = useMutation({
    mutationFn: (provider: string) => request(`/api/crm/calendar/${provider}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  // Sync now (pastDays 0), or also add past meetings, calls, follow-ups and tasks ("Add past items"). The worker also syncs every minute.
  const sync = useMutation({
    mutationFn: (pastDays: number = 0) => request<{ result: SyncResult }>("/api/crm/calendar/sync", { method: "POST", json: { pastDays } }).then((response) => response.result),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  // The "connected" note is only for the return from the provider; after a sync, the sync's own result speaks.
  const outcome = sync.data || sync.isError ? null : OUTCOME[params.get("calendar") ?? ""];
  const failure = connect.error ?? disconnect.error ?? sync.error;
  const connections = query.data ?? [];
  const offered = connections.filter((connection) => connection.available || connection.connected);
  const notOffered = connections.filter((connection) => !connection.available && !connection.connected);

  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="My calendar" description="Keep your CRM schedule in your own Google or Outlook calendar. Only what is assigned to you is added." />
      {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
      {sync.data && <Notice tone={sync.data.failed ? "danger" : "success"}>{syncMessage(sync.data, sync.variables === PAST_DAYS)}</Notice>}
      {failure && <Notice>{(failure as Error).message}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3">
          {query.isLoading ? <LoadingState label="Loading your calendars" rows={2} /> : (
            <>
              {offered.map((connection) => (
                <section key={connection.provider} aria-label={connection.label}
                  className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h2 className="text-base font-semibold text-text">{connection.label}</h2>
                      {connection.connected ? (
                        <>
                          <p className="truncate text-sm text-text-secondary">{connection.accountEmail ?? "Connected account"}</p>
                          <p className="text-xs text-text-muted">{connection.lastSyncAt ? `Last updated ${formatDateTime(connection.lastSyncAt)}` : "Not updated yet"}</p>
                        </>
                      ) : <p className="text-sm text-text-secondary">Not connected. Connect it to see your CRM schedule there.</p>}
                    </div>
                    {connection.connected && (
                      <StatusBadge tone={connection.status === "error" ? "danger" : "success"}>{connection.status === "error" ? "Problem" : "Connected"}</StatusBadge>
                    )}
                  </div>
                  {connection.lastError && (
                    <p role="alert" className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-text">{connection.lastError}</p>
                  )}
                  {/* Phone: one full-width button per line, the main action first. Tablet and desktop: one row, Disconnect at the far end. */}
                  {connection.connected ? (
                    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center">
                      <Button variant="primary" className="w-full sm:w-auto" isLoading={sync.isPending && sync.variables !== PAST_DAYS} isDisabled={sync.isPending}
                        onPress={() => sync.mutate(0)}>Sync now</Button>
                      <Button variant="secondary" className="w-full sm:w-auto" isLoading={sync.isPending && sync.variables === PAST_DAYS} isDisabled={sync.isPending}
                        onPress={() => sync.mutate(PAST_DAYS)}>{`Add past items (${PAST_DAYS} days)`}</Button>
                      <Button variant="ghost" className="w-full sm:ml-auto sm:w-auto" isLoading={disconnect.isPending} onPress={() => disconnect.mutate(connection.provider)}>Disconnect</Button>
                    </div>
                  ) : (
                    <div className="border-t border-border pt-4">
                      <Button variant="primary" className="w-full sm:w-auto" isLoading={connect.isPending && connect.variables === connection.provider}
                        onPress={() => connect.mutate(connection.provider)}>{`Connect ${connection.label}`}</Button>
                    </div>
                  )}
                </section>
              ))}
              {notOffered.length > 0 && (
                <p className="text-xs text-text-muted">
                  {`${notOffered.map((connection) => connection.label).join(" and ")} ${notOffered.length === 1 ? "is" : "are"} not offered in this workspace yet. Ask your administrator.`}
                </p>
              )}
            </>
          )}
        </div>

        <section aria-labelledby="calendar-what" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="calendar-what" className="text-sm font-semibold text-text">What goes into your calendar</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>Meetings, follow-ups (calls, visits, demos…), tasks and planned calls assigned to you.</li>
            <li>A task due on a day without a time is an all-day event.</li>
            <li>Rescheduling moves the event, completing marks it Done, cancelling removes it.</li>
            <li>A meeting moved or deleted in your calendar is moved or cancelled in CRM.</li>
          </ul>
          <p className="border-t border-border pt-3 text-xs text-text-muted">
            {`New and changed items are added automatically within a few minutes. Add past items brings in the last ${PAST_DAYS} days; logged emails and WhatsApp messages stay out.`}
          </p>
        </section>
      </div>
    </div>
  );
}
