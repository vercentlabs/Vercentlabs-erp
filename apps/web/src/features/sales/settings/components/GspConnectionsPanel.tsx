"use client";

// Each GSTIN's own GST Suvidha Provider account (Sales report Phase 2): connect it, test it, change or remove it. The API token is kept
// encrypted and never shown again; only the user name and the state of the connection are.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertDialog, Button, Dialog, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, del, post, request } from "@/features/sales/shared/http";
import { dateTime } from "@/features/sales/shared/format";

type Connection = { provider: string; providerLabel: string; baseUrl: string | null; credentialHint: string | null; status: "untested" | "connected" | "failed";
  lastTestedAt: string | null; lastError: string | null; lastUsedAt: string | null; useCount: number };
type Registration = { registrationId: string; name: string; gstin: string; connection: Connection | null };
type Data = { registrations: Registration[]; providers: Array<{ value: string; label: string; fields: string[] }> };
const TONE = { untested: "warning", connected: "success", failed: "danger" } as const;
const LABEL = { untested: "Not tested", connected: "Connected", failed: "Test failed" } as const;

export function GspConnectionsPanel() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "gsp-connections"), queryFn: () => request<Data>("/gsp-connections"), retry: false });
  const [editing, setEditing] = useState<Registration | null>(null);
  const [removing, setRemoving] = useState<Registration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const testing = useMutation({
    mutationFn: (registration: Registration) => post<{ connected: boolean; error: string | null }>(`/gsp-connections/${registration.registrationId}/test`, {}),
    onSuccess: (result, registration) => { setNotice(result.connected ? `${registration.gstin}: the GSP accepted the credentials.` : `${registration.gstin}: ${result.error}`); void query.refetch(); },
  });
  const remove = useMutation({
    mutationFn: (registration: Registration) => del(`/gsp-connections/${registration.registrationId}`),
    onSuccess: () => { setRemoving(null); void query.refetch(); },
  });
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403) return null;
  const data = query.data;
  return (
    <Panel title="Your GSP account" description="Each GSTIN connects its own GST Suvidha Provider for e-invoices and e-way bills.">
      {notice && <Notice tone="info">{notice}</Notice>}
      {(testing.isError || remove.isError) && <Notice tone="danger">{((testing.error ?? remove.error) as Error).message}</Notice>}
      {!data ? <p className="text-sm text-text-muted">{query.isError ? "Could not load the GSTINs." : "Loading…"}</p>
        : data.registrations.length === 0 ? <p className="text-sm text-text-secondary">Add the company&apos;s GSTIN first, in Settings › Tax.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {data.registrations.map((registration) => {
              const connection = registration.connection;
              return (
                <li key={registration.registrationId} className="flex items-start gap-3 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">{registration.gstin}</span>
                      <span className="text-text-secondary">{registration.name}</span>
                      {connection ? <StatusBadge tone={TONE[connection.status]}>{LABEL[connection.status]}</StatusBadge> : <StatusBadge tone="neutral">Not connected</StatusBadge>}
                    </span>
                    {connection && (
                      <span className="text-xs text-text-secondary">
                        {[connection.providerLabel, connection.credentialHint ? `user ${connection.credentialHint}` : null,
                          connection.lastUsedAt ? `used ${connection.useCount} times, last ${dateTime(connection.lastUsedAt)}` : "not used yet"].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {connection?.status === "failed" && connection.lastError && <span className="text-xs text-danger">{connection.lastError}</span>}
                  </div>
                  <div className="shrink-0 sm:hidden">
                    <MoreMenu label={`Actions for ${registration.gstin}`} items={[
                      { id: "connect", label: connection ? "Change" : "Connect", onAction: () => setEditing(registration) },
                      ...(connection ? [{ id: "test", label: "Test", isDisabled: testing.isPending, onAction: () => testing.mutate(registration) },
                        { id: "remove", label: "Remove", danger: true, onAction: () => setRemoving(registration) }] : []),
                    ]} />
                  </div>
                  <div className="hidden shrink-0 items-center gap-1 sm:flex">
                    <Button variant={connection ? "ghost" : "secondary"} size="compact" onPress={() => setEditing(registration)}>{connection ? "Change" : "Connect"}</Button>
                    {connection && <Button variant="ghost" size="compact" isLoading={testing.isPending && testing.variables?.registrationId === registration.registrationId}
                      onPress={() => testing.mutate(registration)}>Test</Button>}
                    {connection && <Button variant="ghost" size="compact" className="text-danger" onPress={() => setRemoving(registration)}>Remove</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      {editing && data && <ConnectDialog registration={editing} providers={data.providers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Saved. Press Test to check it."); void query.refetch(); }} />}
      <AlertDialog isOpen={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)} title={`Remove the GSP for ${removing?.gstin ?? ""}?`}
        description="E-invoices for this GSTIN then need the IRN entered by hand, unless the platform has a GSP." confirmLabel="Remove"
        isConfirming={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} />
    </Panel>
  );
}

function ConnectDialog({ registration, providers, onClose, onSaved }: {
  registration: Registration; providers: Data["providers"]; onClose: () => void; onSaved: () => void;
}) {
  const [provider, setProvider] = useState(registration.connection?.provider ?? providers[0]?.value ?? "");
  const [baseUrl, setBaseUrl] = useState(registration.connection?.baseUrl ?? "");
  const [username, setUsername] = useState(registration.connection?.credentialHint ?? "");
  const [token, setToken] = useState("");
  const fields = providers.find((entry) => entry.value === provider)?.fields ?? [];
  const save = useMutation({
    mutationFn: () => request(`/gsp-connections/${registration.registrationId}`, { method: "PUT", body: JSON.stringify({ provider, baseUrl: baseUrl.trim(), username: username.trim(), token }) }),
    onSuccess: onSaved,
  });
  const ready = Boolean(provider) && (!fields.includes("baseUrl") || baseUrl.trim()) && (!fields.includes("token") || token.trim());
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Connect a GSP for ${registration.gstin}`}
      description="Your GSP gives you these. The token is kept encrypted and never shown again.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <Select label="GSP" selectedKey={provider} onSelectionChange={(key) => setProvider(String(key))} options={providers.map((entry) => ({ value: entry.value, label: entry.label }))} />
        {fields.includes("baseUrl") && <TextField label="GSP address" isRequired value={baseUrl} onChange={setBaseUrl} placeholder="https://" inputMode="url" />}
        {fields.includes("username") && <TextField label="API user name" value={username} onChange={setUsername} />}
        {fields.includes("token") && (
          <TextField label="API token" type="password" isRequired value={token} onChange={setToken}
            description={registration.connection ? "Enter it again to change the connection." : undefined} />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>Save connection</Button>
        </div>
      </form>
    </Dialog>
  );
}
