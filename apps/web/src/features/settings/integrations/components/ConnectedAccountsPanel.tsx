"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  ErrorState,
  StatusBadge,
} from "@vercentlabs/design-system";
import Link from "next/link";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type Profile = {
  key: string;
  provider: string;
  label: string;
  description: string;
  scopes: string[];
  configured: boolean;
};
type Connection = {
  id: string;
  provider: string;
  profileKey: string;
  profileLabel: string;
  accountLabel: string | null;
  connectedByName: string | null;
  status: "active" | "revoked" | "reconnect_required" | "error";
  expiresAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

const QUERY_KEY = ["settings", "integrations", "oauth"];
const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const STATUS: Record<
  Connection["status"],
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  active: { label: "Connected", tone: "success" },
  reconnect_required: { label: "Reconnect needed", tone: "warning" },
  error: { label: "Error", tone: "danger" },
  revoked: { label: "Disconnected", tone: "neutral" },
};
const FAILURE_REASON: Record<string, string> = {
  expired: "The sign-in took too long or was already used. Start again.",
  declined: "The provider did not grant access.",
  provider: "The provider could not complete the connection. Try again later.",
};

export function ConnectedAccountsPanel({
  canManage,
  outcome,
  reason,
}: {
  canManage: boolean;
  outcome: string | null;
  reason: string | null;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      requestJson<{ profiles: Profile[]; connections: Connection[] }>(
        "/api/settings/integrations/oauth",
      ),
  });
  const [revoking, setRevoking] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: (profile: string) =>
      requestJson<{ authorizeUrl: string }>(
        "/api/settings/integrations/oauth/connect",
        {
          method: "POST",
          json: { profile, returnPath: "/settings/integrations" },
        },
      ),
    onSuccess: (result) => {
      window.location.assign(result.authorizeUrl);
    },
    onError: (failure) =>
      setError(
        failure instanceof Error
          ? failure.message
          : "The connection could not be started.",
      ),
  });
  const revoke = useMutation({
    mutationFn: (connection: Connection) =>
      requestJson(`/api/settings/integrations/oauth/${connection.id}/revoke`, {
        method: "POST",
      }),
    onSuccess: () => {
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (failure) =>
      setError(
        failure instanceof Error
          ? failure.message
          : "The account could not be disconnected.",
      ),
  });

  if (query.isLoading)
    return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError)
    return (
      <ErrorState
        title="Could not load connected accounts"
        description={(query.error as Error).message}
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  const { profiles, connections } = query.data!;
  const visible = connections.filter(
    (connection) => connection.status !== "revoked",
  );

  return (
    <div className="flex flex-col gap-4">
      {outcome === "connected" && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-success/40 bg-success-soft px-3 py-2 text-sm text-text"
        >
          Account connected.
        </p>
      )}
      {outcome === "failed" && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-text"
        >
          {FAILURE_REASON[reason ?? ""] ??
            "The account could not be connected."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((profile) => {
          const accounts = visible.filter((connection) => connection.profileKey === profile.key);
          return (
            <section
              key={profile.key}
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <h2 className="font-medium text-text">{profile.label}</h2>
                  <p className="text-sm text-text-secondary">{profile.description}</p>
                </div>
                {!profile.configured ? (
                  <StatusBadge tone="neutral">Not set up</StatusBadge>
                ) : accounts.some((connection) => connection.status === "active") ? (
                  <StatusBadge tone="success">Connected</StatusBadge>
                ) : null}
              </div>
              {/* The accounts linked with this provider, each with who linked it and when. */}
              {accounts.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
                  {accounts.map((connection) => (
                    <li key={connection.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-text">{connection.accountLabel ?? "Unnamed account"}</span>
                        <span className="text-xs text-text-muted">
                          {[connection.connectedByName ? `Linked by ${connection.connectedByName}` : null,
                            formatter.format(new Date(connection.lastRefreshedAt ?? connection.updatedAt))].filter(Boolean).join(" · ")}
                        </span>
                        {connection.lastError && <span className="text-xs text-danger">{connection.lastError}</span>}
                      </span>
                      {connection.status !== "active" && (
                        <StatusBadge tone={STATUS[connection.status]?.tone ?? "neutral"}>
                          {STATUS[connection.status]?.label ?? connection.status}
                        </StatusBadge>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="compact" onPress={() => setRevoking(connection)}>
                          Disconnect
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canManage && profile.configured && (
                <div>
                  <Button
                    variant="secondary"
                    size="compact"
                    isLoading={connect.isPending && connect.variables === profile.key}
                    onPress={() => connect.mutate(profile.key)}
                  >
                    Connect
                  </Button>
                </div>
              )}
              {!profile.configured && (
                <p className="text-xs text-text-muted">
                  The platform operator has not configured this provider yet.
                </p>
              )}
            </section>
          );
        })}
      </div>
      {/* Linking an account shares only a name and email; the calendar is connected separately, from CRM. */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-text">Calendar sync</h2>
          <p className="text-sm text-text-secondary">
            Want your CRM meetings, follow-ups and tasks in Google Calendar or Outlook? Each person connects their own calendar from CRM.
          </p>
        </div>
        <Link
          href="/crm/settings/calendar"
          className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium text-text hover:bg-surface-muted"
        >
          Set up calendar sync
        </Link>
      </section>
      <AlertDialog
        isOpen={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Disconnect this account?"
        description="Stored credentials are deleted immediately. Anything using this account stops working until it is connected again."
        confirmLabel="Disconnect"
        tone="danger"
        isConfirming={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </div>
  );
}
