"use client";

// Sales › Setup › Payment reminders (Sales report Phase 2): rules that remind customers about bills before or after the due date, by
// email and WhatsApp, once per bill. Off, Preview (shows what would be sent, sends nothing) or On. Desktop: the rules and the log with
// how reminders work beside them; tablet and phone: one column.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AlertDialog, Button, Checkbox, Dialog, ErrorState, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, del, patch, post, request } from "@/features/sales/shared/http";
import { calendarDate } from "@/features/sales/shared/format";

type Rule = { id: string; name: string; daysOffset: number; sendEmail: boolean; sendWhatsApp: boolean; whatsappTemplate: string | null; whatsappLanguage: string;
  subject: string | null; message: string | null; active: boolean; when: string };
type LogEntry = { id: string; ruleName: string | null; partyId: string; customerName: string | null; invoiceId: string; invoiceNumber: string | null; runOn: string;
  status: "previewed" | "sent" | "failed" | "skipped"; channels: string[]; detail: string | null };
type Reminders = { mode: "off" | "preview" | "send"; rules: Rule[]; defaultMessage: string; log: LogEntry[] };

const MODES = [
  { value: "off", label: "Off", hint: "No reminders go out." },
  { value: "preview", label: "Preview", hint: "Shows what would be sent each day. Nothing goes out." },
  { value: "send", label: "On", hint: "Reminders go out every morning." },
] as const;
const LOG_TONE = { previewed: "info", sent: "success", failed: "danger", skipped: "neutral" } as const;
const LOG_LABEL = { previewed: "Would send", sent: "Sent", failed: "Not sent", skipped: "Skipped" } as const;

export function PaymentRemindersScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");
  const key = scopedQueryKey(workspace, "sales", "payment-reminders");
  const query = useQuery({ queryKey: key, queryFn: () => request<Reminders>("/payment-reminders"), enabled: canManage });
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: key }); };
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (problem) => { setDeleting(null); setError((problem as Error).message); },
  });

  if (!canManage || (query.isError && query.error instanceof SalesApiError && query.error.status === 403))
    return <PermissionState title="You cannot set up payment reminders" description="Ask someone who manages Sales settings." />;
  const data = query.data;
  const activeRules = (data?.rules ?? []).filter((rule) => rule.active).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payment reminders" description="Remind customers about bills before and after they are due, automatically."
        primaryAction={<Button variant="primary" className="flex-1 sm:flex-none" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New reminder</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      {query.isLoading ? <LoadingState label="Loading reminders" rows={4} />
        : query.isError || !data ? <ErrorState title="Reminders could not be loaded" action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
            <div className="flex min-w-0 flex-col gap-4">
              <section aria-labelledby="reminders-mode" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <h2 id="reminders-mode" className="text-sm font-semibold text-text">Sending</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="reminders-mode">
                  {MODES.map((mode) => (
                    <button key={mode.value} type="button" role="radio" aria-checked={data.mode === mode.value} disabled={change.isPending}
                      onClick={() => change.mutate(() => post("/payment-reminders", { mode: mode.value }))}
                      className={`flex min-h-11 flex-col items-start gap-0.5 rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm ${data.mode === mode.value ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-muted"}`}>
                      <span className="font-medium text-text">{mode.label}</span>
                      <span className="text-xs text-text-secondary">{mode.hint}</span>
                    </button>
                  ))}
                </div>
                {data.mode === "send" && activeRules === 0 && <Notice tone="warning">Reminders are on, but no reminder is switched on.</Notice>}
              </section>

              <section aria-labelledby="reminders-rules" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                <h2 id="reminders-rules" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`${data.rules.length} ${data.rules.length === 1 ? "reminder" : "reminders"}`}</h2>
                {data.rules.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">No reminders yet. Add one with New reminder, for example 3 days after the due date.</p> : (
                  <ul className="flex flex-col divide-y divide-border">
                    {data.rules.map((rule) => (
                      <li key={rule.id} className={`flex items-start gap-3 px-4 py-3.5 ${rule.active ? "" : "bg-surface-muted"}`}>
                        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`font-medium ${rule.active ? "text-text" : "text-text-muted"}`}>{rule.name}</span>
                            {!rule.active && <StatusBadge tone="neutral">Off</StatusBadge>}
                          </div>
                          <span className="text-xs text-text-secondary">{`${rule.when} · by ${[rule.sendEmail ? "email" : null, rule.sendWhatsApp ? "WhatsApp" : null].filter(Boolean).join(" and ")}`}</span>
                        </div>
                        <div className="shrink-0 sm:hidden">
                          <MoreMenu label={`Actions for ${rule.name}`} items={[
                            { id: "edit", label: "Edit", onAction: () => setEditing(rule) },
                            { id: "active", label: rule.active ? "Switch off" : "Switch on", onAction: () => change.mutate(() => post(`/payment-reminders/rules/${rule.id}`, { active: !rule.active })) },
                            { id: "delete", label: "Delete", danger: true, onAction: () => setDeleting(rule) },
                          ]} />
                        </div>
                        <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_6.5rem_auto]">
                          <Button variant="ghost" size="compact" aria-label={`Edit ${rule.name}`} onPress={() => setEditing(rule)}>Edit</Button>
                          <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => post(`/payment-reminders/rules/${rule.id}`, { active: !rule.active }))}>
                            {rule.active ? "Switch off" : "Switch on"}
                          </Button>
                          <Button variant="ghost" size="compact" className="text-danger" aria-label={`Delete ${rule.name}`} onPress={() => setDeleting(rule)}>Delete</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="reminders-log" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                <h2 id="reminders-log" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{data.mode === "preview" ? "What would be sent" : "Latest reminders"}</h2>
                {data.log.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">Nothing yet. The reminders run every morning.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {data.log.map((entry) => (
                      <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium text-text">{`${entry.customerName ?? "Customer"} · ${entry.invoiceNumber ?? ""}`}</span>
                          <span className="text-xs text-text-secondary">{[entry.ruleName, calendarDate(entry.runOn), entry.detail].filter(Boolean).join(" · ")}</span>
                        </div>
                        <StatusBadge tone={LOG_TONE[entry.status]}>{LOG_LABEL[entry.status]}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <section aria-labelledby="reminders-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <h2 id="reminders-how" className="text-sm font-semibold text-text">How reminders work</h2>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
                <li>Each morning, every reminder that is on looks at unpaid bills and reminds about each one once.</li>
                <li>A customer who promised to pay by a later date, a bill in dispute, and customers you paused are left out.</li>
                <li>Start with Preview for a week: check what would go out before switching it on.</li>
                <li>WhatsApp uses a template approved for your WhatsApp Business number, connected in CRM.</li>
              </ul>
            </section>
          </div>
        )}
      {editing && data && <RuleDialog rule={editing === "new" ? null : editing} defaultMessage={data.defaultMessage} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      <AlertDialog isOpen={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title={`Delete "${deleting?.name ?? ""}"?`}
        description="It stops reminding. What it already sent stays in the log. To keep it, switch it off instead."
        confirmLabel="Delete reminder" isConfirming={change.isPending} onConfirm={() => deleting && change.mutate(() => del(`/payment-reminders/rules/${deleting.id}`))} />
    </div>
  );
}

function RuleDialog({ rule, defaultMessage, onClose, onSaved }: { rule: Rule | null; defaultMessage: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [days, setDays] = useState(Math.abs(rule?.daysOffset ?? 3));
  const [side, setSide] = useState<"before" | "on" | "after">(!rule ? "after" : rule.daysOffset < 0 ? "before" : rule.daysOffset === 0 ? "on" : "after");
  const [sendEmail, setSendEmail] = useState(rule?.sendEmail ?? true);
  const [sendWhatsApp, setSendWhatsApp] = useState(rule?.sendWhatsApp ?? false);
  const [template, setTemplate] = useState(rule?.whatsappTemplate ?? "");
  const [subject, setSubject] = useState(rule?.subject ?? "");
  const [message, setMessage] = useState(rule?.message ?? defaultMessage);
  const daysOffset = side === "on" ? 0 : side === "before" ? -Math.abs(days || 0) : Math.abs(days || 0);
  const input = { name: name.trim(), daysOffset, sendEmail, sendWhatsApp, whatsappTemplate: template.trim() || null, subject: subject.trim() || null, message: message.trim() || null };
  const save = useMutation({ mutationFn: () => (rule ? patch(`/payment-reminders/rules/${rule.id}`, input) : post("/payment-reminders/rules", input)), onSuccess: onSaved });
  const ready = Boolean(input.name) && (sendEmail || sendWhatsApp) && (!sendWhatsApp || Boolean(input.whatsappTemplate)) && (side === "on" || days > 0);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} size="lg" title={rule ? `Edit "${rule.name}"` : "New reminder"} description="When it goes out, and how.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <TextField label="Name" isRequired autoFocus value={name} onChange={setName} placeholder="For example: 3 days late" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="When" selectedKey={side} onSelectionChange={(key) => setSide(key === "before" ? "before" : key === "on" ? "on" : "after")}
            options={[{ value: "before", label: "Before the due date" }, { value: "on", label: "On the due date" }, { value: "after", label: "After the due date" }]} />
          {side !== "on" && <NumberField label="Days" value={days} onChange={(value) => setDays(Number.isFinite(value) ? value : 0)} minValue={1} maxValue={side === "before" ? 60 : 365} step={1} />}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">Send by</legend>
          <Checkbox isSelected={sendEmail} onChange={setSendEmail}>Email</Checkbox>
          <Checkbox isSelected={sendWhatsApp} onChange={setSendWhatsApp}>WhatsApp</Checkbox>
        </fieldset>
        {sendWhatsApp && (
          <TextField label="WhatsApp template name" isRequired value={template} onChange={setTemplate}
            description="Approved for your number. It is filled with the customer, bill, amount and due date." />
        )}
        {sendEmail && (
          <>
            <TextField label="Email subject" value={subject} onChange={setSubject} placeholder="Payment reminder: invoice {invoice}" />
            <TextArea label="Email message" value={message} onChange={setMessage}
              description="Use {customer}, {invoice}, {amount}, {due_date}, {days} and {company}." />
          </>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>{rule ? "Save reminder" : "Add reminder"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
