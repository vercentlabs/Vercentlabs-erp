"use client";

// CRM › Setup › Activity types and plans (CRM plan 5.2).
//   Types   the follow-up types every CRM screen offers. Each has a kind (call, email, meeting…) that decides what completing it records,
//           and defaults for new work: when it falls due, who does it, the reminder, an email template (offered by Write email on the
//           follow-up), and what comes next — suggested when it is completed, or planned automatically. Each shows its open follow-ups
//           and what leads to it; a type a plan or another type still leads to is not switched off.
//   Plans   a named sequence of follow-ups applied to a lead or deal in one click (Apply plan on its page), with what it has planned.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { requestJson } from "@/shared/http/request-json";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ACTIVITY_KINDS, createActivityPlan, createActivityType, errorMessage, listActivityPlans, listActivityTypes, reorderActivityTypes, updateActivityPlan,
  updateActivityType, type ActivityPlan, type ActivityType, type PlanStep,
} from "../activity-types-api";

const KIND_LABEL = Object.fromEntries(ACTIVITY_KINDS.map((entry) => [entry.value, entry.label])) as Record<string, string>;
const KIND_HINT: Record<string, string> = {
  call: "Completing it logs a call.", email: "Completing it logs an email; Write email on it starts from its template.", meeting: "Completing it logs a meeting; it can go to calendars.",
  demo: "Completing it logs a demo.", visit: "Completing it logs a visit.", whatsapp: "Completing it logs a WhatsApp message.", other: "Completing it logs a note.",
};
const ASSIGNEES = [{ value: "record_owner", label: "The record's owner" }, { value: "creator", label: "Whoever plans it" }, { value: "user", label: "A named member" }];
const CHAINING = [{ value: "none", label: "Nothing" }, { value: "suggest", label: "Suggest a next step" }, { value: "trigger", label: "Plan the next step automatically" }];
const REMINDERS = [
  { value: "none", label: "No reminder" }, { value: "0", label: "At the time" }, { value: "15", label: "15 minutes before" }, { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];
const APPLIES = { any: "Leads and deals", lead: "Leads", opportunity: "Deals" } as const;
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
const hours = (count: number) => (count === 0 ? "straight away" : count % 24 === 0 ? `${days(count / 24)} after it is planned` : `${count} h after it is planned`);
const reminderLabel = (minutes: number) => REMINDERS.find((entry) => entry.value === String(minutes))?.label.replace(/^At the time$/, "Reminder at the time") ?? `${minutes} min before`;

function useMembers() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  return (options.data?.options.users ?? []).map((user) => ({ value: String(user.id), label: String(user.name ?? "") }));
}

// What a type starts with and what comes after it, in words.
function typeFacts(type: ActivityType) {
  return [
    type.defaultDelayHours !== null ? `Due ${hours(type.defaultDelayHours)}` : null,
    type.defaultAssignee === "user" ? `For ${type.defaultUserName ?? "a member"}` : type.defaultAssignee === "creator" ? "For whoever plans it" : null,
    type.defaultReminderMinutes !== null ? (type.defaultReminderMinutes === 0 ? "Reminder at the time" : `Reminder ${reminderLabel(type.defaultReminderMinutes).toLowerCase()}`) : null,
    type.emailTemplateName ? `Template: ${type.emailTemplateName}` : null,
    type.chaining !== "none" && type.nextTypeName ? `${type.chaining === "trigger" ? "Then plans" : "Then suggests"} ${type.nextTypeName} after ${days(type.nextDelayDays)}` : null,
  ].filter((fact): fact is string => Boolean(fact));
}

export function ActivityTypesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const typesKey = scopedQueryKey(workspace, "crm", "activity-types", "all");
  const plansKey = scopedQueryKey(workspace, "crm", "activity-plans", "all");
  const types = useQuery({ queryKey: typesKey, queryFn: () => listActivityTypes(true), enabled: canManage });
  const plans = useQuery({ queryKey: plansKey, queryFn: () => listActivityPlans({ all: true }), enabled: canManage });
  const [editingType, setEditingType] = useState<ActivityType | "new" | null>(null);
  const [editingPlan, setEditingPlan] = useState<ActivityPlan | "new" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "activity-types") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "activity-plans") });
    for (const options of ["follow-up-options", "lead-options", "opportunity-options", "task-options", "account-options", "contact-options"])
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", options) });
  };
  const change = useMutation({
    mutationFn: ({ run }: { run: () => Promise<unknown>; done?: string }) => run(),
    onSuccess: (_, { done }) => { setNotice(done ? { tone: "success", text: done } : null); refresh(); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });

  if (!canManage) return <PermissionState title="You can't manage activity types" description="Ask an administrator for the Manage CRM settings permission." />;
  if (types.isLoading || plans.isLoading) return <LoadingState label="Loading activity types" rows={6} />;
  if (types.isError || plans.isError) return <ErrorState title="Could not load activity types" description={errorMessage(types.error ?? plans.error)} action={{ label: "Try again", onPress: () => { void types.refetch(); void plans.refetch(); } }} />;
  const all = types.data ?? [];
  const active = all.filter((type) => type.isActive);
  const off = all.filter((type) => !type.isActive);
  const planList = plans.data ?? [];
  const move = (index: number, offset: number) => {
    const ids = active.map((type) => type.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change.mutate({ run: () => reorderActivityTypes(ids) });
  };

  const typeRow = (type: ActivityType) => {
    const index = active.findIndex((entry) => entry.id === type.id);
    const facts = typeFacts(type);
    const leadsHere = [...(type.usedByPlans ?? []).map((name) => `plan ${name}`), ...(type.chainedFrom ?? []).map((name) => `after ${name}`)];
    return (
      <li key={type.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{type.name}</span>
            {/* the kind only when the name does not already say it */}
            {type.name.toLowerCase() !== KIND_LABEL[type.kind]?.toLowerCase() && <Badge tone="neutral">{KIND_LABEL[type.kind]}</Badge>}
            {type.isStandard && <span className="text-xs text-text-muted">Standard</span>}
            {!type.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
          </div>
          <span className="text-text-secondary">{facts.length ? facts.join(" · ") : "No defaults: due when chosen, for the record's owner."}</span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
            {type.openFollowUps ? <Link className="text-brand hover:underline" href={`/crm/follow-ups?view=all&activityTypeId=${type.id}`}>{`${type.openFollowUps} open follow-up${type.openFollowUps === 1 ? "" : "s"}`}</Link> : <span>No open follow-ups</span>}
            {leadsHere.length > 0 && <span>{`Used in ${leadsHere.join(", ")}`}</span>}
          </span>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1">
          {type.isActive && (
            <>
              <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`Move ${type.name} up`} isDisabled={index === 0 || change.isPending} onPress={() => move(index, -1)}>
                <ArrowUp className="size-3.5" aria-hidden="true" />Up</Button>
              <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`Move ${type.name} down`} isDisabled={index === active.length - 1 || change.isPending} onPress={() => move(index, 1)}>
                <ArrowDown className="size-3.5" aria-hidden="true" />Down</Button>
            </>
          )}
          <Button variant="secondary" size="compact" className={`w-full sm:w-auto ${type.isStandard ? "col-span-2" : ""}`} aria-label={`Edit ${type.name}`} onPress={() => { setNotice(null); setEditingType(type); }}>
            <Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
          {!type.isStandard && (
            <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`${type.isActive ? "Switch off" : "Switch on"} ${type.name}`} isDisabled={change.isPending}
              onPress={() => change.mutate({ run: () => updateActivityType(type.id, { isActive: !type.isActive }), done: type.isActive ? `${type.name} is switched off: no longer offered for new follow-ups.` : `${type.name} is offered again.` })}>
              <Power className="size-3.5" aria-hidden="true" />{type.isActive ? "Switch off" : "Switch on"}</Button>
          )}
        </div>
      </li>
    );
  };

  const planRow = (plan: ActivityPlan) => (
    <li key={plan.id} className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{plan.name}</span>
            <Badge tone="neutral">{APPLIES[plan.appliesTo]}</Badge>
            {!plan.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
          </div>
          {plan.description && <span className="text-text-secondary">{plan.description}</span>}
        </div>
        <ol className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5 sm:gap-y-1">
          {plan.steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-1.5">
              {index > 0 && <span className="hidden text-text-muted sm:inline" aria-hidden="true">→</span>}
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface-muted px-2 py-0.5 text-xs">
                <span className="shrink-0 font-medium tabular-nums">{`Day ${step.offsetDays}`}</span>
                <span className="truncate text-text-secondary">{step.subject ? `${step.activityTypeName}: ${step.subject}` : step.activityTypeName}</span>
              </span>
            </li>
          ))}
        </ol>
        <span className="text-xs text-text-muted">
          {plan.plannedCount
            ? <Link className="text-brand hover:underline" href={`/crm/follow-ups?view=all&activityPlanId=${plan.id}`}>{`${plan.plannedCount} follow-up${plan.plannedCount === 1 ? "" : "s"} planned from it, ${plan.openCount} open`}</Link>
            : "Not applied yet"}
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:gap-1">
        <Button variant="secondary" size="compact" className="w-full sm:w-auto" aria-label={`Edit ${plan.name}`} onPress={() => { setNotice(null); setEditingPlan(plan); }}>
          <Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
        <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`${plan.isActive ? "Switch off" : "Switch on"} ${plan.name}`} isDisabled={change.isPending}
          onPress={() => change.mutate({ run: () => updateActivityPlan(plan.id, { isActive: !plan.isActive }), done: plan.isActive ? `${plan.name} is switched off: Apply plan no longer offers it.` : `${plan.name} is offered again.` })}>
          <Power className="size-3.5" aria-hidden="true" />{plan.isActive ? "Switch off" : "Switch on"}</Button>
      </div>
    </li>
  );

  const activePlans = planList.filter((plan) => plan.isActive);
  const offPlans = planList.filter((plan) => !plan.isActive);
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Activity types and plans" description="The kinds of follow-up your team plans, what each starts with, what comes after it, and ready-made sequences of follow-ups." />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <section className="flex max-w-5xl flex-col gap-3" aria-label="Activity types">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{`Types (${active.length})`}</h2>
            <p className="text-sm text-text-secondary">In this order in every type list. Edit sets what a new one starts with.</p>
          </div>
          <Button variant="primary" className="shrink-0" onPress={() => { setNotice(null); setEditingType("new"); }}><Plus className="size-4" aria-hidden="true" />New type</Button>
        </div>
        <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">{active.map(typeRow)}</ol>
        {off.length > 0 && (
          <Panel title={`Switched off (${off.length})`} description="Not offered for new follow-ups; existing ones keep their type.">
            <ul className="-m-4 flex flex-col divide-y divide-border">{off.map(typeRow)}</ul>
          </Panel>
        )}
      </section>

      <section className="flex max-w-5xl flex-col gap-3" aria-label="Activity plans">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{`Plans (${activePlans.length})`}</h2>
            <p className="text-sm text-text-secondary">Apply plan on a lead or deal plans every step as a follow-up, so many days after the start.</p>
          </div>
          <Button variant="primary" className="shrink-0" isDisabled={!active.length} onPress={() => { setNotice(null); setEditingPlan("new"); }}><Plus className="size-4" aria-hidden="true" />New plan</Button>
        </div>
        {activePlans.length === 0
          ? <p className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-sm text-text-secondary">No plans yet. For example, New enquiry: call on day 0, email the brochure on day 1, visit on day 7.</p>
          : <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">{activePlans.map(planRow)}</ul>}
        {offPlans.length > 0 && (
          <Panel title={`Switched off (${offPlans.length})`} description="Not offered by Apply plan; follow-ups already planned stay.">
            <ul className="-m-4 flex flex-col divide-y divide-border">{offPlans.map(planRow)}</ul>
          </Panel>
        )}
      </section>

      {editingType && <TypeDialog type={editingType === "new" ? null : editingType} types={active} onClose={() => setEditingType(null)}
        onSaved={(saved, created) => { setNotice({ tone: "success", text: created ? `Added ${saved.name}.` : `Saved ${saved.name}.` }); refresh(); }} />}
      {editingPlan && <PlanDialog plan={editingPlan === "new" ? null : editingPlan} types={active} onClose={() => setEditingPlan(null)}
        onSaved={(saved, created) => { setNotice({ tone: "success", text: created ? `Added ${saved.name}.` : `Saved ${saved.name}.` }); refresh(); }} />}
    </div>
  );
}

function DialogButtons({ onClose, busy, ready, label }: { onClose: () => void; busy: boolean; ready: boolean; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onPress={onClose}>Cancel</Button>
      <Button type="submit" variant="primary" isLoading={busy} isDisabled={!ready || busy}>{label}</Button>
    </div>
  );
}

function TypeDialog({ type, types, onClose, onSaved }: { type: ActivityType | null; types: ActivityType[]; onClose: () => void; onSaved: (saved: ActivityType, created: boolean) => void }) {
  const members = useMembers();
  const workspace = useWorkspaceContext();
  const templates = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "email-templates", "active"),
    queryFn: () => requestJson<{ templates: Array<{ id: string; name: string }> }>("/api/crm/email-templates").then((result) => result.templates),
  });
  const [name, setName] = useState(type?.name ?? "");
  const [kind, setKind] = useState<string>(type?.kind ?? "call");
  const [delay, setDelay] = useState(type?.defaultDelayHours === null || type?.defaultDelayHours === undefined ? "" : String(type.defaultDelayHours));
  const [assignee, setAssignee] = useState<string>(type?.defaultAssignee ?? "record_owner");
  const [userId, setUserId] = useState(type?.defaultUserId ?? "");
  const [reminder, setReminder] = useState(type?.defaultReminderMinutes === null || type?.defaultReminderMinutes === undefined ? "none" : String(type.defaultReminderMinutes));
  const [templateId, setTemplateId] = useState(type?.emailTemplateId ?? "");
  const [chaining, setChaining] = useState<string>(type?.chaining ?? "none");
  const [nextTypeId, setNextTypeId] = useState(type?.nextTypeId ?? "");
  const [nextDelay, setNextDelay] = useState(String(type?.nextDelayDays ?? 1));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name, kind: kind as ActivityType["kind"], defaultDelayHours: delay.trim() === "" ? null : Number(delay), defaultAssignee: assignee as ActivityType["defaultAssignee"],
        defaultUserId: assignee === "user" ? userId : null, defaultReminderMinutes: reminder === "none" ? null : Number(reminder), emailTemplateId: kind === "email" ? templateId || null : null,
        chaining: chaining as ActivityType["chaining"], nextTypeId: chaining === "none" ? null : nextTypeId, nextDelayDays: Number(nextDelay) || 0,
      };
      return type ? updateActivityType(type.id, input) : createActivityType(input);
    },
    onSuccess: (saved) => { onSaved(saved, !type); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const delayOk = delay.trim() === "" || Number(delay) <= 2160;
  const nextOk = chaining === "none" || (nextTypeId && Number(nextDelay) <= 365);
  const ready = Boolean(name.trim()) && delayOk && (assignee !== "user" || Boolean(userId)) && Boolean(nextOk);
  const nextChoices = types.filter((entry) => entry.id !== type?.id || chaining === "suggest").map((entry) => ({ value: entry.id, label: entry.name }));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={type ? `Edit ${type.name}` : "New activity type"} size="lg">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={(value) => { setName(value); setError(null); }} maxLength={80} placeholder="Site survey" />
          <Select label="Kind" description={type?.isStandard ? "A standard type keeps its kind." : KIND_HINT[kind]} isDisabled={type?.isStandard}
            selectedKey={kind} onSelectionChange={(key) => setKind(String(key))} options={ACTIVITY_KINDS} />
        </div>
        <fieldset className="grid gap-4 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">A new one starts with</legend>
          <TextField label="Due after (hours)" inputMode="numeric" value={delay} onChange={(value) => setDelay(value.replace(/\D/g, ""))}
            description={!delayOk ? "Up to 2,160 hours (90 days)." : delay.trim() === "" ? "Empty: the date the person picks." : `Due ${hours(Number(delay))}.`} />
          <Select label="Reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))} options={REMINDERS} />
          <Select label="Who does it" selectedKey={assignee} onSelectionChange={(key) => setAssignee(String(key))} options={ASSIGNEES} />
          {assignee === "user" && <Select label="Member" isRequired selectedKey={userId || null} onSelectionChange={(key) => setUserId(String(key))} options={members} />}
          {kind === "email" && (
            <Select label="Email template" description="Write email on the follow-up starts from it." selectedKey={templateId || "none"}
              onSelectionChange={(key) => setTemplateId(String(key) === "none" ? "" : String(key))}
              options={[{ value: "none", label: "None" }, ...(templates.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
          )}
        </fieldset>
        <fieldset className="grid gap-4 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">When it is completed</legend>
          <Select label="Then" selectedKey={chaining} onSelectionChange={(key) => setChaining(String(key))} options={CHAINING} />
          {chaining !== "none" && (
            <>
              <Select label="Next type" isRequired selectedKey={nextTypeId || null} onSelectionChange={(key) => setNextTypeId(String(key))} options={nextChoices} />
              <TextField label="After (days)" inputMode="numeric" value={nextDelay} onChange={(value) => setNextDelay(value.replace(/\D/g, ""))}
                description={Number(nextDelay) > 365 ? "Up to 365 days." : undefined} />
            </>
          )}
        </fieldset>
        <DialogButtons onClose={onClose} busy={save.isPending} ready={ready} label={type ? "Save" : "Add type"} />
      </form>
    </Dialog>
  );
}

const STEP_ASSIGNEES = [{ value: "record_owner", label: "Record's owner" }, { value: "applier", label: "Whoever applies it" }, { value: "user", label: "A named member" }];

function PlanDialog({ plan, types, onClose, onSaved }: { plan: ActivityPlan | null; types: ActivityType[]; onClose: () => void; onSaved: (saved: ActivityPlan, created: boolean) => void }) {
  const members = useMembers();
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [appliesTo, setAppliesTo] = useState<string>(plan?.appliesTo ?? "any");
  const [steps, setSteps] = useState<PlanStep[]>(plan?.steps.map(({ activityTypeId, offsetDays, subject, assignee, userId }) => ({ activityTypeId, offsetDays, subject, assignee, userId }))
    ?? [{ activityTypeId: types[0]?.id ?? "", offsetDays: 0, subject: "", assignee: "record_owner" }]);
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, patch: Partial<PlanStep>) => setSteps((current) => current.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  const save = useMutation({
    // steps go in day order, the order Apply plan shows them
    mutationFn: () => {
      const input = { name, description, appliesTo: appliesTo as ActivityPlan["appliesTo"], steps: [...steps].sort((a, b) => a.offsetDays - b.offsetDays) };
      return plan ? updateActivityPlan(plan.id, input) : createActivityPlan(input);
    },
    onSuccess: (saved) => { onSaved(saved, !plan); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const ready = Boolean(name.trim()) && steps.length > 0 && steps.every((step) => step.activityTypeId && (step.assignee !== "user" || step.userId));
  const typeChoices = types.map((entry) => ({ value: entry.id, label: entry.name }));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={plan ? `Edit ${plan.name}` : "New activity plan"} size="xl">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={(value) => { setName(value); setError(null); }} maxLength={120} placeholder="New enquiry" />
          <Select label="Used on" selectedKey={appliesTo} onSelectionChange={(key) => setAppliesTo(String(key))}
            options={[{ value: "any", label: "Leads and deals" }, { value: "lead", label: "Leads" }, { value: "opportunity", label: "Deals" }]} />
        </div>
        <TextArea label="Description" value={description} onChange={setDescription} maxLength={500} rows={2} />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{`Steps (${steps.length})`}</p>
          <ol className="flex flex-col gap-3">
            {steps.map((step, index) => (
              <li key={index} className="grid items-end gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.4fr)] lg:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                <Select label={`Step ${index + 1}`} selectedKey={step.activityTypeId || null} onSelectionChange={(key) => update(index, { activityTypeId: String(key) })} options={typeChoices} />
                <TextField label="Day" inputMode="numeric" value={String(step.offsetDays)} onChange={(value) => update(index, { offsetDays: Math.max(0, Math.min(365, Number(value.replace(/\D/g, "")) || 0)) })} />
                <TextField label="Subject (optional)" value={step.subject ?? ""} onChange={(value) => update(index, { subject: value })} maxLength={200} />
                <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
                  <Select label="For" selectedKey={step.assignee} onSelectionChange={(key) => update(index, { assignee: String(key) as PlanStep["assignee"] })} options={STEP_ASSIGNEES} />
                  {step.assignee === "user" && <Select aria-label="Member" selectedKey={step.userId || null} onSelectionChange={(key) => update(index, { userId: String(key) })} options={members} />}
                </div>
                <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`Remove step ${index + 1}`} isDisabled={steps.length === 1}
                  onPress={() => setSteps((current) => current.filter((_, position) => position !== index))}><Trash2 className="size-3.5" aria-hidden="true" />Remove</Button>
              </li>
            ))}
          </ol>
          {steps.length < 20 && (
            <div>
              <Button variant="secondary" size="compact" onPress={() => setSteps((current) => [...current, { activityTypeId: types[0]?.id ?? "", offsetDays: (current.at(-1)?.offsetDays ?? 0) + 1, subject: "", assignee: "record_owner" }])}>
                <Plus className="size-3.5" aria-hidden="true" />Add step</Button>
            </div>
          )}
          <p className="text-xs text-text-muted">Day 0 is the start date chosen when it is applied. Up to 20 steps; saved in day order.</p>
        </div>
        <DialogButtons onClose={onClose} busy={save.isPending} ready={ready} label={plan ? "Save" : "Create plan"} />
      </form>
    </Dialog>
  );
}
