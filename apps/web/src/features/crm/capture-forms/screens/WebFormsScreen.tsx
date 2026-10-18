"use client";

// CRM › Setup › Web forms (CRM plan 3.2): the forms that bring leads in from the organization's website. Each form chooses the fields it
// asks for, the source and owner its leads get, the websites allowed to post it, the thank-you message or page, and an optional consent
// notice — kept in versions, so each lead records the wording its person agreed to. "Get the code" gives the hosted page's link, an
// iframe to paste into a website, and the address a website's own form can post to.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Plus } from "lucide-react";
import { Button, Checkbox, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, StatusBadge, Switch, TextArea, TextField } from "@vercentlabs/design-system";

import { LANGUAGES } from "@/features/crm/shared/languages";

// The languages a web form can be shown in (the labels exist for these).
const FORM_LANGUAGES = LANGUAGES.filter((entry) => ["en", "hi", "mr", "gu", "bn", "ta", "te", "kn", "ml", "pa"].includes(entry.value));

import { getLeadOptions } from "@/features/crm/leads/api/leads-api";
import { campaignChoices } from "@/features/crm/shared/marketing-api";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  CAPTURE_FIELDS, createCaptureForm, errorMessage, fieldErrors, listCaptureForms, listCaptureNotices, setCaptureFormStatus, updateCaptureForm,
  type CaptureFieldName, type CaptureForm,
} from "../api/capture-forms-api";

const NONE = "__none__";

export function WebFormsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.capture.manage");
  const key = scopedQueryKey(workspace, "crm", "capture-forms");
  const query = useQuery({ queryKey: key, queryFn: listCaptureForms, enabled: canManage });
  const [editing, setEditing] = useState<CaptureForm | "new" | null>(null);
  const [coding, setCoding] = useState<CaptureForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const toggle = useMutation({
    mutationFn: (form: CaptureForm) => setCaptureFormStatus(form.id, form.status === "active" ? "inactive" : "active"),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];
  const columns = useMemo<ColumnDef<CaptureForm, unknown>[]>(() => [
    { id: "name", header: "Form", accessorKey: "name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "fields", header: "Asks for", cell: ({ row }) => row.original.fields.map((field) => CAPTURE_FIELDS.find((entry) => entry.name === field.name)?.label ?? field.name).join(", ") },
    { id: "source", header: "Source", cell: ({ row }) => row.original.sourceName ?? "" },
    { id: "notice", header: "Consent notice", cell: ({ row }) => (row.original.noticeVersion ? `Version ${row.original.noticeVersion}` : "None") },
    { id: "leads", header: "Leads", cell: ({ row }) => <span className="tabular-nums">{row.original.leadCount}</span> },
    { id: "state", header: "State", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Taking submissions" : "Off"}</StatusBadge> },
  ], []);

  if (!canManage) return <PermissionState title="You can't manage web forms" description="Ask an administrator for the Manage lead capture permission." />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      {error && <Notice>{error}</Notice>}
      <EnterpriseListPage
        header={{
          title: "Web forms",
          description: "Forms on your website that bring leads in. Each submission becomes a lead with the form's source and owner, checked for duplicates and assigned by your rules.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New form</Button>,
        }}
      >
        <EnterpriseDataGrid<CaptureForm>
          aria-label="Web forms"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "web forms", { title: "No web forms", description: "Create a form, then put it on your website with the code it gives you." })}
          rowActions={(row) => (
            <span className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="compact" onPress={() => setCoding(row)}>Get the code</Button>
              <Button variant="ghost" size="compact" onPress={() => setEditing(row)}>Edit</Button>
              <Button variant="ghost" size="compact" onPress={() => toggle.mutate(row)} isDisabled={toggle.isPending}>{row.status === "active" ? "Switch off" : "Switch on"}</Button>
            </span>
          )}
          renderMobileCard={(row) => (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-xs text-text-muted">{row.status === "active" ? "Taking submissions" : "Off"} · {row.leadCount} {row.leadCount === 1 ? "lead" : "leads"}</span>
              </div>
              <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
                <MoreMenu label={`Actions for ${row.name}`} items={[
                  { id: "code", label: "Get the code", onAction: () => setCoding(row) },
                  { id: "edit", label: "Edit", onAction: () => setEditing(row) },
                  { id: "state", label: row.status === "active" ? "Switch off" : "Switch on", isDisabled: toggle.isPending, onAction: () => toggle.mutate(row) },
                ]} />
              </div>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && <FormDialog form={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(saved) => { refresh(); setEditing(null); if (editing === "new") setCoding(saved); }} />}
      {coding && <CodeDialog form={coding} onClose={() => setCoding(null)} />}
    </div>
  );
}

function FormDialog({ form, onClose, onSaved }: { form: CaptureForm | null; onClose: () => void; onSaved: (form: CaptureForm) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 }).data;
  const [name, setName] = useState(form?.name ?? "");
  const [fields, setFields] = useState<Array<{ name: CaptureFieldName; required: boolean }>>(form?.fields ?? [
    { name: "firstName", required: true }, { name: "lastName", required: false }, { name: "email", required: true }, { name: "mobile", required: false },
    { name: "companyName", required: false }, { name: "description", required: false },
  ]);
  const [sourceId, setSourceId] = useState(form?.sourceId ?? NONE);
  const [campaignId, setCampaignId] = useState(form?.campaignId ?? NONE);
  const [ownerUserId, setOwnerUserId] = useState(form?.ownerUserId ?? NONE);
  const [origins, setOrigins] = useState((form?.allowedOrigins ?? []).join("\n"));
  const [successMessage, setSuccessMessage] = useState(form?.successMessage ?? "Thank you. Our team will contact you shortly.");
  // the language the form is shown in (CRM plan 5.6)
  const [language, setLanguage] = useState(form?.language ?? "en");
  const [thankYouUrl, setThankYouUrl] = useState(form?.thankYouUrl ?? "");
  const [noticeText, setNoticeText] = useState(form?.noticeText ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name, fields, sourceId: sourceId === NONE ? null : sourceId, campaignId: campaignId === NONE ? null : campaignId, ownerUserId: ownerUserId === NONE ? null : ownerUserId,
        allowedOrigins: origins.split(/[\s,]+/).filter(Boolean), successMessage, thankYouUrl: thankYouUrl.trim() || null, noticeText: noticeText.trim() || null,
        language,
      };
      return form ? updateCaptureForm(form.id, { ...input, expectedUpdatedAt: form.updatedAt }) : createCaptureForm(input);
    },
    onSuccess: onSaved,
    onError: (failure) => setErrors({ form: errorMessage(failure), ...fieldErrors(failure) }),
  });
  const chosen = new Map(fields.map((field) => [field.name, field]));
  const toggleField = (fieldName: CaptureFieldName, on: boolean) =>
    setFields((current) => (on ? [...current, { name: fieldName, required: false }].sort((a, b) => order(a.name) - order(b.name)) : current.filter((field) => field.name !== fieldName)));
  const requireField = (fieldName: CaptureFieldName, required: boolean) => setFields((current) => current.map((field) => (field.name === fieldName ? { ...field, required } : field)));
  const noticeChanged = form && (form.noticeText ?? "") !== noticeText.trim();
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={form ? `Edit ${form.name}` : "New web form"} size="lg">
      <div className="flex flex-col gap-4">
        {errors.form && !Object.keys(errors).some((field) => field !== "form") && <Notice>{errors.form}</Notice>}
        <TextField label="Name" isRequired value={name} onChange={setName} description="For you; visitors see it as the form's title." isInvalid={Boolean(errors.name)} errorMessage={errors.name} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What the form asks for</legend>
          {errors.fields && <p className="text-sm text-danger">{errors.fields}</p>}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {CAPTURE_FIELDS.map((field) => (
              <div key={field.name} className="flex items-center justify-between gap-2">
                <Checkbox isSelected={chosen.has(field.name)} onChange={(on) => toggleField(field.name, on)}>{field.label}</Checkbox>
                {chosen.has(field.name) && <Switch isSelected={chosen.get(field.name)!.required} onChange={(on) => requireField(field.name, on)}>Required</Switch>}
              </div>
            ))}
          </div>
        </fieldset>
        {options && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Source of its leads" selectedKey={sourceId} onSelectionChange={(value) => setSourceId(String(value))} isInvalid={Boolean(errors.sourceId)} errorMessage={errors.sourceId}
              options={[{ value: NONE, label: "None" }, ...options.sources.filter((source) => source.isActive).map((source) => ({ value: source.id, label: source.name }))]} />
            <Select label="Campaign of its leads" description="A page's utm_campaign, when it names a campaign, wins." selectedKey={campaignId}
              onSelectionChange={(value) => setCampaignId(String(value))} isInvalid={Boolean(errors.campaignId)} errorMessage={errors.campaignId}
              options={[{ value: NONE, label: "None" }, ...campaignChoices(options.campaigns ?? [], form?.campaignId ?? null, form?.campaignName ?? null)]} />
            <Select label="Owner of its leads" description="Or leave it to the assignment rules." selectedKey={ownerUserId} onSelectionChange={(value) => setOwnerUserId(String(value))}
              isInvalid={Boolean(errors.ownerUserId)} errorMessage={errors.ownerUserId}
              options={[{ value: NONE, label: "By the assignment rules" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))]} />
          </div>
        )}
        <TextArea label="Websites that may post it" value={origins} onChange={setOrigins} isInvalid={Boolean(errors.allowedOrigins)} errorMessage={errors.allowedOrigins}
          description="One per line, such as https://www.yourcompany.in. Leave empty to accept any website. The hosted page and its iframe always may." />
        <Select label="Form language" selectedKey={language} onSelectionChange={(key) => setLanguage(String(key))}
          description="The field labels and the button are shown in it. Write the form's name, notice and thank-you message in the same language."
          options={FORM_LANGUAGES} />
        <TextField label="Thank-you message" value={successMessage} onChange={setSuccessMessage} isInvalid={Boolean(errors.successMessage)} errorMessage={errors.successMessage} />
        <TextField label="Thank-you page (optional)" value={thankYouUrl} onChange={setThankYouUrl} description="An https:// page to open after sending, instead of the message."
          isInvalid={Boolean(errors.thankYouUrl)} errorMessage={errors.thankYouUrl} />
        <TextArea label="Consent notice (optional)" value={noticeText} onChange={setNoticeText}
          description={noticeChanged && form?.noticeVersion ? `Saving keeps version ${form.noticeVersion} for the leads that agreed to it and makes this wording the next version.`
            : "Shown with a box to tick before sending, such as \"I agree that Acme may contact me about my enquiry.\" Each lead records the version it agreed to."} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{form ? "Save" : "Create form"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

const order = (fieldName: CaptureFieldName) => CAPTURE_FIELDS.findIndex((field) => field.name === fieldName);

function CodeDialog({ form, onClose }: { form: CaptureForm; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const notices = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "capture-notices", form.id), queryFn: () => listCaptureNotices(form.id) });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const page = `${origin}/f/${form.publicKey}`;
  const endpoint = `${origin}/api/crm/public/capture/${form.publicKey}`;
  // The iframe passes its own page's utm_ values on, so a campaign link to the website is still counted.
  const iframe = `<iframe id="vl-form-${form.publicKey.slice(0, 8)}" src="${page}" title="${form.name.replace(/"/g, "&quot;")}" style="width:100%;min-height:640px;border:0" loading="lazy"></iframe>`;
  const fieldNames = form.fields.map((field) => field.name);
  const passUtm = `<script>(function(){var f=document.getElementById("vl-form-${form.publicKey.slice(0, 8)}");if(f&&location.search)f.src+=location.search;})();</script>`;
  const script = `fetch("${endpoint}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ ${fieldNames.map((fieldName) => `${fieldName}: "…"`).join(", ")}${form.noticeText ? ", consentAccepted: true" : ""}, utmSource: "…", utmMedium: "…", utmCampaign: "…" }),\n});`;
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Put "${form.name}" on your website`} size="lg">
      <div className="flex flex-col gap-4 text-sm">
        {form.status !== "active" && <Notice tone="warning">This form is switched off: its page and embeds take no submissions until you switch it on.</Notice>}
        <Snippet label="Its own page — share the link, or link to it from your site" value={page} />
        <Snippet label="Embed it in a page of your website" value={`${iframe}
${passUtm}`} help="The small script passes the page's utm_ values to the form, so campaign links are counted." />
        <Snippet label="Or post from your website's own form (JSON)" value={script}
          help={form.allowedOrigins.length ? `Accepted only from ${form.allowedOrigins.join(", ")}.` : "Add your website under \"Websites that may post it\" to accept posts only from it."} />
        {(notices.data?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Consent notice versions</h3>
            <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border">
              {notices.data!.map((notice) => (
                <li key={notice.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-xs text-text-muted">Version {notice.version}{notice.version === form.noticeVersion ? " · current" : ""} · {formatDateTime(notice.createdAt)}{notice.createdByName ? ` by ${notice.createdByName}` : ""} · {notice.leadCount} {notice.leadCount === 1 ? "lead" : "leads"} agreed</span>
                  <span>{notice.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end"><Button variant="primary" onPress={onClose}>Done</Button></div>
      </div>
    </Dialog>
  );
}

function Snippet({ label, value, help }: { label: string; value: string; help?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Button variant="ghost" size="compact" onPress={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true)); }}>
          <Copy className="size-4" aria-hidden="true" />{copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--radius-card)] border border-border bg-surface-muted p-3 text-xs">{value}</pre>
      {help && <span className="text-xs text-text-muted">{help}</span>}
    </div>
  );
}
