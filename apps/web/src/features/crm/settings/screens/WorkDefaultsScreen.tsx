"use client";

// The working week (days, hours, off Saturdays — what reminders, response times and stage limits count in), then task and follow-up
// defaults: what a new task or follow-up starts with, on one page in short sections. The salesperson can still change each value
// when creating one.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class WorkDefaultsApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(WorkDefaultsApiError, "body");

export type WorkDefaults = {
  taskPriority: string; taskReminderMinutes: number | null; followUpType: string; followUpReminderMinutes: number | null;
  workingDays: number[]; workStart: string; workEnd: string; saturdaysOff: number[]; leadStaleDays: number;
};
export type WorkDefaultChoices = {
  taskPriorities: Array<{ code: string; label: string }>; taskReminderOptions: Array<{ minutes: number; label: string }>;
  followUpTypes: Array<{ code: string; label: string }>; followUpReminderOptions: Array<{ minutes: number; label: string }>;
  weekdays: Array<{ day: number; label: string }>; saturdayRules: Array<{ code: string; label: string; saturdaysOff: number[] }>;
};
export const getWorkDefaults = () => request<{ defaults: WorkDefaults; choices: WorkDefaultChoices }>("/api/crm/work-defaults");
const saveWorkDefaults = (input: Partial<WorkDefaults>) => request<{ defaults: WorkDefaults }>("/api/crm/work-defaults", { method: "PUT", json: input });

const NONE = "none";
// Half-hour steps from 06:00 to 23:30 for the start and end of the working day.
const CLOCK_TIMES = Array.from({ length: 36 }, (_, index) => {
  const minutes = 360 + index * 30;
  const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const hour = Math.floor(minutes / 60);
  return { value, label: `${((hour + 11) % 12) + 1}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}` };
});
const reminderOptions = (options: Array<{ minutes: number; label: string }>) => [{ value: NONE, label: "No reminder" }, ...options.map((option) => ({ value: String(option.minutes), label: option.label }))];

// section: which of the two the address named (both are shown; that one first).
export function WorkDefaultsScreen({ section }: { section: "tasks" | "follow-ups" }) {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "work-defaults"), queryFn: getWorkDefaults, enabled: canManage });
  if (!canManage) return <PermissionState title="You cannot open CRM settings" description="Ask a CRM administrator for access." />;
  const order: Array<"tasks" | "follow-ups"> = section === "tasks" ? ["tasks", "follow-ups"] : ["follow-ups", "tasks"];
  return (
    <div className="flex flex-1 flex-col gap-4">
      <SetupBackLink />
      <PageHeader title="Working week and defaults" description="When your business works, and what a new task or follow-up starts with. Each can still be changed when it is created." />
      {query.isLoading || !query.data ? <LoadingState label="Loading defaults" rows={2} />
        : <>
          {/* Desktop: as on Setup, each part's title on the left and its settings on the right, a rule between parts. */}
          <div className="flex flex-col gap-4 lg:gap-0 lg:divide-y lg:divide-border lg:border-t lg:border-border">
            <WorkingWeekForm defaults={query.data.defaults} choices={query.data.choices} />
            {order.map((part) => <DefaultsForm key={part} section={part} defaults={query.data.defaults} choices={query.data.choices} />)}
          </div>
        </>}
    </div>
  );
}

// The days and hours the business works. Reminders skip days off; the lead first-response time and stage time limits count only
// working time.
function WorkingWeekForm({ defaults, choices }: { defaults: WorkDefaults; choices: WorkDefaultChoices }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number[]>(defaults.workingDays);
  const [start, setStart] = useState(defaults.workStart);
  const [end, setEnd] = useState(defaults.workEnd);
  const ruleOf = (off: number[]) => choices.saturdayRules.find((rule) => rule.saturdaysOff.join() === [...off].sort().join())?.code ?? "none";
  const [saturdays, setSaturdays] = useState(ruleOf(defaults.saturdaysOff));
  const [staleDays, setStaleDays] = useState(String(defaults.leadStaleDays ?? 7));
  const toggle = (day: number) => setDays((current) => (current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day]));
  const save = useMutation({
    mutationFn: () => saveWorkDefaults({ workingDays: days, workStart: start, workEnd: end, leadStaleDays: Number(staleDays) || 7,
      saturdaysOff: days.includes(6) ? (choices.saturdayRules.find((rule) => rule.code === saturdays)?.saturdaysOff ?? []) : [] }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "work-defaults") }),
  });
  const times = CLOCK_TIMES.some((time) => time.value === start) && CLOCK_TIMES.some((time) => time.value === end) ? CLOCK_TIMES
    : [...CLOCK_TIMES, ...[start, end].filter((value) => !CLOCK_TIMES.some((time) => time.value === value)).map((value) => ({ value, label: value }))];
  return (
    <Part id="working-week" title="Working week" describeOnPhone description="Reminders skip days off and holidays, and lead response times and stage time limits count only working time.">
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : "The working week could not be saved."}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-success">Saved.</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">Working days</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {choices.weekdays.map((entry) => <Checkbox key={entry.day} isSelected={days.includes(entry.day)} onChange={() => toggle(entry.day)}>{entry.label}</Checkbox>)}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Day starts" selectedKey={start} onSelectionChange={(key) => setStart(String(key))} options={times} />
        <Select label="Day ends" selectedKey={end} onSelectionChange={(key) => setEnd(String(key))} options={times} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
        <TextField label="Flag a lead with no activity after" inputMode="numeric" value={staleDays} onChange={setStaleDays}
          description="Days. A lead stage can set its own time instead (Setup › Lead stages)." />
        {days.includes(6) && (
          <Select label="Saturdays" selectedKey={saturdays} onSelectionChange={(key) => setSaturdays(String(key))}
            options={choices.saturdayRules.map((rule) => ({ value: rule.code, label: rule.label }))} />
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" isLoading={save.isPending} isDisabled={!days.length} onPress={() => save.mutate()}>Save working week</Button>
      </div>
    </Part>
  );
}

function DefaultsForm({ section, defaults, choices }: { section: "tasks" | "follow-ups"; defaults: WorkDefaults; choices: WorkDefaultChoices }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const tasks = section === "tasks";
  const [first, setFirst] = useState(tasks ? defaults.taskPriority : defaults.followUpType);
  const [reminder, setReminder] = useState(String((tasks ? defaults.taskReminderMinutes : defaults.followUpReminderMinutes) ?? NONE));
  const save = useMutation({
    mutationFn: () => {
      const minutes = reminder === NONE ? null : Number(reminder);
      return saveWorkDefaults(tasks ? { taskPriority: first, taskReminderMinutes: minutes } : { followUpType: first, followUpReminderMinutes: minutes });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "work-defaults") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "task-options") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options") });
    },
  });
  return (
    <Part id={section} title={tasks ? "New tasks" : "New follow-ups"}
      description={tasks ? "What a new task starts with. It can still be changed on the task." : "What a new follow-up starts with. It can still be changed on the follow-up."}>
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : "The defaults could not be saved."}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-success">Saved.</p>}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
        {tasks
          ? <Select label="Default priority" selectedKey={first} onSelectionChange={(key) => setFirst(String(key))} options={choices.taskPriorities.map((entry) => ({ value: entry.code, label: entry.label }))} />
          : <Select label="Default type" selectedKey={first} onSelectionChange={(key) => setFirst(String(key))} options={choices.followUpTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />}
        <Select label="Default reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))}
          options={reminderOptions(tasks ? choices.taskReminderOptions : choices.followUpReminderOptions)} />
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" isLoading={save.isPending} onPress={() => save.mutate()}>{tasks ? "Save task defaults" : "Save follow-up defaults"}</Button>
      </div>
    </Part>
  );
}

// One part of the page. Phone: a card with its title inside (as before). Tablet: the card runs the full width. Desktop: the title and
// explanation sit on the left, the card on the right, as on Setup.
// describeOnPhone: the explanation also shows in the card on a phone (the working week's did; the defaults' cards had only a title).
function Part({ id, title, description, describeOnPhone = false, children }: { id: string; title: string; description: string; describeOnPhone?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-8">
      <div className="hidden flex-col gap-1 lg:flex" aria-hidden="true">
        <p className="text-base font-semibold text-text">{title}</p>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      <div className="flex max-w-xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:max-w-none sm:p-5">
        {/* Desktop: the title moves to the left column; here it stays for screen readers only, and takes no room. */}
        <div className="lg:contents">
          <h2 id={`${id}-heading`} className="text-base font-semibold text-text lg:sr-only">{title}</h2>
          <p className={`text-sm text-text-secondary lg:hidden ${describeOnPhone ? "" : "max-sm:hidden"}`}>{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}
