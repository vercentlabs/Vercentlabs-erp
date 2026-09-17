"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PermissionState, RecordFormPage, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { createFollowUp, FollowUpApiError } from "../api/follow-ups-api";

type FormValues = { subject: string; description: string; followUpReason: string; followUpChannel: string; assignedTo: string; dueAt: string };

const EMPTY: FormValues = { subject: "", description: "", followUpReason: "", followUpChannel: "call", assignedTo: "", dueAt: "" };

export function FollowUpFormScreen({ canManage = true }: { canManage?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [reminderOffsetsText, setReminderOffsetsText] = useState("1440, 60, 0");
  const [reminderChannel, setReminderChannel] = useState<"in_app" | "email">("in_app");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Me" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!values.subject.trim()) {
        setFieldErrors({ subject: "Subject is required." });
        throw new Error("Review the highlighted fields.");
      }
      if (!values.dueAt) {
        setFieldErrors({ dueAt: "A due date/time is required." });
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const reminderOffsets = reminderOffsetsText
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const input: Record<string, unknown> = { entityType: "general", ...values, reminderOffsets, reminderChannel };
      for (const key of Object.keys(input)) if (input[key] === "") input[key] = null;
      return createFollowUp(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
      router.push("/crm/follow-ups");
    },
    onError: (error: Error) => {
      setServerError(error instanceof FollowUpApiError ? error.message : error.message);
    },
  });

  if (!canManage) return <PermissionState title="You don't have access to create Follow-ups" />;

  return (
    <RecordFormPage
      header={{ title: "New follow-up", description: "Configure when and how you're reminded, below — defaults to a day before, an hour before, and at due time." }}
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
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>Create follow-up</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Subject" isRequired value={values.subject} onChange={(v) => set("subject", v)} errorMessage={fieldErrors.subject} className="sm:col-span-2" />
        <TextField label="Reason" value={values.followUpReason} onChange={(v) => set("followUpReason", v)} />
        <Select
          label="Channel"
          options={[
            { value: "call", label: "Call" },
            { value: "email", label: "Email" },
            { value: "meeting", label: "Meeting" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "sms", label: "SMS" },
            { value: "other", label: "Other" },
          ]}
          selectedKey={values.followUpChannel}
          onSelectionChange={(key) => set("followUpChannel", String(key))}
        />
        <Select label="Assignee" options={assigneeOptions} selectedKey={values.assignedTo} onSelectionChange={(key) => set("assignedTo", String(key ?? ""))} />
        <TextField label="Due at" isRequired placeholder="YYYY-MM-DDTHH:mm" value={values.dueAt} onChange={(v) => set("dueAt", v)} errorMessage={fieldErrors.dueAt} />
      </div>
      <TextArea label="Description" value={values.description} onChange={(v) => set("description", v)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Reminder offsets (minutes before due, comma-separated)"
          description="e.g. 1440, 60, 0 for a day before, an hour before, and at due time."
          value={reminderOffsetsText}
          onChange={setReminderOffsetsText}
        />
        <Select
          label="Reminder channel"
          options={[
            { value: "in_app", label: "In-app" },
            { value: "email", label: "Email" },
          ]}
          selectedKey={reminderChannel}
          onSelectionChange={(key) => setReminderChannel((key as "in_app" | "email") ?? "in_app")}
        />
      </div>
    </RecordFormPage>
  );
}
