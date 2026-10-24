"use client";

// CRM › Setup › Email templates (CRM plan 4.1): ready emails for leads, deals, companies and contacts, with placeholders that fill from
// the record ({{first_name}}, {{deal_name}}…), and the CRM email settings — the address replies go to (your email-to-lead address, so
// a reply lands back on its record) and the signature added to every email. The email composer on a record offers the active templates
// for that kind of record, most used first, and fills them in; each use is counted here.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Pencil, Plus, Power } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, SearchField, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LANGUAGES } from "@/features/crm/shared/languages";
import {
  createEmailTemplate, errorMessage, getEmailSettings, listEmailTemplates, saveEmailSettings, updateEmailTemplate, type EmailSettings, type EmailTemplate,
} from "@/features/crm/shared/email-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const APPLIES: Array<{ value: EmailTemplate["appliesTo"]; label: string }> = [
  { value: "any", label: "Any record" }, { value: "lead", label: "Leads" }, { value: "opportunity", label: "Deals" }, { value: "party", label: "Companies" }, { value: "contact", label: "Contacts" },
];
const appliesLabel = (value: EmailTemplate["appliesTo"]) => APPLIES.find((entry) => entry.value === value)?.label ?? value;
const languageLabel = (code: string) => LANGUAGES.find((entry) => entry.value === code)?.label ?? code;
// What a preview fills the placeholders with.
function sampleValues(myName: string, organization: string | null): Record<string, string> {
  return { first_name: "Priya", last_name: "Shah", name: "Priya Shah", company: "Mehta Fabrics", deal_name: "Billing software for 3 branches", amount: "₹1,20,000",
    close_date: "30 Nov 2026", product_interest: "Billing software", record_number: "LD-00042", owner_name: myName, my_name: myName, organization: organization ?? "Your company" };
}
// A message as plain words for the card's short preview (some templates are written in HTML).
const plain = (text: string) => text.replace(/<\/(p|div|li)>|<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const fill = (text: string, values: Record<string, string>) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
const unknownPlaceholders = (text: string, known: Set<string>) => [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]).filter((key) => !known.has(key)))];

export function EmailTemplatesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "email-templates", "all");
  const query = useQuery({ queryKey: key, queryFn: () => listEmailTemplates(true), enabled: canManage });
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "email-settings"), queryFn: getEmailSettings, enabled: canManage });
  const [editing, setEditing] = useState<{ template: EmailTemplate | null; copy?: boolean } | null>(null);
  const [previewing, setPreviewing] = useState<EmailTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [forFilter, setForFilter] = useState<"all" | EmailTemplate["appliesTo"]>("all");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "email-templates") });
  };
  const toggle = useMutation({
    mutationFn: (row: EmailTemplate) => updateEmailTemplate(row.id, { status: row.status === "active" ? "inactive" : "active" }),
    onSuccess: (row) => { setNotice({ tone: "success", text: row.status === "active" ? `${row.name} is offered again in the email composer.` : `${row.name} is switched off: no longer offered.` }); refresh(); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });
  const rows = useMemo(() => (query.data ?? []).filter((row) => (forFilter === "all" || row.appliesTo === forFilter)
    && `${row.name} ${row.subject}`.toLowerCase().includes(search.trim().toLowerCase())), [query.data, forFilter, search]);
  const samples = sampleValues(workspace.fullName, workspace.organizationName);

  if (!canManage) return <PermissionState title="You can't manage email templates" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Email templates" description="Ready emails to send from a lead, deal, company or contact. Placeholders fill from the record when you pick the template." />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {settings.data && <SettingsCard key={settings.dataUpdatedAt} settings={settings.data} onSaved={() => void settings.refetch()} />}
      {settings.isError && <Notice>{errorMessage(settings.error)}</Notice>}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField aria-label="Find a template" placeholder="Find a template" className="min-w-0 sm:max-w-xs sm:flex-1" value={search} onChange={setSearch} />
          <div className="flex items-center gap-2 sm:flex-1">
            <Select aria-label="For" size="compact" className="min-w-0 flex-1 sm:max-w-[11rem]" selectedKey={forFilter}
              onSelectionChange={(value) => setForFilter(String(value) as typeof forFilter)} options={[{ value: "all", label: "All records" }, ...APPLIES]} />
            <Button variant="primary" className="ml-auto shrink-0" isDisabled={!settings.data} onPress={() => { setNotice(null); setEditing({ template: null }); }}>
              <Plus className="size-4" aria-hidden="true" />New template</Button>
          </div>
        </div>
        {query.isLoading ? <LoadingState label="Loading templates" rows={4} /> : query.isError ? (
          <ErrorState title="Could not load the templates" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState title="No templates yet" description="Write the emails you send often: a first reply, a follow-up after a demo, a thank-you." />
        ) : rows.length === 0 ? <p className="text-sm text-text-secondary">No template matches.</p> : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rows.map((row) => {
              const languages = Object.keys(row.translations ?? {});
              return (
                <li key={row.id} className={`flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 ${row.status === "active" ? "" : "opacity-75"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{row.name}</span>
                      <span className="truncate text-sm text-text-secondary">{row.subject}</span>
                    </span>
                    <StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Off"}</StatusBadge>
                  </div>
                  <p className="line-clamp-2 text-xs text-text-muted">{plain(row.body)}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <Badge tone="neutral">{appliesLabel(row.appliesTo)}</Badge>
                    <span>{row.useCount ? `Sent ${row.useCount} time${row.useCount === 1 ? "" : "s"}` : "Not sent yet"}</span>
                    {languages.length > 0 && <span>{`Also in ${languages.map(languageLabel).join(", ")}`}</span>}
                  </div>
                  {/* Phone: two by two, Edit first; wider screens: one row on the right. */}
                  <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:flex sm:flex-wrap sm:justify-end">
                    <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`Preview ${row.name}`} onPress={() => setPreviewing(row)}><Eye className="size-3.5" aria-hidden="true" />Preview</Button>
                    <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`Copy ${row.name}`} onPress={() => { setNotice(null); setEditing({ template: row, copy: true }); }}><Copy className="size-3.5" aria-hidden="true" />Copy</Button>
                    <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`${row.status === "active" ? "Switch off" : "Switch on"} ${row.name}`} isDisabled={toggle.isPending} onPress={() => toggle.mutate(row)}>
                      <Power className="size-3.5" aria-hidden="true" />{row.status === "active" ? "Switch off" : "Switch on"}</Button>
                    <Button variant="secondary" size="compact" className="order-first w-full sm:order-none sm:w-auto" aria-label={`Edit ${row.name}`} onPress={() => { setNotice(null); setEditing({ template: row }); }}><Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {editing && settings.data && (
        <TemplateDialog template={editing.template} copy={Boolean(editing.copy)} placeholders={settings.data.placeholders} samples={samples} signature={settings.data.signature}
          onClose={() => setEditing(null)} onSaved={(saved, created) => { setEditing(null); setNotice({ tone: "success", text: created ? `Added ${saved.name}.` : `Saved ${saved.name}.` }); refresh(); }} />
      )}
      {previewing && <PreviewDialog template={previewing} samples={samples} signature={settings.data?.signature ?? null} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

function SettingsCard({ settings, onSaved }: { settings: EmailSettings; onSaved: () => void }) {
  const [replyTo, setReplyTo] = useState(settings.replyToAddress ?? "");
  const [signature, setSignature] = useState(settings.signature ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation({ mutationFn: () => saveEmailSettings({ replyToAddress: replyTo.trim() || null, signature: signature.trim() || null }), onSuccess: () => { setSaved(true); onSaved(); } });
  const changed = replyTo.trim() !== (settings.replyToAddress ?? "") || signature.trim() !== (settings.signature ?? "");
  return (
    <Panel title="Email from CRM" description="Applies to every email sent from a record, with or without a template.">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField label="Replies go to" type="email" value={replyTo} onChange={(value) => { setReplyTo(value); setSaved(false); }} placeholder="leads@yourcompany.com"
            description="Your email-to-lead address (Settings › Integrations › Inbound email), so a reply lands back on the record. Empty: replies go to the sender." />
          <TextArea label="Signature" value={signature} onChange={(value) => { setSignature(value); setSaved(false); }} rows={3} placeholder={"Regards,\nSales team, Your company\n+91 98765 43210"}
            description="Added under every email sent from CRM." />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!changed || save.isPending} onPress={() => save.mutate()}>Save</Button>
          {saved && !changed && <span className="text-sm text-text-secondary">Saved.</span>}
        </div>
      </div>
    </Panel>
  );
}

function EmailPreview({ subject, body, signature }: { subject: string; body: string; signature: string | null }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm">
      <span className="text-xs text-text-muted">Subject</span>
      <span className="font-medium break-words">{subject || "—"}</span>
      <span className="border-t border-border pt-2 text-xs text-text-muted">Message</span>
      <p className="whitespace-pre-wrap break-words">{body || "—"}</p>
      {signature && <p className="whitespace-pre-wrap break-words text-text-secondary">{`-- \n${signature}`}</p>}
    </div>
  );
}

function PreviewDialog({ template, samples, signature, onClose }: { template: EmailTemplate; samples: Record<string, string>; signature: string | null; onClose: () => void }) {
  const languages = ["en", ...Object.keys(template.translations ?? {})];
  const [language, setLanguage] = useState("en");
  const text = language === "en" ? { subject: template.subject, body: template.body } : template.translations?.[language];
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Preview · ${template.name}`} description="With sample values for a lead, Priya Shah of Mehta Fabrics." size="lg">
      <div className="flex flex-col gap-4">
        {languages.length > 1 && <Select label="Language" selectedKey={language} onSelectionChange={(value) => setLanguage(String(value))}
          options={languages.map((code) => ({ value: code, label: languageLabel(code) }))} />}
        <EmailPreview subject={fill(text?.subject ?? "", samples)} body={fill(text?.body ?? "", samples)} signature={signature} />
        <div className="flex justify-end"><Button variant="secondary" onPress={onClose}>Close</Button></div>
      </div>
    </Dialog>
  );
}

function TemplateDialog({ template, copy, placeholders, samples, signature, onClose, onSaved }: {
  template: EmailTemplate | null; copy: boolean; placeholders: EmailSettings["placeholders"]; samples: Record<string, string>; signature: string | null;
  onClose: () => void; onSaved: (saved: EmailTemplate, created: boolean) => void;
}) {
  const existing = copy ? null : template;
  const [name, setName] = useState(template ? (copy ? `${template.name} (copy)` : template.name) : "");
  const [appliesTo, setAppliesTo] = useState<EmailTemplate["appliesTo"]>(template?.appliesTo ?? "any");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [translations, setTranslations] = useState<Record<string, { subject: string; body: string }>>(template?.translations ?? {});
  const [language, setLanguage] = useState("en");
  const [target, setTarget] = useState<"subject" | "body">("body");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = language === "en" ? { subject, body } : translations[language] ?? { subject: "", body: "" };
  const setText = (field: "subject" | "body") => (value: string) => {
    setError(null);
    if (language === "en") (field === "subject" ? setSubject : setBody)(value);
    else setTranslations((current) => ({ ...current, [language]: { ...(current[language] ?? { subject: "", body: "" }), [field]: value } }));
  };
  const insert = (key: string) => {
    const current = editing[target];
    setText(target)(`${current}${current && !current.endsWith(" ") && !current.endsWith("\n") ? " " : ""}{{${key}}}`);
  };
  const known = useMemo(() => new Set(placeholders.map((entry) => entry.key)), [placeholders]);
  const unknown = unknownPlaceholders([subject, body, ...Object.values(translations).flatMap((entry) => [entry.subject, entry.body])].join(" "), known);
  const translationIncomplete = Object.entries(translations).find(([, entry]) => Boolean(entry.subject.trim()) !== Boolean(entry.body.trim()));
  const ready = Boolean(name.trim() && subject.trim() && body.trim()) && unknown.length === 0 && !translationIncomplete;
  const save = useMutation({
    mutationFn: () => (existing ? updateEmailTemplate(existing.id, { name, appliesTo, subject, body, translations }) : createEmailTemplate({ name, appliesTo, subject, body, translations })),
    onSuccess: (saved) => onSaved(saved, !existing), onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={existing ? `Edit ${existing.name}` : copy ? `Copy of ${template?.name}` : "New email template"} size="lg">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {error && <Notice>{error}</Notice>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={(value) => { setName(value); setError(null); }} description="Only your team sees it, in the composer." />
          <Select label="For" selectedKey={appliesTo} onSelectionChange={(value) => setAppliesTo(String(value) as EmailTemplate["appliesTo"])} options={APPLIES}
            description="Which records offer it." />
        </div>
        <Select label="Language" description="Write it in English, then in the languages your customers speak; each person gets theirs."
          selectedKey={language} onSelectionChange={(value) => setLanguage(String(value))}
          options={LANGUAGES.map((entry) => ({ ...entry, label: entry.value !== "en" && translations[entry.value]?.subject ? `${entry.label} (written)` : entry.label }))} />
        <div onFocusCapture={() => setTarget("subject")}>
          <TextField label="Subject" isRequired={language === "en"} value={editing.subject} onChange={setText("subject")} />
        </div>
        <div onFocusCapture={() => setTarget("body")}>
          <TextArea label="Message" isRequired={language === "en"} value={editing.body} onChange={setText("body")} rows={9} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">{`Insert into the ${target === "subject" ? "subject" : "message"}`}</span>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((entry) => (
              <button key={entry.key} type="button" title={`{{${entry.key}}}`} onClick={() => insert(entry.key)}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        {unknown.length > 0 && <Notice>{`${unknown.map((key) => `{{${key}}}`).join(", ")} ${unknown.length === 1 ? "is" : "are"} not a placeholder: fix the spelling or insert one from the list.`}</Notice>}
        {translationIncomplete && <Notice>{`${languageLabel(translationIncomplete[0])}: write both the subject and the message, or clear both.`}</Notice>}
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="compact" className="self-start" onPress={() => setShowPreview((value) => !value)}>
            <Eye className="size-3.5" aria-hidden="true" />{showPreview ? "Hide preview" : "Preview with sample values"}</Button>
          {showPreview && <EmailPreview subject={fill(editing.subject, samples)} body={fill(editing.body, samples)} signature={signature} />}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending}>{existing ? "Save" : "Create template"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
