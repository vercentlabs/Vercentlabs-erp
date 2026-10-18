"use client";

// CRM › Setup › Email templates (CRM plan 4.1): ready emails for leads, deals, companies and contacts, with placeholders that fill from
// the record ({{first_name}}, {{deal_name}}…), and the CRM email settings — the address replies go to (your email-to-lead address, so
// a reply lands back on its record) and the signature added to every email.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LANGUAGES } from "@/features/crm/shared/languages";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import {
  createEmailTemplate, errorMessage, getEmailSettings, listEmailTemplates, saveEmailSettings, updateEmailTemplate, type EmailSettings, type EmailTemplate,
} from "@/features/crm/shared/email-api";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const APPLIES: Array<{ value: EmailTemplate["appliesTo"]; label: string }> = [
  { value: "any", label: "Any record" }, { value: "lead", label: "Leads" }, { value: "opportunity", label: "Deals" }, { value: "party", label: "Companies" }, { value: "contact", label: "Contacts" },
];

export function EmailTemplatesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "email-templates", "all");
  const query = useQuery({ queryKey: key, queryFn: () => listEmailTemplates(true), enabled: canManage });
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "email-settings"), queryFn: getEmailSettings, enabled: canManage });
  const [editing, setEditing] = useState<EmailTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const toggle = useMutation({
    mutationFn: (row: EmailTemplate) => updateEmailTemplate(row.id, { status: row.status === "active" ? "inactive" : "active" }),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];
  const columns = useMemo<ColumnDef<EmailTemplate, unknown>[]>(() => [
    { id: "name", header: "Template", cell: ({ row }) => <span className="flex flex-col"><span className="font-medium">{row.original.name}</span><span className="text-xs text-text-muted">{row.original.subject}</span></span> },
    { id: "for", header: "For", cell: ({ row }) => APPLIES.find((entry) => entry.value === row.original.appliesTo)?.label },
    { id: "used", header: "Used", cell: ({ row }) => <span className="tabular-nums">{row.original.useCount}</span> },
    { id: "state", header: "State", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Active" : "Off"}</StatusBadge> },
  ], []);

  if (!canManage) return <PermissionState title="You can't manage email templates" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      {error && <Notice>{error}</Notice>}
      {settings.data && <SettingsCard key={settings.dataUpdatedAt} settings={settings.data} onSaved={() => void settings.refetch()} />}
      <EnterpriseListPage
        header={{
          title: "Email templates",
          description: "Ready emails to send from a lead, deal, company or contact. Placeholders fill from the record when you pick the template.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New template</Button>,
        }}
      >
        <EnterpriseDataGrid<EmailTemplate>
          aria-label="Email templates"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          {...gridStates(query, rows.length, "templates", { title: "No templates", description: "Write the emails you send often: a first reply, a follow-up after a demo, a thank-you." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <MoreMenu label={`Actions for ${row.name}`} items={[
                { id: "edit", label: "Edit", onAction: () => setEditing(row) },
                { id: "state", label: row.status === "active" ? "Switch off" : "Switch on", isDisabled: toggle.isPending, onAction: () => toggle.mutate(row) },
              ]} />
            </span>
          )}
          renderMobileCard={(row) => <div className="flex flex-col"><span className="font-medium">{row.name}</span><span className="text-xs text-text-muted">{row.subject}</span></div>}
        />
      </EnterpriseListPage>
      {editing && settings.data && (
        <TemplateDialog template={editing === "new" ? null : editing} placeholders={settings.data.placeholders} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

function SettingsCard({ settings, onSaved }: { settings: EmailSettings; onSaved: () => void }) {
  const [replyTo, setReplyTo] = useState(settings.replyToAddress ?? "");
  const [signature, setSignature] = useState(settings.signature ?? "");
  const save = useMutation({ mutationFn: () => saveEmailSettings({ replyToAddress: replyTo.trim() || null, signature: signature.trim() || null }), onSuccess: onSaved });
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Email from CRM</h2>
      {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Replies go to" type="email" value={replyTo} onChange={setReplyTo}
          description="Your email-to-lead address (Settings › Integrations › Inbound email), so a customer's reply lands back on the record. Empty: replies go to the sender." />
        <TextArea label="Signature" value={signature} onChange={setSignature} description="Added under every email sent from CRM." />
      </div>
      <div><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
    </section>
  );
}

function TemplateDialog({ template, placeholders, onClose, onSaved }: { template: EmailTemplate | null; placeholders: EmailSettings["placeholders"]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [appliesTo, setAppliesTo] = useState<EmailTemplate["appliesTo"]>(template?.appliesTo ?? "any");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [translations, setTranslations] = useState<Record<string, { subject: string; body: string }>>(template?.translations ?? {});
  const [language, setLanguage] = useState("en");
  const [error, setError] = useState<string | null>(null);
  const editing = language === "en" ? { subject, body } : translations[language] ?? { subject: "", body: "" };
  const setText = (field: "subject" | "body") => (value: string) => {
    if (language === "en") (field === "subject" ? setSubject : setBody)(value);
    else setTranslations((current) => ({ ...current, [language]: { ...(current[language] ?? { subject: "", body: "" }), [field]: value } }));
  };
  const save = useMutation({
    mutationFn: () => (template ? updateEmailTemplate(template.id, { name, appliesTo, subject, body, translations }) : createEmailTemplate({ name, appliesTo, subject, body, translations })),
    onSuccess: onSaved, onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={template ? `Edit ${template.name}` : "New email template"} size="lg">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={setName} />
          <Select label="For" selectedKey={appliesTo} onSelectionChange={(value) => setAppliesTo(String(value) as EmailTemplate["appliesTo"])} options={APPLIES} />
        </div>
        <Select label="Language" description="Write the template in English, then in the languages your customers speak; each person gets the one in their language."
          selectedKey={language} onSelectionChange={(key) => setLanguage(String(key))}
          options={LANGUAGES.map((entry) => ({ ...entry, label: entry.value !== "en" && translations[entry.value]?.subject ? `${entry.label} ✓` : entry.label }))} />
        <TextField label="Subject" isRequired={language === "en"} value={editing.subject} onChange={setText("subject")} />
        <TextArea label="Message" isRequired={language === "en"} value={editing.body} onChange={setText("body")} rows={10} />
        <div className="flex flex-col gap-1 text-xs text-text-secondary">
          <span className="font-medium">Placeholders</span>
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {placeholders.map((entry) => (
              <button key={entry.key} type="button" className="font-mono text-brand hover:underline" title={entry.label} onClick={() => setText("body")(`${editing.body}{{${entry.key}}}`)}>
                {`{{${entry.key}}}`}
              </button>
            ))}
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{template ? "Save" : "Create template"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
