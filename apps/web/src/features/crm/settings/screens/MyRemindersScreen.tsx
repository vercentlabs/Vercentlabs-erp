"use client";

// Reminders on WhatsApp and SMS (CRM audit M6). Everyone chooses for themselves whether their follow-up and task reminders also reach
// them on WhatsApp or by SMS, at their mobile. A CRM administrator names the approved WhatsApp template and the DLT SMS template that
// carry a reminder (WhatsApp and TRAI allow only those).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { listSmsTemplates } from "@/features/crm/shared/channels-api";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class RemindersApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(RemindersApiError, "body");

type Mine = { whatsapp: boolean; sms: boolean; mobile: string | null; whatsappReady: boolean; smsReady: boolean };
type Templates = { whatsappTemplate: string | null; whatsappLanguage: string; smsTemplateId: string | null };
const NONE = "none";
const LANGUAGES = [{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "mr", label: "Marathi" }, { value: "gu", label: "Gujarati" }, { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" }, { value: "kn", label: "Kannada" }, { value: "bn", label: "Bengali" }];
const message = (error: unknown) => (error instanceof Error && error.message ? error.message : "That did not work. Try again.");

export function MyRemindersScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "my-reminders");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ mine: Mine; templates: Templates }>("/api/crm/my-reminders") });
  if (query.isLoading) return <LoadingState label="Loading reminders" rows={3} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load reminders" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Reminders on your phone" description="Your follow-up and task reminders always appear in the app. Choose to get them on WhatsApp or by SMS as well." />
      <MineSection mine={query.data.mine} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />
      {canManage && <CompanySection templates={query.data.templates} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />}
    </div>
  );
}

function MineSection({ mine, onSaved }: { mine: Mine; onSaved: () => void }) {
  const [whatsapp, setWhatsapp] = useState(mine.whatsapp);
  const [sms, setSms] = useState(mine.sms);
  const [mobile, setMobile] = useState(mine.mobile ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setWhatsapp(mine.whatsapp); setSms(mine.sms); setMobile(mine.mobile ?? ""); }, [mine]);
  const save = useMutation({
    mutationFn: () => request("/api/crm/my-reminders", { method: "PATCH", json: { whatsapp, sms, mobile: mobile.trim() } }),
    onSuccess: () => { setSaved(true); onSaved(); },
  });
  const notReady = !mine.whatsappReady && !mine.smsReady;
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Mine</h2>
      {save.isError && <Notice>{message(save.error)}</Notice>}
      {notReady && <p className="text-sm text-text-secondary">WhatsApp and SMS reminders are not set up for the company yet. Ask your CRM administrator.</p>}
      <TextField label="My mobile" type="tel" value={mobile} onChange={(value) => { setMobile(value); setSaved(false); }} placeholder="+91 98765 43210"
        description="The same number your CRM calls ring." />
      <Checkbox isSelected={whatsapp} isDisabled={!mine.whatsappReady && !whatsapp} onChange={(value) => { setWhatsapp(value); setSaved(false); }}>Also on WhatsApp</Checkbox>
      <Checkbox isSelected={sms} isDisabled={!mine.smsReady && !sms} onChange={(value) => { setSms(value); setSaved(false); }}>Also by SMS</Checkbox>
      <div className="flex items-center gap-3">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
        {saved && !save.isPending && <span className="text-sm text-text-secondary">Saved.</span>}
      </div>
    </section>
  );
}

function CompanySection({ templates, onSaved }: { templates: Templates; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const smsTemplates = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "sms-templates"), queryFn: () => listSmsTemplates() });
  const [whatsappTemplate, setWhatsappTemplate] = useState(templates.whatsappTemplate ?? "");
  const [whatsappLanguage, setWhatsappLanguage] = useState(templates.whatsappLanguage);
  const [smsTemplateId, setSmsTemplateId] = useState(templates.smsTemplateId ?? NONE);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => request("/api/crm/my-reminders", { method: "PUT", json: { whatsappTemplate: whatsappTemplate.trim(), whatsappLanguage, smsTemplateId: smsTemplateId === NONE ? "" : smsTemplateId } }),
    onSuccess: () => { setSaved(true); onSaved(); },
  });
  const usable = (smsTemplates.data ?? []).filter((template) => template.status === "active" && template.category !== "promotional");
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">For the company</h2>
      <p className="text-sm text-text-secondary">
        WhatsApp and TRAI let a business send only approved templates. Make one in each with two values: what the reminder is ({"{{1}}"} / the first {"{#var#}"}) and its
        details ({"{{2}}"} / the second). WhatsApp needs your number connected in <Link className="underline" href="/crm/settings/whatsapp">Setup › WhatsApp</Link>; SMS needs a provider
        in <Link className="underline" href="/crm/settings/calls-sms">Setup › Calls and SMS</Link>.
      </p>
      {save.isError && <Notice>{message(save.error)}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="WhatsApp template" value={whatsappTemplate} onChange={(value) => { setWhatsappTemplate(value); setSaved(false); }} placeholder="crm_reminder"
          description="Its name as approved in WhatsApp Manager. Empty: no WhatsApp reminders." />
        <Select label="Its language" selectedKey={whatsappLanguage} onSelectionChange={(value) => { setWhatsappLanguage(String(value)); setSaved(false); }} options={LANGUAGES} />
      </div>
      <Select label="SMS template" selectedKey={smsTemplateId} onSelectionChange={(value) => { setSmsTemplateId(String(value)); setSaved(false); }}
        description="A service template from Setup › Calls and SMS."
        options={[{ value: NONE, label: "No SMS reminders" }, ...usable.map((template) => ({ value: template.id, label: template.name }))]} />
      <div className="flex items-center gap-3">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
        {saved && !save.isPending && <span className="text-sm text-text-secondary">Saved.</span>}
      </div>
    </section>
  );
}
