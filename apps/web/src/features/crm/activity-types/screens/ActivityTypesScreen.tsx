"use client";

// CRM › Setup › Activity types and plans (CRM plan 5.2).
//   Types   the follow-up types every CRM screen offers. Each has a kind (call, email, meeting…) that decides what completing it records,
//           and defaults for new work: when it falls due, who does it, the reminder, an email template, and what comes next — suggested
//           when it is completed, or planned automatically.
//   Plans   a named sequence of follow-ups applied to a lead or deal in one click.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { requestJson } from "@/shared/http/request-json";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ACTIVITY_KINDS, createActivityPlan, createActivityType, errorMessage, listActivityPlans, listActivityTypes, reorderActivityTypes, updateActivityPlan,
  updateActivityType, type ActivityPlan, type ActivityType, type PlanStep,
} from "../activity-types-api";

const KIND_LABEL = Object.fromEntries(ACTIVITY_KINDS.map((entry) => [entry.value, entry.label])) as Record<string, string>;
const ASSIGNEES = [{ value: "record_owner", label: "The record's owner" }, { value: "creator", label: "Whoever plans it" }, { value: "user", label: "A named member" }];
const CHAINING = [{ value: "none", label: "Nothing" }, { value: "suggest", label: "Suggest a next step" }, { value: "trigger", label: "Plan the next step automatically" }];
const REMINDERS = [
  { value: "none", label: "No reminder" }, { value: "0", label: "At the time" }, { value: "15", label: "15 minutes before" }, { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

function useMembers() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  return (options.data?.options.users ?? []).map((user) => ({ value: String(user.id), label: String(user.name ?? "") }));
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
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "activity-types") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "activity-plans") });
    for (const options of ["follow-up-options", "lead-options", "opportunity-options", "task-options", "account-options", "contact-options"])
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", options) });
  };
  const change = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });

  if (!canManage) return <PermissionState title="You can't manage activity types" description="Ask an administrator for the Manage CRM settings permission." />;
  if (types.isLoading || plans.isLoading) return <LoadingState label="Loading activity types" rows={6} />;
  if (types.isError || plans.isError) return <ErrorState title="Could not load activity types" description="Refresh to try again." action={{ label: "Try again", onPress: () => { void types.refetch(); void plans.refetch(); } }} />;
  const all = types.data ?? [];
  const active = all.filter((type) => type.isActive);
  const move = (index: number, offset: number) => {
    const ids = active.map((type) => type.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change.mutate(() => reorderActivityTypes(ids));
  };

  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Activity types and plans" description="The kinds of follow-up your team plans, what each starts with, what comes after it, and ready-made sequences of follow-ups." />
      {error && <Notice>{error}</Notice>}

      <section className="flex max-w-4xl flex-col gap-3" aria-label="Activity types">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Types</h2>
          <Button variant="secondary" onPress={() => setEditingType("new")}><Plus className="size-4" aria-hidden="true" />New type</Button>
        </div>
        <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {all.map((type) => {
            const index = active.findIndex((entry) => entry.id === type.id);
            const facts = [
              type.defaultDelayHours !== null ? `Due ${type.defaultDelayHours === 0 ? "straight away" : `${type.defaultDelayHours} h after it is planned`}` : null,
              type.defaultAssignee === "user" ? `For ${type.defaultUserName ?? "a member"}` : type.defaultAssignee === "creator" ? "For whoever plans it" : null,
              type.emailTemplateName ? `Template: ${type.emailTemplateName}` : null,
              type.chaining !== "none" && type.nextTypeName ? `${type.chaining === "trigger" ? "Then plans" : "Then suggests"} ${type.nextTypeName} after ${type.nextDelayDays} ${type.nextDelayDays === 1 ? "day" : "days"}` : null,
            ].filter(Boolean);
            return (
              <li key={type.id} className="flex items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{type.name}</span>
                    <Badge tone="neutral">{KIND_LABEL[type.kind]}</Badge>
                    {type.isStandard && <Badge tone="brand">Standard</Badge>}
                    {!type.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
                  </div>
                  {facts.length > 0 && <span className="text-text-secondary">{facts.join(" · ")}</span>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {type.isActive && (
                    <>
                      <Button variant="ghost" size="compact" aria-label={`Move ${type.name} earlier`} isDisabled={index === 0 || change.isPending} onPress={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
                      <Button variant="ghost" size="compact" aria-label={`Move ${type.name} later`} isDisabled={index === active.length - 1 || change.isPending} onPress={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
                    </>
                  )}
                  <Button variant="ghost" size="compact" onPress={() => setEditingType(type)}>Edit</Button>
                  {!type.isStandard && (
                    <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => updateActivityType(type.id, { isActive: !type.isActive }))}>{type.isActive ? "Switch off" : "Switch on"}</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex max-w-4xl flex-col gap-3" aria-label="Activity plans">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Plans</h2>
            <p className="text-sm text-text-secondary">Applied from a lead or deal (Apply plan): each step is planned as a follow-up, so many days after.</p>
          </div>
          <Button variant="secondary" isDisabled={!active.length} onPress={() => setEditingPlan("new")}><Plus className="size-4" aria-hidden="true" />New plan</Button>
        </div>
        {(plans.data ?? []).length === 0 ? <p className="text-sm text-text-secondary">No plans yet. For example: New enquiry — call today, email the brochure in 1 day, visit in 7 days.</p> : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
            {(plans.data ?? []).map((plan) => (
              <li key={plan.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plan.name}</span>
                    <Badge tone="neutral">{plan.appliesTo === "any" ? "Leads and deals" : plan.appliesTo === "lead" ? "Leads" : "Deals"}</Badge>
                    {!plan.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
                  </div>
                  <span className="text-text-secondary">{plan.steps.map((step) => `${step.subject || step.activityTypeName} (day ${step.offsetDays})`).join(" → ")}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="compact" onPress={() => setEditingPlan(plan)}>Edit</Button>
                  <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => updateActivityPlan(plan.id, { isActive: !plan.isActive }))}>{plan.isActive ? "Switch off" : "Switch on"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingType && <TypeDialog type={editingType === "new" ? null : editingType} types={active} onClose={() => setEditingType(null)} onSaved={refresh} />}
      {editingPlan && <PlanDialog plan={editingPlan === "new" ? null : editingPlan} types={active} onClose={() => setEditingPlan(null)} onSaved={refresh} />}
    </div>
  );
}

function TypeDialog({ type, types, onClose, onSaved }: { type: ActivityType | null; types: ActivityType[]; onClose: () => void; onSaved: () => void }) {
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
        defaultUserId: assignee === "user" ? userId : null, defaultReminderMinutes: reminder === "none" ? null : Number(reminder), emailTemplateId: templateId || null,
        chaining: chaining as ActivityType["chaining"], nextTypeId: chaining === "none" ? null : nextTypeId, nextDelayDays: Number(nextDelay) || 0,
      };
      return type ? updateActivityType(type.id, input) : createActivityType(input);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const ready = name.trim() && (assignee !== "user" || userId) && (chaining === "none" || nextTypeId);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={type ? `Edit ${type.name}` : "New activity type"} size="lg">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={setName} maxLength={80} />
          <Select label="Kind" description="Decides what completing it records, and which consent it needs." isDisabled={type?.isStandard} selectedKey={kind} onSelectionChange={(key) => setKind(String(key))} options={ACTIVITY_KINDS} />
          <TextField label="Due after (hours)" inputMode="numeric" description="Optional: when it falls due if no date is chosen." value={delay} onChange={setDelay} />
          <Select label="Reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))} options={REMINDERS} />
          <Select label="Who does it" selectedKey={assignee} onSelectionChange={(key) => setAssignee(String(key))} options={ASSIGNEES} />
          {assignee === "user" && <Select label="Member" isRequired selectedKey={userId || null} onSelectionChange={(key) => setUserId(String(key))} options={members} />}
          {kind === "email" && (
            <Select label="Email template" selectedKey={templateId || "none"} onSelectionChange={(key) => setTemplateId(String(key) === "none" ? "" : String(key))}
              options={[{ value: "none", label: "None" }, ...(templates.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
          )}
        </div>
        <fieldset className="grid gap-4 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">When it is completed</legend>
          <Select label="Then" selectedKey={chaining} onSelectionChange={(key) => setChaining(String(key))} options={CHAINING} />
          {chaining !== "none" && (
            <>
              <Select label="Next type" isRequired selectedKey={nextTypeId || null} onSelectionChange={(key) => setNextTypeId(String(key))}
                options={types.map((entry) => ({ value: entry.id, label: entry.name }))} />
              <TextField label="After (days)" inputMode="numeric" value={nextDelay} onChange={setNextDelay} />
            </>
          )}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready} onPress={() => save.mutate()}>{type ? "Save" : "Add type"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

const STEP_ASSIGNEES = [{ value: "record_owner", label: "Record's owner" }, { value: "applier", label: "Whoever applies it" }, { value: "user", label: "A named member" }];

function PlanDialog({ plan, types, onClose, onSaved }: { plan: ActivityPlan | null; types: ActivityType[]; onClose: () => void; onSaved: () => void }) {
  const members = useMembers();
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [appliesTo, setAppliesTo] = useState<string>(plan?.appliesTo ?? "any");
  const [steps, setSteps] = useState<PlanStep[]>(plan?.steps.map(({ activityTypeId, offsetDays, subject, assignee, userId }) => ({ activityTypeId, offsetDays, subject, assignee, userId }))
    ?? [{ activityTypeId: types[0]?.id ?? "", offsetDays: 0, subject: "", assignee: "record_owner" }]);
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, patch: Partial<PlanStep>) => setSteps((current) => current.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  const save = useMutation({
    mutationFn: () => {
      const input = { name, description, appliesTo: appliesTo as ActivityPlan["appliesTo"], steps };
      return plan ? updateActivityPlan(plan.id, input) : createActivityPlan(input);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const ready = name.trim() && steps.length > 0 && steps.every((step) => step.activityTypeId && (step.assignee !== "user" || step.userId));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={plan ? `Edit ${plan.name}` : "New activity plan"} size="xl">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={setName} maxLength={120} />
          <Select label="Used on" selectedKey={appliesTo} onSelectionChange={(key) => setAppliesTo(String(key))}
            options={[{ value: "any", label: "Leads and deals" }, { value: "lead", label: "Leads" }, { value: "opportunity", label: "Deals" }]} />
        </div>
        <TextArea label="Description" value={description} onChange={setDescription} maxLength={500} />
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <li key={index} className="grid items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[1fr_6rem_1.4fr_1fr_auto]">
              <Select label={`Step ${index + 1}`} selectedKey={step.activityTypeId || null} onSelectionChange={(key) => update(index, { activityTypeId: String(key) })}
                options={types.map((entry) => ({ value: entry.id, label: entry.name }))} />
              <TextField label="Day" inputMode="numeric" value={String(step.offsetDays)} onChange={(value) => update(index, { offsetDays: Math.max(0, Math.min(365, Number(value) || 0)) })} />
              <TextField label="Subject (optional)" value={step.subject ?? ""} onChange={(value) => update(index, { subject: value })} maxLength={200} />
              <div className="flex flex-col gap-2">
                <Select label="For" selectedKey={step.assignee} onSelectionChange={(key) => update(index, { assignee: String(key) as PlanStep["assignee"] })} options={STEP_ASSIGNEES} />
                {step.assignee === "user" && <Select aria-label="Member" selectedKey={step.userId || null} onSelectionChange={(key) => update(index, { userId: String(key) })} options={members} />}
              </div>
              <Button variant="ghost" size="compact" aria-label={`Remove step ${index + 1}`} isDisabled={steps.length === 1}
                onPress={() => setSteps((current) => current.filter((_, position) => position !== index))}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ol>
        {steps.length < 20 && (
          <div><Button variant="secondary" size="compact" onPress={() => setSteps((current) => [...current, { activityTypeId: types[0]?.id ?? "", offsetDays: (current.at(-1)?.offsetDays ?? 0) + 1, subject: "", assignee: "record_owner" }])}>
            <Plus className="size-4" aria-hidden="true" />Add step</Button></div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready} onPress={() => save.mutate()}>{plan ? "Save" : "Create plan"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
