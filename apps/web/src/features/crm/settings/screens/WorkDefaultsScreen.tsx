"use client";

// Task Defaults and Follow-up Defaults: what a new task or follow-up starts
// with. The salesperson can still change each value when creating one.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class WorkDefaultsApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(WorkDefaultsApiError, "body");

type WorkDefaults = { taskPriority: string; taskReminderMinutes: number | null; followUpType: string; followUpReminderMinutes: number | null };
type Choices = {
  taskPriorities: Array<{ code: string; label: string }>; taskReminderOptions: Array<{ minutes: number; label: string }>;
  followUpTypes: Array<{ code: string; label: string }>; followUpReminderOptions: Array<{ minutes: number; label: string }>;
};
const getWorkDefaults = () => request<{ defaults: WorkDefaults; choices: Choices }>("/api/crm/work-defaults");
const saveWorkDefaults = (input: Partial<WorkDefaults>) => request<{ defaults: WorkDefaults }>("/api/crm/work-defaults", { method: "PUT", json: input });

const NONE = "none";
const reminderOptions = (options: Array<{ minutes: number; label: string }>) => [{ value: NONE, label: "No reminder" }, ...options.map((option) => ({ value: String(option.minutes), label: option.label }))];

export function WorkDefaultsScreen({ section }: { section: "tasks" | "follow-ups" }) {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "work-defaults"), queryFn: getWorkDefaults, enabled: canManage });
  if (!canManage) return <PermissionState title="You cannot open CRM settings" description="Ask a CRM administrator for access." />;
  const tasks = section === "tasks";
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title={tasks ? "Task Defaults" : "Follow-up Defaults"}
        description={tasks ? "What a new task starts with. It can be changed on each task." : "What a new follow-up starts with. It can be changed on each follow-up."} />
      {query.isLoading || !query.data ? <LoadingState label="Loading defaults" rows={2} /> : <DefaultsForm key={section} section={section} defaults={query.data.defaults} choices={query.data.choices} />}
    </div>
  );
}

function DefaultsForm({ section, defaults, choices }: { section: "tasks" | "follow-ups"; defaults: WorkDefaults; choices: Choices }) {
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
    <section className="flex max-w-xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : "The defaults could not be saved."}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-success">Saved.</p>}
      {tasks
        ? <Select label="Default priority" selectedKey={first} onSelectionChange={(key) => setFirst(String(key))} options={choices.taskPriorities.map((entry) => ({ value: entry.code, label: entry.label }))} />
        : <Select label="Default type" selectedKey={first} onSelectionChange={(key) => setFirst(String(key))} options={choices.followUpTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />}
      <Select label="Default reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))}
        options={reminderOptions(tasks ? choices.taskReminderOptions : choices.followUpReminderOptions)} />
      <div className="flex justify-end">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
      </div>
    </section>
  );
}
