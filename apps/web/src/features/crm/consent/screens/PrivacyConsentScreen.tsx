"use client";

// CRM › Setup › Privacy and consent (CRM plan 4.3): the opt-out list — addresses and numbers no email or message from CRM may reach,
// whichever record they are on (campaign unsubscribes and WhatsApp STOP replies land here by themselves) — and the lookup of everything
// CRM holds on one person, for a privacy request under the DPDP Act, with a copy to download for the person.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Search } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, PageHeader, PermissionState, SearchField, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { ACTION_LABEL, CHANNEL_LABEL, SOURCE_LABEL, addOptOut, errorMessage, listOptOuts, lookupPersonalData, removeOptOut, type OptOut, type PersonalData } from "@/features/crm/shared/consent-api";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const HREF: Record<string, string> = { lead: "/crm/leads/", contact: "/crm/contacts/", party: "/crm/accounts/", opportunity: "/crm/opportunities/" };
const CHANNELS = [{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }, { value: "whatsapp", label: "WhatsApp" }, { value: "call", label: "Calls" }];
const shownValue = (entry: { kind: string; value: string }) => (entry.kind === "phone" ? `Phone ending ${entry.value}` : entry.value);
const blocks = (channels: string[]) => (channels.includes("all") ? ["Any contact"] : channels.map((channel) => CHANNEL_LABEL[channel] ?? channel));

export function PrivacyConsentScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage") || workspace.permissions.includes("platform.privacy.manage");
  if (!canManage) return <PermissionState title="You can't manage privacy and consent" description="Ask an administrator for the Manage CRM settings or Manage privacy permission." />;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Privacy and consent" description="Who must not be contacted, and everything CRM holds on a person when they ask." />
      <Notice tone="info">
        Every agreement and refusal is kept in each person&apos;s consent history. A refusal puts their email or number on the opt-out list; for 90 days after,
        consent can be recorded again only if the person asks.
      </Notice>
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
  const query = useQuery({ queryKey: key, queryFn: () => listOptOuts(search), placeholderData: (previous) => previous });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OptOut | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opt-outs") });
  const rows = query.data ?? [];
  return (
    <Panel title={`Opt-out list${query.data ? ` (${rows.length}${rows.length === 500 ? "+" : ""})` : ""}`}
      description="No email, SMS, WhatsApp message or call from CRM reaches these, on any record. Unsubscribes and STOP replies are added by themselves."
      actions={<Button variant="secondary" size="compact" onPress={() => { setDone(null); setAdding(true); }}><Plus className="size-4" aria-hidden="true" />Add</Button>}>
      <div className="flex flex-col gap-3">
        <SearchField aria-label="Search the opt-out list" className="w-full sm:max-w-sm" value={search} onChange={setSearch} placeholder="Email or number" />
        {done && <Notice tone="success">{done}</Notice>}
        {query.isLoading ? <LoadingState label="Loading the opt-out list" rows={3} /> : query.isError ? <Notice>{errorMessage(query.error)}</Notice> : rows.length === 0 ? (
          <p className="text-sm text-text-secondary">{search ? "Nobody on the list matches." : "Nobody is on the opt-out list."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
            {rows.map((entry) => {
              const lifted = new Date(entry.removableFrom).getTime() <= Date.now();
              return (
                <li key={`${entry.kind}|${entry.value}`} className="grid grid-cols-1 gap-2 p-3 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center md:gap-4">
                  <span className="min-w-0 break-all font-medium">{shownValue(entry)}</span>
                  <span className="flex flex-wrap gap-1">{blocks(entry.channels).map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}</span>
                  <span className="flex min-w-0 flex-col text-xs text-text-muted">
                    <span>{`${formatDateTime(entry.createdAt)} · ${SOURCE_LABEL(entry.source)}${entry.createdByName ? ` (${entry.createdByName})` : ""}`}</span>
                    {entry.reason && <span className="text-text-secondary">{entry.reason}</span>}
                    <span>{lifted ? "Can come off the list now" : `Can come off from ${formatDate(entry.removableFrom)}, or sooner if they ask`}</span>
                  </span>
                  <Button variant="ghost" size="compact" className="justify-self-start md:justify-self-end" onPress={() => { setDone(null); setRemoving(entry); }}>Remove</Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {adding && <AddDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setDone("Added to the opt-out list."); refresh(); }} />}
      {removing && <RemoveDialog entry={removing} onClose={() => setRemoving(null)} onSaved={() => { setDone(`${shownValue(removing)} is off the opt-out list.`); setRemoving(null); refresh(); }} />}
    </Panel>
  );
}

function AddDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [everything, setEverything] = useState(true);
  const [channels, setChannels] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => addOptOut({ email: email.trim() || undefined, phone: phone.trim() || undefined, reason: reason.trim() || undefined, channels: everything ? ["all"] : channels }),
    onSuccess: onSaved,
  });
  const ready = Boolean(email.trim() || phone.trim()) && (everything || channels.length > 0);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Add to the opt-out list" description="Someone asked not to be contacted: by phone, in person or in writing.">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Email" type="email" value={email} onChange={setEmail} />
          <TextField label="Phone" type="tel" value={phone} onChange={setPhone} description="Any format; +91 is understood." />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Do not contact by</span>
          <Checkbox isSelected={everything} onChange={setEverything}>Any way (email, SMS, WhatsApp and calls)</Checkbox>
          {!everything && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              {CHANNELS.map((channel) => (
                <Checkbox key={channel.value} isSelected={channels.includes(channel.value)}
                  onChange={(on) => setChannels((current) => (on ? [...current, channel.value] : current.filter((entry) => entry !== channel.value)))}>{channel.label}</Checkbox>
              ))}
            </div>
          )}
        </div>
        <TextField label="Reason" value={reason} onChange={setReason} placeholder="Asked on a call not to receive offers" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending} onPress={() => save.mutate()}>Add</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RemoveDialog({ entry, onClose, onSaved }: { entry: OptOut; onClose: () => void; onSaved: () => void }) {
  const lifted = new Date(entry.removableFrom).getTime() <= Date.now();
  const [personAsked, setPersonAsked] = useState(!lifted);
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => removeOptOut({ kind: entry.kind, value: entry.value, personAsked, reason: reason.trim() || undefined }), onSuccess: onSaved });
  const ready = !personAsked || Boolean(reason.trim());
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Take ${shownValue(entry)} off the list`}>
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <p className="text-sm text-text-secondary">
          {lifted ? "It has been 90 days since the opt-out, so it can come off now. CRM may contact them again."
            : `Added ${formatDate(entry.createdAt)}: before ${formatDate(entry.removableFrom)} it comes off only if the person asked to be contacted again.`}
        </p>
        <Checkbox isSelected={personAsked} isDisabled={!lifted} onChange={setPersonAsked}>The person asked to be contacted again</Checkbox>
        {personAsked && <TextField label="How they asked" isRequired value={reason} onChange={setReason} placeholder="Wrote to us on 3 Nov asking for the catalogue" />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending} onPress={() => save.mutate()}>Remove</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Lookup() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const lookup = useMutation({ mutationFn: () => lookupPersonalData({ email: email.trim() || undefined, phone: phone.trim() || undefined }) });
  return (
    <Panel title="Find everything held on a person" description="For a privacy request: every record, email, WhatsApp message, consent and opt-out with their email or number.">
      <div className="flex flex-col gap-4">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => { event.preventDefault(); if (email.trim() || phone.trim()) lookup.mutate(); }}>
          <TextField label="Email" type="email" value={email} onChange={setEmail} />
          <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
          <Button type="submit" variant="primary" isLoading={lookup.isPending} isDisabled={!email.trim() && !phone.trim()}><Search className="size-4" aria-hidden="true" />Look up</Button>
        </form>
        {lookup.isError && <Notice>{errorMessage(lookup.error)}</Notice>}
        {lookup.data && <LookupResult data={lookup.data} />}
      </div>
    </Panel>
  );
}

function LookupResult({ data }: { data: PersonalData }) {
  const groups = useMemo<Array<[string, Array<{ key: string; href: string | null; text: string; detail?: string }>]>>(() => [
    ["Leads", data.leads.map((row) => ({ key: row.id, href: `/crm/leads/${row.id}`, text: `${row.code} · ${row.name}`, detail: [row.email, row.mobile, row.status].filter(Boolean).join(" · ") }))],
    ["Contacts", data.contacts.map((row) => ({ key: row.id, href: `/crm/contacts/${row.id}`, text: `${row.name}${row.code ? ` (${row.code})` : ""}`, detail: [row.email, row.mobile, row.status].filter(Boolean).join(" · ") }))],
    ["Companies", data.companies.map((row) => ({ key: row.id, href: `/crm/accounts/${row.id}`, text: `${row.code} · ${row.name}`, detail: [row.email, row.phone].filter(Boolean).join(" · ") }))],
    ["Deals", data.deals.map((row) => ({ key: row.id, href: `/crm/opportunities/${row.id}`, text: `${row.code} · ${row.name}`, detail: row.status }))],
    ["Emails", data.emails.map((row) => ({ key: row.id, href: `${HREF[row.recordType] ?? "/crm/leads/"}${row.recordId}`, text: `${row.direction === "inbound" ? "From" : "To"} them · ${row.subject}`, detail: formatDateTime(row.at) }))],
    ["WhatsApp messages", data.whatsapp.map((row) => ({ key: row.id, href: `${HREF[row.recordType] ?? "/crm/leads/"}${row.recordId}`, text: `${row.direction === "inbound" ? "From" : "To"} them`, detail: formatDateTime(row.at) }))],
    ["Consent history", data.consent.map((row, index) => ({ key: `${row.subjectId}-${index}`, href: null, text: `${ACTION_LABEL[row.action] ?? row.action} · ${CHANNEL_LABEL[row.channel] ?? row.channel}`,
      detail: `${SOURCE_LABEL(row.source)} · ${formatDateTime(row.at)}${row.evidence ? ` · ${row.evidence}` : ""}` }))],
    ["Opt-out list", data.optOuts.map((row) => ({ key: `${row.kind}|${row.value}`, href: null, text: `${shownValue(row)} · ${blocks(row.channels).join(", ")}`, detail: `${SOURCE_LABEL(row.source)} · ${formatDateTime(row.at)}` }))],
  ], [data]);
  const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
  // A copy of what CRM holds, to send to the person (their right of access under the DPDP Act).
  const download = () => {
    const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `personal-data-${(data.query.email ?? data.query.phone ?? "person").replace(/[^a-z0-9.@-]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (!total) return <p className="text-sm text-text-secondary">CRM holds nothing on this email address or number.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">{`${total} item${total === 1 ? "" : "s"} found across ${groups.filter(([, rows]) => rows.length).length} kinds of record.`}</p>
        <Button variant="secondary" className="w-full sm:w-auto" onPress={download}><Download className="size-4" aria-hidden="true" />Download a copy</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
          <div key={title} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
            <h3 className="text-sm font-semibold">{`${title} (${rows.length})`}</h3>
            <ul className="flex flex-col gap-2 text-sm">
              {rows.map((row) => (
                <li key={row.key} className="flex min-w-0 flex-col">
                  {row.href ? <Link className="break-words text-brand hover:underline" href={row.href}>{row.text}</Link> : <span className="break-words">{row.text}</span>}
                  {row.detail && <span className="break-words text-xs text-text-muted">{row.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
