"use client";

// CRM › Setup › My calendar (CRM plan 4.5): connect your own Google or Outlook calendar, and your CRM meetings and follow-up meetings are
// kept in it — added when planned, moved when rescheduled, removed when cancelled.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button, StatusBadge } from "@vercentlabs/design-system";

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
const OUTCOME: Record<string, { tone: "success" | "danger"; text: string }> = {
  connected: { tone: "success", text: "Your calendar is connected. Your meetings appear in it within a few minutes." },
  refused: { tone: "danger", text: "Access was not allowed, so the calendar is not connected." },
  mismatch: { tone: "danger", text: "The calendar link belonged to another session. Connect again." },
  failed: { tone: "danger", text: "The calendar could not be connected. Try again." },
};

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
  const outcome = OUTCOME[params.get("calendar") ?? ""];
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      <div>
        <h1 className="text-xl font-semibold">My calendar</h1>
        <p className="text-sm text-text-secondary">Connect your own calendar, and your CRM meetings are kept in it. Only meetings assigned to you are added.</p>
      </div>
      {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
      {(connect.isError || disconnect.isError) && <Notice>{((connect.error ?? disconnect.error) as Error).message}</Notice>}
      {query.isLoading ? <LoadingState label="Loading" rows={2} /> : (
        <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border">
          {(query.data ?? []).map((connection) => (
            <li key={connection.provider} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex min-w-60 flex-1 flex-col">
                <span className="font-medium">{connection.label}</span>
                <span className="text-xs text-text-muted">
                  {connection.connected ? `${connection.accountEmail ?? "Connected"}${connection.lastSyncAt ? ` · last updated ${formatDateTime(connection.lastSyncAt)}` : ""}`
                    : connection.available ? "Not connected" : "Not offered in this workspace yet (ask your administrator)"}
                </span>
                {connection.lastError && <span className="text-xs text-danger">{connection.lastError}</span>}
              </span>
              {connection.connected && <StatusBadge tone={connection.status === "error" ? "danger" : "success"}>{connection.status === "error" ? "Problem" : "Connected"}</StatusBadge>}
              {connection.connected
                ? <Button variant="secondary" isLoading={disconnect.isPending} onPress={() => disconnect.mutate(connection.provider)}>Disconnect</Button>
                : <Button variant="primary" isDisabled={!connection.available} isLoading={connect.isPending} onPress={() => connect.mutate(connection.provider)}>Connect</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
