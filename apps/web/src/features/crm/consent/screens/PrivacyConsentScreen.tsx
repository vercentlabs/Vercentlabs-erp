"use client";

// CRM › Setup › Privacy and consent (CRM plan 4.3): the opt-out list — addresses and numbers no email or message from CRM may reach,
// whichever record they are on — and the lookup of everything CRM holds on one person, for a privacy request (DPDP).
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, PermissionState, SearchField, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { ACTION_LABEL, CHANNEL_LABEL, SOURCE_LABEL, addOptOut, errorMessage, listOptOuts, lookupPersonalData, removeOptOut, type OptOut, type PersonalData } from "@/features/crm/shared/consent-api";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const HREF: Record<string, string> = { lead: "/crm/leads/", contact: "/crm/contacts/", party: "/crm/accounts/", opportunity: "/crm/opportunities/" };

export function PrivacyConsentScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage") || workspace.permissions.includes("platform.privacy.manage");
  if (!canManage) return <PermissionState title="You can't manage privacy and consent" description="Ask an administrator for the Manage CRM settings or Manage privacy permission." />;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <div>
        <h1 className="text-xl font-semibold">Privacy and consent</h1>
        <p className="text-sm text-text-secondary">
          Every agreement and refusal is kept in each person&apos;s consent history. A refusal puts their address on the opt-out list below; after an opt-out, consent can be recorded again only after 90 days, or sooner if the person asks.
        </p>
      </div>
      <OptOutList />
      <Lookup />
    </div>
  );
}

function OptOutList() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const key = scopedQueryKey(workspace, "crm", "opt-outs", search);
  const query = useQuery({ queryKey: key, queryFn: () => listOptOuts(search) });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OptOut | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opt-outs") });
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold">Opt-out list</h2>
        <div className="flex gap-2">
          <SearchField aria-label="Search the opt-out list" value={search} onChange={setSearch} placeholder="Email or number" />
          <Button variant="secondary" onPress={() => setAdding(true)}>Add</Button>
        </div>
      </div>
      {query.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
          {query.data?.length === 0 && <li className="px-3 py-4 text-text-secondary">Nobody on the list.</li>}
          {(query.data ?? []).map((entry) => (
            <li key={`${entry.kind}|${entry.value}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-48 flex-1 font-medium">{entry.kind === "phone" ? `Phone ending ${entry.value}` : entry.value}</span>
              <span className="text-text-secondary">{entry.channels.map((channel) => CHANNEL_LABEL[channel] ?? channel).join(", ")}</span>
              <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)} · {SOURCE_LABEL(entry.source)}{entry.reason ? ` · ${entry.reason}` : ""}</span>
              <Button variant="ghost" size="compact" onPress={() => setRemoving(entry)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
      {removing && <RemoveDialog entry={removing} onClose={() => setRemoving(null)} onSaved={() => { setRemoving(null); refresh(); }} />}
    </section>
  );
}

function AddDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => addOptOut({ email: email || undefined, phone: phone || undefined, reason: reason || undefined }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Add to the opt-out list">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
        <TextField label="Reason" value={reason} onChange={setReason} placeholder="Asked on a call…" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Add</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RemoveDialog({ entry, onClose, onSaved }: { entry: OptOut; onClose: () => void; onSaved: () => void }) {
  const [personAsked, setPersonAsked] = useState(false);
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => removeOptOut({ kind: entry.kind, value: entry.value, personAsked, reason: reason || undefined }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Take off the opt-out list">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <p className="text-sm text-text-secondary">An entry comes off 90 days after the opt-out, or sooner only if the person asked to be contacted again.</p>
        <Checkbox isSelected={personAsked} onChange={setPersonAsked}>The person asked to be contacted again</Checkbox>
        {personAsked && <TextField label="How they asked" value={reason} onChange={setReason} placeholder="Wrote to us on 3 Nov asking for the catalogue" />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Remove</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Lookup() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const lookup = useMutation({ mutationFn: () => lookupPersonalData({ email: email || undefined, phone: phone || undefined }) });
  const data = lookup.data;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Find everything held on a person</h2>
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
        <Button variant="primary" isLoading={lookup.isPending} isDisabled={!email.trim() && !phone.trim()} onPress={() => lookup.mutate()}>Look up</Button>
      </div>
      {lookup.isError && <Notice>{errorMessage(lookup.error)}</Notice>}
      {data && <LookupResult data={data} />}
    </section>
  );
}

function LookupResult({ data }: { data: PersonalData }) {
  const groups: Array<[string, Array<{ key: string; href: string | null; text: string }>]> = [
    ["Leads", data.leads.map((row) => ({ key: row.id, href: `/crm/leads/${row.id}`, text: `${row.code} · ${row.name} · ${row.status}` }))],
    ["Contacts", data.contacts.map((row) => ({ key: row.id, href: `/crm/contacts/${row.id}`, text: `${row.name}${row.code ? ` (${row.code})` : ""} · ${row.status}` }))],
    ["Companies", data.companies.map((row) => ({ key: row.id, href: `/crm/accounts/${row.id}`, text: `${row.code} · ${row.name}` }))],
    ["Deals", data.deals.map((row) => ({ key: row.id, href: `/crm/opportunities/${row.id}`, text: `${row.code} · ${row.name} · ${row.status}` }))],
    ["Emails", data.emails.map((row) => ({ key: row.id, href: `${HREF[row.recordType] ?? "/crm/leads/"}${row.recordId}`, text: `${row.direction === "inbound" ? "From" : "To"} them · ${row.subject} · ${formatDateTime(row.at)}` }))],
    ["WhatsApp messages", data.whatsapp.map((row) => ({ key: row.id, href: `${HREF[row.recordType] ?? "/crm/leads/"}${row.recordId}`, text: `${row.direction === "inbound" ? "From" : "To"} them · ${formatDateTime(row.at)}` }))],
    ["Consent history", data.consent.map((row, index) => ({ key: `${row.subjectId}-${index}`, href: null, text: `${ACTION_LABEL[row.action] ?? row.action} · ${CHANNEL_LABEL[row.channel] ?? row.channel} · ${SOURCE_LABEL(row.source)} · ${formatDateTime(row.at)}` }))],
    ["Opt-out list", data.optOuts.map((row) => ({ key: `${row.kind}|${row.value}`, href: null, text: `${row.kind} · ${row.channels.join(", ")} · ${formatDateTime(row.at)}` }))],
  ];
  const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
  if (!total) return <p className="text-sm text-text-secondary">CRM holds nothing on this email address or number.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
        <div key={title} className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{title} ({rows.length})</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((row) => <li key={row.key}>{row.href ? <Link className="text-brand hover:underline" href={row.href}>{row.text}</Link> : row.text}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
