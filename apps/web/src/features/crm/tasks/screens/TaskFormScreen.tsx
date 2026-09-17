"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PermissionState, RecordFormPage, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { createTask, listMyTaskTeams, TaskApiError } from "../api/tasks-api";
import { RecurrenceBuilder } from "../components/RecurrenceBuilder";
import type { RecurrenceConfig } from "../types";

type FormValues = { subject: string; description: string; priority: string; assignedTo: string; teamId: string; dueAt: string; reminderAt: string };

const EMPTY: FormValues = { subject: "", description: "", priority: "medium", assignedTo: "", teamId: "", dueAt: "", reminderAt: "" };

export function TaskFormScreen({ canManage = true }: { canManage?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", "teams"), queryFn: listMyTaskTeams });

  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);
  const teamOptions: SelectOption[] = useMemo(() => [{ value: "", label: "No team queue" }, ...(teamsQuery.data?.teams ?? []).map((team) => ({ value: team.id, label: team.name }))], [teamsQuery.data]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!values.subject.trim()) {
        setFieldErrors({ subject: "Subject is required." });
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const input: Record<string, unknown> = { entityType: "general", ...values, recurrenceConfig };
      for (const key of Object.keys(input)) if (input[key] === "") input[key] = null;
      return createTask(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
      router.push("/crm/tasks");
    },
    onError: (error: Error) => {
      setServerError(error instanceof TaskApiError ? error.message : error.message);
    },
  });

  if (!canManage) return <PermissionState title="You don't have access to create Tasks" />;

  return (
    <RecordFormPage
      header={{ title: "New task" }}
      banner={
        serverError ? (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {serverError}
          </p>
        ) : null
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.back()} isDisabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>Create task</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Subject" isRequired value={values.subject} onChange={(v) => set("subject", v)} errorMessage={fieldErrors.subject} className="sm:col-span-2" />
        <Select
          label="Priority"
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ]}
          selectedKey={values.priority}
          onSelectionChange={(key) => set("priority", String(key))}
        />
        <div />
        <Select label="Assignee" options={assigneeOptions} selectedKey={values.assignedTo} onSelectionChange={(key) => set("assignedTo", String(key ?? ""))} />
        <Select label="Team queue" options={teamOptions} selectedKey={values.teamId} onSelectionChange={(key) => set("teamId", String(key ?? ""))} />
        <TextField label="Due at" placeholder="YYYY-MM-DDTHH:mm" value={values.dueAt} onChange={(v) => set("dueAt", v)} />
        <TextField label="Reminder at" placeholder="YYYY-MM-DDTHH:mm" value={values.reminderAt} onChange={(v) => set("reminderAt", v)} />
      </div>
      <TextArea label="Description" value={values.description} onChange={(v) => set("description", v)} />
      <RecurrenceBuilder value={recurrenceConfig} onChange={setRecurrenceConfig} />
    </RecordFormPage>
  );
}
