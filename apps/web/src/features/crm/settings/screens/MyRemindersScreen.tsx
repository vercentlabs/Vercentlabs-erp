"use client";

// Reminders on WhatsApp and SMS (CRM audit M6). Everyone chooses for themselves whether their follow-up and task reminders also reach
// them on WhatsApp or by SMS, at their mobile, and can send themselves a test. A CRM administrator names the approved WhatsApp template
// and the DLT SMS template that carry a reminder (WhatsApp and TRAI allow only those), and sees whether each channel is connected.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircle, MessageSquareText, Send, XCircle } from "lucide-react";
import { Button, Checkbox, ErrorState, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { listSmsTemplates } from "@/features/crm/shared/channels-api";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class RemindersApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(RemindersApiError, "body");

type Mine = { whatsapp: boolean; sms: boolean; mobile: string | null; whatsappReady: boolean; smsReady: boolean; whatsappMissing: string | null; smsMissing: string | null };
type Templates = { whatsappTemplate: string | null; whatsappLanguage: string; smsTemplateId: string | null; whatsappConnected: boolean; smsConnected: boolean };
type TestResult = { whatsapp?: string; sms?: string; error?: string };
const NONE = "none";
const LANGUAGES = [{ value: "en", label: "English" }, { value: "en_US", label: "English (US)" }, { value: "hi", label: "Hindi" }, { value: "mr", label: "Marathi" },
  { value: "gu", label: "Gujarati" }, { value: "ta", label: "Tamil" }, { value: "te", label: "Telugu" }, { value: "kn", label: "Kannada" }, { value: "bn", label: "Bengali" }];
const message = (error: unknown) => (error instanceof Error && error.message ? error.message : "That did not work. Try again.");
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function MyRemindersScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "my-reminders");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ mine: Mine; templates: Templates }>("/api/crm/my-reminders") });
  if (query.isLoading) return <LoadingState label="Loading reminders" rows={3} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load reminders" description={message(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Reminders on your phone" description="Your follow-up and task reminders always appear in the app. Get them on WhatsApp or by SMS as well." />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <MineSection mine={query.data.mine} canManage={canManage} onSaved={refresh} />
        {canManage ? <CompanySection templates={query.data.templates} onSaved={refresh} /> : <HowItWorks />}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <Panel title="How it works">
      <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-text-secondary">
        <li>When a follow-up or task is due, the reminder appears in the app and, if you turned it on, on WhatsApp or by SMS at your mobile.</li>
        <li>WhatsApp and SMS are extra: if one cannot be sent, the in-app reminder still arrives.</li>
        <li>Your mobile here is also the number your CRM calls ring.</li>
      </ul>
    </Panel>
  );
}

function ChannelChoice({ icon, label, selected, ready, missing, onChange }: {
  icon: React.ReactNode; label: string; selected: boolean; ready: boolean; missing: string | null; onChange: (value: boolean) => void;
}) {
  return (
    <div className={`flex flex-col gap-1 rounded-[var(--radius-control)] border p-3 ${selected ? "border-brand bg-brand/5" : "border-border"}`}>
      <Checkbox isSelected={selected} isDisabled={!ready && !selected} onChange={onChange}><span className="inline-flex items-center gap-2">{icon}{label}</span></Checkbox>
      <span className={`pl-7 text-xs ${ready ? "text-text-muted" : "text-warning"}`}>{ready ? "Ready to use." : missing ? `${sentence(missing)}.` : "Not set up yet."}</span>
    </div>
  );
}

function MineSection({ mine, canManage, onSaved }: { mine: Mine; canManage: boolean; onSaved: () => void }) {
  const [whatsapp, setWhatsapp] = useState(mine.whatsapp);
  const [sms, setSms] = useState(mine.sms);
  const [mobile, setMobile] = useState(mine.mobile ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setWhatsapp(mine.whatsapp); setSms(mine.sms); setMobile(mine.mobile ?? ""); }, [mine]);
  const save = useMutation({
    mutationFn: () => request("/api/crm/my-reminders", { method: "PATCH", json: { whatsapp, sms, mobile: mobile.trim() } }),
    onSuccess: () => { setSaved(true); onSaved(); },
  });
  const test = useMutation({ mutationFn: () => request<{ result: TestResult }>("/api/crm/my-reminders/test", { method: "POST", json: {} }).then((result) => result.result) });
  const changed = whatsapp !== mine.whatsapp || sms !== mine.sms || mobile.trim() !== (mine.mobile ?? "");
  const touch = () => { setSaved(false); test.reset(); };
  const outcome = (value: string | undefined) => (value === "sent" ? "sent: check your phone" : value);
  return (
    <Panel title="Mine" description="Where your own reminders reach you.">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{message(save.error)}</Notice>}
        {!mine.whatsappReady && !mine.smsReady && (
          <Notice tone="info">{canManage ? "Set up WhatsApp or SMS reminders for the company first (alongside)." : "WhatsApp and SMS reminders are not set up for the company yet. Ask your CRM administrator."}</Notice>
        )}
        <TextField label="My mobile" type="tel" value={mobile} onChange={(value) => { setMobile(value); touch(); }} placeholder="+91 98765 43210"
          description="Also the number your CRM calls ring." />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ChannelChoice icon={<MessageCircle className="size-4" aria-hidden="true" />} label="Also on WhatsApp" selected={whatsapp} ready={mine.whatsappReady} missing={mine.whatsappMissing}
            onChange={(value) => { setWhatsapp(value); touch(); }} />
          <ChannelChoice icon={<MessageSquareText className="size-4" aria-hidden="true" />} label="Also by SMS" selected={sms} ready={mine.smsReady} missing={mine.smsMissing}
            onChange={(value) => { setSms(value); touch(); }} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!changed || save.isPending} onPress={() => save.mutate()}>Save</Button>
          <Button variant="secondary" className="w-full sm:w-auto" isLoading={test.isPending} isDisabled={changed || (!mine.whatsapp && !mine.sms) || test.isPending}
            onPress={() => test.mutate()}><Send className="size-4" aria-hidden="true" />Send me a test</Button>
          {saved && !changed && !save.isPending && <span className="text-sm text-text-secondary">Saved.</span>}
        </div>
        {changed && (mine.whatsapp || mine.sms || whatsapp || sms) && <p className="text-xs text-text-muted">Save first to send a test.</p>}
        {test.isError && <Notice>{message(test.error)}</Notice>}
        {test.data && (
          <ul className="flex flex-col gap-1 text-sm">
            {(["whatsapp", "sms"] as const).filter((channel) => test.data[channel]).map((channel) => (
              <li key={channel} className={`flex items-start gap-2 ${test.data[channel] === "sent" ? "text-success" : "text-danger"}`}>
                {test.data[channel] === "sent" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                <span>{`${channel === "whatsapp" ? "WhatsApp" : "SMS"}: ${outcome(test.data[channel])}`}</span>
              </li>
            ))}
            {test.data.error && <li className="text-danger">{test.data.error}</li>}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function Connection({ label, connected, href, setupLabel }: { label: string; connected: boolean; href: string; setupLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-2">
        {connected ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <XCircle className="size-4 text-text-muted" aria-hidden="true" />}
        {`${label}: ${connected ? "connected" : "not connected"}`}
      </span>
      <Link className="text-brand hover:underline" href={href}>{connected ? `${setupLabel} settings` : `Connect in ${setupLabel}`}</Link>
    </div>
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
  const chosenSms = usable.find((template) => template.id === smsTemplateId);
  const languages = LANGUAGES.some((entry) => entry.value === whatsappLanguage) ? LANGUAGES : [...LANGUAGES, { value: whatsappLanguage, label: whatsappLanguage }];
  const changed = whatsappTemplate.trim() !== (templates.whatsappTemplate ?? "") || whatsappLanguage !== templates.whatsappLanguage || smsTemplateId !== (templates.smsTemplateId ?? NONE);
  return (
    <Panel title="For the company" description="The approved templates that carry everyone's reminders.">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{message(save.error)}</Notice>}
        <div className="flex flex-col gap-2">
          <Connection label="WhatsApp" connected={templates.whatsappConnected} href="/crm/settings/whatsapp" setupLabel="Setup › WhatsApp" />
          <Connection label="SMS" connected={templates.smsConnected} href="/crm/settings/calls-sms" setupLabel="Setup › Calls and SMS" />
        </div>
        <p className="text-sm text-text-secondary">
          WhatsApp and TRAI allow a business to send only approved templates. Make one in each with two values: what the reminder is ({"{{1}}"} or the first {"{#var#}"})
          and its details ({"{{2}}"} or the second).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <TextField label="WhatsApp template" value={whatsappTemplate} onChange={(value) => { setWhatsappTemplate(value.trim().toLowerCase()); setSaved(false); }} placeholder="crm_reminder"
            description="Its name as approved in WhatsApp Manager. Empty: no WhatsApp reminders." />
          <Select label="Its language" selectedKey={whatsappLanguage} onSelectionChange={(value) => { setWhatsappLanguage(String(value)); setSaved(false); }} options={languages} />
        </div>
        <div className="flex flex-col gap-1">
          <Select label="SMS template" selectedKey={smsTemplateId} onSelectionChange={(value) => { setSmsTemplateId(String(value)); setSaved(false); }}
            description={usable.length ? "A service template from Setup › Calls and SMS." : "No service SMS template yet: add one in Setup › Calls and SMS."}
            options={[{ value: NONE, label: "No SMS reminders" }, ...usable.map((template) => ({ value: template.id, label: template.name }))]} />
          {chosenSms && (
            <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border bg-surface-muted p-2 text-xs">
              <span className="break-words font-mono">{chosenSms.body}</span>
              {chosenSms.variables < 2 && <span className="text-warning">{`It has ${chosenSms.variables} value${chosenSms.variables === 1 ? "" : "s"}: a reminder fills two (what it is and its details), so the details will be left out.`}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!changed || save.isPending} onPress={() => save.mutate()}>Save</Button>
          {saved && !changed && !save.isPending && <span className="text-sm text-text-secondary">Saved. Everyone can now turn these on.</span>}
        </div>
      </div>
    </Panel>
  );
}
