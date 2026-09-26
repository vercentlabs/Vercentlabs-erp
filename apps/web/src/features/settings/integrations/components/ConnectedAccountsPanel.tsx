"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  EmptyState,
  ErrorState,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type Profile = { key: string; provider: string; label: string; description: string; scopes: string[]; configured: boolean };
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
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const STATUS: Record<Connection["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
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

export function ConnectedAccountsPanel({ canManage, outcome, reason }: { canManage: boolean; outcome: string | null; reason: string | null }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<{ profiles: Profile[]; connections: Connection[] }>("/api/settings/integrations/oauth") });
  const [revoking, setRevoking] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: (profile: string) => requestJson<{ authorizeUrl: string }>("/api/settings/integrations/oauth/connect", { method: "POST", json: { profile, returnPath: "/settings/integrations" } }),
    onSuccess: (result) => {
      window.location.assign(result.authorizeUrl);
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The connection could not be started."),
  });
  const revoke = useMutation({
    mutationFn: (connection: Connection) => requestJson(`/api/settings/integrations/oauth/${connection.id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The account could not be disconnected."),
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError) return <ErrorState title="Could not load connected accounts" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const { profiles, connections } = query.data!;
  const visible = connections.filter((connection) => connection.status !== "revoked");

  return (
    <div className="flex flex-col gap-4">
      {outcome === "connected" && (
        <p role="status" className="rounded-[var(--radius-card)] border border-success/40 bg-success-soft px-3 py-2 text-sm text-text">
          Account connected.
        </p>
      )}
      {outcome === "failed" && (
        <p role="alert" className="rounded-[var(--radius-card)] border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-text">
          {FAILURE_REASON[reason ?? ""] ?? "The account could not be connected."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((profile) => (
          <div key={profile.key} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{profile.label}</span>
              {!profile.configured && <StatusBadge tone="neutral">Not set up</StatusBadge>}
            </div>
            <p className="text-sm text-text-secondary">{profile.description}</p>
            {canManage && (
              <div>
                <Button variant="secondary" size="compact" isDisabled={!profile.configured} isLoading={connect.isPending && connect.variables === profile.key} onPress={() => connect.mutate(profile.key)}>
                  Connect
                </Button>
              </div>
            )}
            {!profile.configured && <p className="text-xs text-text-muted">The platform operator has not configured this provider yet.</p>}
          </div>
        ))}
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No connected accounts" description="Connected accounts appear here after someone signs in with a provider." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <Table caption="Connected accounts">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell>Connected by</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last refreshed</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-text">{connection.accountLabel ?? "Unnamed account"}</span>
                      <span className="text-xs text-text-muted">{connection.profileLabel}</span>
                    </div>
                  </TableCell>
                  <TableCell>{connection.connectedByName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS[connection.status]?.tone ?? "neutral"}>{STATUS[connection.status]?.label ?? connection.status}</StatusBadge>
                  </TableCell>
                  <TableCell>{connection.lastRefreshedAt ? formatter.format(new Date(connection.lastRefreshedAt)) : "—"}</TableCell>
                  <TableCell>
                    {canManage && (
                      <Button variant="ghost" size="compact" onPress={() => setRevoking(connection)}>
                        Disconnect
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
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
