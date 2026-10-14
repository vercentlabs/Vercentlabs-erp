"use client";

// Task and follow-up defaults: what a new task or follow-up starts with, on one page in two short sections. The salesperson can still change
// each value when creating one.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class WorkDefaultsApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(WorkDefaultsApiError, "body");

export type WorkDefaults = { taskPriority: string; taskReminderMinutes: number | null; followUpType: string; followUpReminderMinutes: number | null };
export type WorkDefaultChoices = {
  taskPriorities: Array<{ code: string; label: string }>; taskReminderOptions: Array<{ minutes: number; label: string }>;
  followUpTypes: Array<{ code: string; label: string }>; followUpReminderOptions: Array<{ minutes: number; label: string }>;
};
export const getWorkDefaults = () => request<{ defaults: WorkDefaults; choices: WorkDefaultChoices }>("/api/crm/work-defaults");
const saveWorkDefaults = (input: Partial<WorkDefaults>) => request<{ defaults: WorkDefaults }>("/api/crm/work-defaults", { method: "PUT", json: input });

const NONE = "none";
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
      <PageHeader title="Task and follow-up defaults" description="What a new task or follow-up starts with. Each can still be changed when it is created." />
      {query.isLoading || !query.data ? <LoadingState label="Loading defaults" rows={2} />
        : order.map((part) => <DefaultsForm key={part} section={part} defaults={query.data.defaults} choices={query.data.choices} />)}
    </div>
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
    <section id={section} aria-labelledby={`${section}-heading`} className="flex max-w-xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 id={`${section}-heading`} className="text-base font-semibold text-text">{tasks ? "New tasks" : "New follow-ups"}</h2>
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : "The defaults could not be saved."}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-success">Saved.</p>}
      {tasks
        ? <Select label="Default priority" selectedKey={first} onSelectionChange={(key) => setFirst(String(key))} options={choices.taskPriorities.map((entry) => ({ value: entry.code, label: entry.label }))} />
        : <Select label="Default type" selectedKey={first} onSelectionChange={(key) => setFirst(String(key))} options={choices.followUpTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />}
      <Select label="Default reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))}
        options={reminderOptions(tasks ? choices.taskReminderOptions : choices.followUpReminderOptions)} />
      <div className="flex justify-end">
        <Button variant="secondary" isLoading={save.isPending} onPress={() => save.mutate()}>{tasks ? "Save task defaults" : "Save follow-up defaults"}</Button>
      </div>
    </section>
  );
}
