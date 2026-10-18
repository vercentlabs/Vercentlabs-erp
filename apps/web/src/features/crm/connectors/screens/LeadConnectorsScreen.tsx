"use client";

// CRM › Setup › Lead connectors (CRM plan 3.3): leads from IndiaMART, JustDial and TradeIndia, and from Facebook / Instagram and Google
// lead-form ads. IndiaMART and TradeIndia are read by CRM on a schedule (and on "Read now"); the others send each lead to the
// connector's webhook address, shown once when it is made. Each lead becomes a CRM lead with the connector's source and owner (or the
// assignment rules), never twice; someone already in CRM gets the enquiry logged on their record instead.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { getLeadOptions } from "@/features/crm/leads/api/leads-api";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createLeadConnector, errorMessage, fieldErrors, listLeadConnectorEvents, listLeadConnectors, pullLeadConnectorNow, rotateLeadConnectorWebhook,
  setLeadConnectorStatus, updateLeadConnector, webhookUrl, type ConnectorSecrets, type LeadConnector, type LeadProvider, type LeadProviderKey,
} from "../api/connectors-api";

const NONE = "__none__";
const EVENT_LABEL: Record<string, { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  created: { label: "New lead", tone: "success" }, logged: { label: "Logged on existing", tone: "info" }, ignored: { label: "Test", tone: "neutral" }, failed: { label: "Not imported", tone: "danger" },
};

export function LeadConnectorsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.capture.manage");
  const key = scopedQueryKey(workspace, "crm", "lead-connectors");
  const query = useQuery({ queryKey: key, queryFn: listLeadConnectors, enabled: canManage });
  const [editing, setEditing] = useState<LeadConnector | LeadProviderKey | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [secrets, setSecrets] = useState<ConnectorSecrets | null>(null);
  const [viewing, setViewing] = useState<LeadConnector | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const fail = (failure: unknown) => setMessage({ tone: "danger", text: errorMessage(failure) });
  const toggle = useMutation({ mutationFn: (row: LeadConnector) => setLeadConnectorStatus(row.id, row.status === "active" ? "paused" : "active"), onSuccess: refresh, onError: fail });
  const rotate = useMutation({ mutationFn: (row: LeadConnector) => rotateLeadConnectorWebhook(row.id), onSuccess: (result) => { setSecrets(result); refresh(); }, onError: fail });
  const pull = useMutation({
    mutationFn: (row: LeadConnector) => pullLeadConnectorNow(row.id),
    onSuccess: (result) => { if (result.error) { setMessage({ tone: "danger", text: result.error }); refresh(); return; } setMessage({ tone: "success", text: `Read ${result.read} ${result.read === 1 ? "lead" : "leads"}: ${result.created} new, ${result.logged} already in CRM${result.failed ? `, ${result.failed} not imported` : ""}.` }); refresh(); },
    onError: (failure) => { fail(failure); refresh(); },
  });
  const providers = query.data?.providers ?? [];
  const rows = query.data?.connectors ?? [];
  const columns = useMemo<ColumnDef<LeadConnector, unknown>[]>(() => [
    { id: "name", header: "Connector", cell: ({ row }) => <span className="flex flex-col"><span className="font-medium">{row.original.name}</span><span className="text-xs text-text-muted">{row.original.providerLabel}</span></span> },
    { id: "how", header: "How", cell: ({ row }) => (row.original.pull ? `Read every ${row.original.pollIntervalMinutes} min` : "Sends to its webhook") },
    { id: "last", header: "Last lead", cell: ({ row }) => (row.original.lastReceivedAt ? formatDateTime(row.original.lastReceivedAt) : "None yet") },
    { id: "leads", header: "Leads", cell: ({ row }) => <span className="tabular-nums">{row.original.leadCount}</span> },
    { id: "state", header: "State", cell: ({ row }) => (row.original.lastError
      ? <StatusBadge tone="danger">Problem</StatusBadge>
      : <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "On" : "Paused"}</StatusBadge>) },
  ], []);
  const actions = (row: LeadConnector) => [
    { id: "view", label: "Leads received", onAction: () => setViewing(row) },
    { id: "edit", label: "Edit", onAction: () => setEditing(row) },
    ...(row.pull ? [{ id: "pull", label: "Read now", isDisabled: pull.isPending || row.status !== "active", onAction: () => pull.mutate(row) }] : []),
    ...(row.push ? [{ id: "rotate", label: "New webhook address", isDisabled: rotate.isPending, onAction: () => rotate.mutate(row) }] : []),
    { id: "state", label: row.status === "active" ? "Pause" : "Resume", isDisabled: toggle.isPending, onAction: () => toggle.mutate(row) },
  ];

  if (!canManage) return <PermissionState title="You can't manage lead connectors" description="Ask an administrator for the Manage lead capture permission." />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <EnterpriseListPage
        header={{
          title: "Lead connectors",
          description: "Leads from IndiaMART, JustDial, TradeIndia and your Facebook, Instagram and Google lead ads, straight into CRM — each once, with its source and owner.",
          primaryAction: <Button variant="primary" onPress={() => setChoosing(true)}><Plus className="size-4" aria-hidden="true" />New connector</Button>,
        }}
      >
        <EnterpriseDataGrid<LeadConnector>
          aria-label="Lead connectors"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => setViewing(row)}
          {...gridStates(query, rows.length, "lead connectors", { title: "No lead connectors", description: "Connect IndiaMART, JustDial, TradeIndia, Meta or Google to bring their leads in." })}
          rowActions={(row) => <span onClick={(event) => event.stopPropagation()}><MoreMenu label={`Actions for ${row.name}`} items={actions(row)} /></span>}
          renderMobileCard={(row) => (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-xs text-text-muted">{row.providerLabel} · {row.leadCount} {row.leadCount === 1 ? "lead" : "leads"}{row.lastError ? " · problem" : row.status === "paused" ? " · paused" : ""}</span>
              </div>
              <div className="shrink-0" onClick={(event) => event.stopPropagation()}><MoreMenu label={`Actions for ${row.name}`} items={actions(row)} /></div>
            </div>
          )}
        />
      </EnterpriseListPage>
      {choosing && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) setChoosing(false); }} title="Connect a lead provider">
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <Button key={provider.key} variant="secondary" onPress={() => { setChoosing(false); setEditing(provider.key); }}>
                {provider.label}
              </Button>
            ))}
          </div>
        </Dialog>
      )}
      {editing && (
        <ConnectorDialog
          provider={providers.find((entry) => entry.key === (typeof editing === "string" ? editing : editing.provider))!}
          connector={typeof editing === "string" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(result) => { setEditing(null); refresh(); if (result.webhookKey || Object.keys(result.generated ?? {}).length) setSecrets(result); }}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {secrets && <SecretsDialog secrets={secrets} provider={providers.find((entry) => entry.key === secrets.connector.provider)} onClose={() => setSecrets(null)} />}
      {viewing && <EventsDialog connector={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ConnectorDialog({ provider, connector, onClose, onCreated, onSaved }: {
  provider: LeadProvider; connector: LeadConnector | null; onClose: () => void; onCreated: (result: ConnectorSecrets) => void; onSaved: () => void;
}) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 }).data;
  const [name, setName] = useState(connector?.name ?? provider.label);
  const [sourceId, setSourceId] = useState(connector?.sourceId ?? NONE);
  const [ownerUserId, setOwnerUserId] = useState(connector?.ownerUserId ?? NONE);
  const [pollEvery, setPollEvery] = useState(String(connector?.pollIntervalMinutes ?? 15));
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const filled = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
      const input = {
        name, ownerUserId: ownerUserId === NONE ? null : ownerUserId, ...(provider.pull ? { pollIntervalMinutes: Number(pollEvery) } : {}),
        ...(connector ? { sourceId: sourceId === NONE ? null : sourceId } : sourceId === NONE ? {} : { sourceId }),
        ...(Object.keys(filled).length || !connector ? { credentials: filled } : {}),
      };
      if (connector) { await updateLeadConnector(connector.id, input); return null; }
      return createLeadConnector({ provider: provider.key, ...input });
    },
    onSuccess: (result) => (result ? onCreated(result) : onSaved()),
    onError: (failure) => setErrors({ form: errorMessage(failure), ...fieldErrors(failure) }),
  });
  const typed = provider.credentials.filter((field) => !field.generated);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={connector ? `Edit ${connector.name}` : `Connect ${provider.label}`} size="lg">
      <div className="flex flex-col gap-4">
        {errors.form && <Notice>{errors.form}</Notice>}
        <TextField label="Name" value={name} onChange={setName} isInvalid={Boolean(errors.name)} errorMessage={errors.name} />
        {typed.map((field) => (
          <TextField key={field.key} label={field.label} type="password" value={credentials[field.key] ?? ""} onChange={(value) => setCredentials((current) => ({ ...current, [field.key]: value }))}
            description={connector?.credentialsSet.includes(field.key) ? "Kept. Type a new value only to replace it." : field.help ?? undefined}
            isRequired={!connector} isInvalid={Boolean(errors[`credentials.${field.key}`])} errorMessage={errors[`credentials.${field.key}`]} />
        ))}
        {options && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Source of its leads" description={connector ? undefined : `Left as is, the leads get the source ${provider.label}.`} selectedKey={sourceId}
              onSelectionChange={(value) => setSourceId(String(value))} isInvalid={Boolean(errors.sourceId)} errorMessage={errors.sourceId}
              options={[{ value: NONE, label: connector ? "None" : provider.label }, ...options.sources.filter((source) => source.isActive).map((source) => ({ value: source.id, label: source.name }))]} />
            <Select label="Owner of its leads" selectedKey={ownerUserId} onSelectionChange={(value) => setOwnerUserId(String(value))} isInvalid={Boolean(errors.ownerUserId)} errorMessage={errors.ownerUserId}
              options={[{ value: NONE, label: "By the assignment rules" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))]} />
          </div>
        )}
        {provider.pull && (
          <Select label="Read new leads" selectedKey={pollEvery} onSelectionChange={(value) => setPollEvery(String(value))}
            options={[["5", "Every 5 minutes"], ["15", "Every 15 minutes"], ["30", "Every 30 minutes"], ["60", "Every hour"], ["240", "Every 4 hours"], ["1440", "Once a day"]].map(([value, label]) => ({ value, label }))} />
        )}
        {!connector && provider.push && <p className="text-sm text-text-secondary">After saving you get the webhook address to paste into {provider.label}.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{connector ? "Save" : "Connect"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function SecretsDialog({ secrets, provider, onClose }: { secrets: ConnectorSecrets; provider?: LeadProvider; onClose: () => void }) {
  const generated = Object.entries(secrets.generated ?? {});
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Finish setting up ${secrets.connector.name}`} size="lg">
      <div className="flex flex-col gap-4 text-sm">
        <Notice tone="warning">Copy these now: they are not shown again. A lost address can be replaced with a new one.</Notice>
        {secrets.webhookKey && <Copyable label={`Webhook address — paste it into ${provider?.label ?? "the provider"}`} value={webhookUrl(secrets.webhookKey)} />}
        {generated.map(([field, value]) => <Copyable key={field} label={provider?.credentials.find((entry) => entry.key === field)?.label ?? field} value={value}
          help={provider?.credentials.find((entry) => entry.key === field)?.help ?? undefined} />)}
        <div className="flex justify-end"><Button variant="primary" onPress={onClose}>Done</Button></div>
      </div>
    </Dialog>
  );
}

function Copyable({ label, value, help }: { label: string; value: string; help?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Button variant="ghost" size="compact" onPress={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true)); }}><Copy className="size-4" aria-hidden="true" />{copied ? "Copied" : "Copy"}</Button>
      </div>
      <code className="break-all rounded-[var(--radius-card)] border border-border bg-surface-muted p-2 text-xs">{value}</code>
      {help && <span className="text-xs text-text-muted">{help}</span>}
    </div>
  );
}

function EventsDialog({ connector, onClose }: { connector: LeadConnector; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const events = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-connector-events", connector.id), queryFn: () => listLeadConnectorEvents(connector.id) });
  const href = (type: string | null, id: string | null) => (type && id ? `${{ lead: "/crm/leads/", contact: "/crm/contacts/", party: "/crm/accounts/", opportunity: "/crm/opportunities/" }[type] ?? "/crm/leads/"}${id}` : null);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Leads from ${connector.name}`} size="lg">
      <div className="flex flex-col gap-3 text-sm">
        {connector.lastError && <Notice>Last problem ({connector.lastErrorAt ? formatDateTime(connector.lastErrorAt) : "recently"}): {connector.lastError}</Notice>}
        {connector.pull && <p className="text-text-secondary">Read {connector.lastPolledAt ? `last at ${formatDateTime(connector.lastPolledAt)}` : "soon"}; leads up to {connector.polledUntil ? formatDateTime(connector.polledUntil) : "now"} are in.</p>}
        {events.data?.length === 0 && <p className="text-text-secondary">No leads yet.</p>}
        <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border">
          {(events.data ?? []).map((event) => {
            const link = href(event.recordType, event.recordId);
            return (
              <li key={event.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <StatusBadge tone={EVENT_LABEL[event.status]?.tone ?? "neutral"}>{EVENT_LABEL[event.status]?.label ?? event.status}</StatusBadge>
                <span className="min-w-0 flex-1">{event.summary ?? event.externalId}{event.error ? <span className="block text-xs text-danger">{event.error}</span> : null}</span>
                <span className="text-xs text-text-muted">{formatDateTime(event.enquiryAt ?? event.receivedAt)}</span>
                {link && <Link className="text-xs text-brand hover:underline" href={link}>{event.leadCode ?? "Open"}</Link>}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end"><Button variant="primary" onPress={onClose}>Close</Button></div>
      </div>
    </Dialog>
  );
}
