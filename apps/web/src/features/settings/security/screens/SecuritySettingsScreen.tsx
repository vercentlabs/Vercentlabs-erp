"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, EmptyState, ErrorState, PageHeader } from "@vercentlabs/design-system";
import { Laptop, Smartphone } from "lucide-react";

import { listSessions, revokeSession, SessionApiError, type SessionRow } from "../api/sessions-api";

const SESSIONS_QUERY_KEY = ["settings", "sessions"];

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function SecuritySettingsScreen() {
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({ queryKey: SESSIONS_QUERY_KEY, queryFn: listSessions });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: () => {
      setActionError(null);
      setRevokeTarget(null);
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setActionError(error instanceof SessionApiError ? error.message : "This session could not be revoked.");
    },
  });

  const sessions = query.data?.sessions ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <PageHeader
        title="Security"
        description="Devices and browsers currently signed in to your account. Revoke any session you don't recognize."
      />

      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading sessions…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load sessions" description="Something went wrong loading your active sessions." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : sessions.length === 0 ? (
        <EmptyState title="No active sessions" />
      ) : (
        <ul className="flex max-w-[640px] flex-col gap-2">
          {sessions.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
                  {row.sessionType === "mobile" ? (
                    <Smartphone className="size-4" aria-hidden="true" />
                  ) : (
                    <Laptop className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{row.deviceName}</span>
                    {row.isCurrent && <Badge tone="success">This device</Badge>}
                  </div>
                  <span className="text-xs text-text-muted">
                    {row.ipAddress ? `${row.ipAddress} · ` : ""}
                    Last active {dateTimeFormatter.format(new Date(row.lastSeenAt))}
                  </span>
                </div>
              </div>
              {!row.isCurrent && (
                <Button variant="secondary" size="compact" onPress={() => setRevokeTarget(row)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        isOpen={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this session?"
        description={`This will immediately sign out "${revokeTarget?.deviceName}". They'll need to log in again to continue.`}
        confirmLabel="Revoke session"
        isConfirming={revokeMutation.isPending}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
      />
    </div>
  );
}
