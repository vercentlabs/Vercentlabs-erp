"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  Checkbox,
  CheckboxGroup,
  DatePicker,
  Dialog,
  EmptyState,
  ErrorState,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

import { SecretRevealDialog, type RevealedSecret } from "./SecretRevealDialog";

type App = { id: string; name: string; description: string; status: "active" | "revoked"; createdAt: string; createdByName: string | null; activeKeyCount: number; lastUsedAt: string | null };
type Key = { id: string; developerAppId: string; name: string; prefix: string; scopes: string[]; unrecognizedScopes: string[]; status: "active" | "revoked" | "expired"; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; createdByName: string | null };
type Scope = { key: string; displayName: string; description: string; risk: string };
type Payload = { apps: App[]; keys: Key[]; scopes: Scope[] };

const QUERY_KEY = ["settings", "integrations", "developer-api"];
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const when = (value: string | null) => (value ? formatter.format(new Date(value)) : "Never");
const KEY_STATUS: Record<Key["status"], { label: string; tone: "success" | "neutral" | "warning" }> = {
  active: { label: "Active", tone: "success" },
  revoked: { label: "Revoked", tone: "neutral" },
  expired: { label: "Expired", tone: "warning" },
};

export function DeveloperApiPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<Payload>("/api/settings/integrations/developer-apps") });
  const [creatingApp, setCreatingApp] = useState(false);
  const [issuingFor, setIssuingFor] = useState<App | null>(null);
  const [revokeKey, setRevokeKey] = useState<Key | null>(null);
  const [revokeApp, setRevokeApp] = useState<App | null>(null);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (failure: unknown) => setError(failure instanceof Error ? failure.message : "The change could not be saved.");

  const revokeKeyMutation = useMutation({ mutationFn: (id: string) => requestJson(`/api/settings/integrations/api-keys/${id}/revoke`, { method: "POST" }), onSuccess: () => (setRevokeKey(null), refresh()), onError: fail });
  const revokeAppMutation = useMutation({ mutationFn: (id: string) => requestJson(`/api/settings/integrations/developer-apps/${id}/revoke`, { method: "POST" }), onSuccess: () => (setRevokeApp(null), refresh()), onError: fail });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError) return <ErrorState title="Could not load developer apps" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const { apps, keys, scopes } = query.data!;
  const scopeName = new Map(scopes.map((scope) => [scope.key, scope.displayName]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-text-secondary">
          A developer app is one external integration. Its API keys call the Vercentlabs API (<code className="font-mono">/api/v1</code>) with only the scopes you grant; a key is not a user and has no user permissions.
        </p>
        {canManage && (
          <Button variant="primary" onPress={() => setCreatingApp(true)}>
            New developer app
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {apps.length === 0 ? (
        <EmptyState title="No developer apps yet" description="Create an app for each system that will call the API, then issue it a key." />
      ) : (
        apps.map((app) => {
          const appKeys = keys.filter((key) => key.developerAppId === app.id);
          return (
            <section key={app.id} aria-label={app.name} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text">{app.name}</h3>
                    <StatusBadge tone={app.status === "active" ? "success" : "neutral"}>{app.status === "active" ? "Active" : "Revoked"}</StatusBadge>
                  </div>
                  {app.description && <p className="text-sm text-text-secondary">{app.description}</p>}
                  <p className="text-xs text-text-muted">{`Created ${when(app.createdAt)}${app.createdByName ? ` by ${app.createdByName}` : ""} · last used ${when(app.lastUsedAt)}`}</p>
                </div>
                {canManage && app.status === "active" && (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="compact" onPress={() => setIssuingFor(app)}>
                      New key
                    </Button>
                    <Button variant="danger" size="compact" onPress={() => setRevokeApp(app)}>
                      Revoke app
                    </Button>
                  </div>
                )}
              </div>
              {appKeys.length === 0 ? (
                <p className="text-sm text-text-muted">No keys yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table caption={`${app.name} API keys`}>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Key</TableHeaderCell>
                        <TableHeaderCell>Scopes</TableHeaderCell>
                        <TableHeaderCell>Expires</TableHeaderCell>
                        <TableHeaderCell>Last used</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell>
                          <span className="sr-only">Actions</span>
                        </TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {appKeys.map((key) => (
                        <TableRow key={key.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium text-text">{key.name}</span>
                              <span className="font-mono text-xs text-text-muted">{`${key.prefix}…`}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {key.scopes.map((scope) => scopeName.get(scope) ?? scope).join(", ") || "None"}
                            {key.unrecognizedScopes.length > 0 && <span className="block text-xs text-text-muted">Older scopes that grant nothing were kept for history.</span>}
                          </TableCell>
                          <TableCell>{key.expiresAt ? when(key.expiresAt) : "Does not expire"}</TableCell>
                          <TableCell>{when(key.lastUsedAt)}</TableCell>
                          <TableCell>
                            <StatusBadge tone={KEY_STATUS[key.status].tone}>{KEY_STATUS[key.status].label}</StatusBadge>
                          </TableCell>
                          <TableCell>
                            {canManage && key.status === "active" && (
                              <Button variant="ghost" size="compact" onPress={() => setRevokeKey(key)} aria-label={`Revoke ${key.name}`}>
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          );
        })
      )}

      {creatingApp && <CreateAppDialog onClose={() => setCreatingApp(false)} onCreated={() => (setCreatingApp(false), refresh())} />}
      {issuingFor && (
        <IssueKeyDialog
          app={issuingFor}
          scopes={scopes}
          onClose={() => setIssuingFor(null)}
          onIssued={(token, name) => {
            setIssuingFor(null);
            setSecret({ title: `API key for ${issuingFor.name}`, description: `"${name}" was created.`, items: [{ label: "API key", value: token }] });
            refresh();
          }}
        />
      )}
      {secret && <SecretRevealDialog secret={secret} onDone={() => setSecret(null)} />}
      <AlertDialog
        isOpen={Boolean(revokeKey)}
        onOpenChange={(open) => !open && setRevokeKey(null)}
        title="Revoke this key?"
        description={`Requests using "${revokeKey?.name ?? ""}" will be refused immediately. This cannot be undone.`}
        tone="danger"
        confirmLabel="Revoke key"
        isConfirming={revokeKeyMutation.isPending}
        onConfirm={() => revokeKey && revokeKeyMutation.mutate(revokeKey.id)}
      />
      <AlertDialog
        isOpen={Boolean(revokeApp)}
        onOpenChange={(open) => !open && setRevokeApp(null)}
        title="Revoke this app?"
        description={`Every key of "${revokeApp?.name ?? ""}" stops working immediately. This cannot be undone.`}
        tone="danger"
        confirmLabel="Revoke app and keys"
        isConfirming={revokeAppMutation.isPending}
        onConfirm={() => revokeApp && revokeAppMutation.mutate(revokeApp.id)}
      />
    </div>
  );
}

function CreateAppDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => requestJson("/api/settings/integrations/developer-apps", { method: "POST", json: { name, description } }),
    onSuccess: onCreated,
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The app could not be created."),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New developer app">
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={setName} isRequired description="For example: Warehouse sync" />
        <TextArea label="Description (optional)" value={description} onChange={setDescription} rows={3} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!name.trim()} isLoading={create.isPending} onPress={() => create.mutate()}>
            Create app
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function IssueKeyDialog({ app, scopes, onClose, onIssued }: { app: App; scopes: Scope[]; onClose: () => void; onIssued: (token: string, name: string) => void }) {
  const [name, setName] = useState("");
  const [granted, setGranted] = useState<string[]>([]);
  const [expires, setExpires] = useState(false);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const issue = useMutation({
    mutationFn: () =>
      requestJson<{ token: string }>(`/api/settings/integrations/developer-apps/${app.id}/keys`, {
        method: "POST",
        json: { name, scopes: granted, expiresAt: expires && expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : null },
      }),
    // The token goes straight to the one-time reveal; it is never cached.
    onSuccess: (result) => onIssued(result.token, name),
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The key could not be created."),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`New key for ${app.name}`} size="lg">
      <div className="flex flex-col gap-4">
        <TextField label="Key name" value={name} onChange={setName} isRequired description="For example: Production, or the date you rotated it." />
        <CheckboxGroup label="Scopes" value={granted} onChange={setGranted} isRequired>
          {scopes.map((scope) => (
            <Checkbox key={scope.key} value={scope.key}>
              <span className="flex flex-col">
                <span className="text-sm text-text">{scope.displayName}</span>
                <span className="text-xs text-text-muted">{scope.description}</span>
              </span>
            </Checkbox>
          ))}
        </CheckboxGroup>
        <Checkbox isSelected={expires} onChange={setExpires}>
          Expires on a date
        </Checkbox>
        {expires && <DatePicker label="Expiry date" onChange={(value) => setExpiresOn(value ? value.toString() : null)} isRequired />}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!name.trim() || granted.length === 0 || (expires && !expiresOn)} isLoading={issue.isPending} onPress={() => issue.mutate()}>
            Create key
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
