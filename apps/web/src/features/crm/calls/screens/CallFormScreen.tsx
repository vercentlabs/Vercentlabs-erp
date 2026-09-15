"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberField, PermissionState, RecordFormPage, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { CallApiError, createCall } from "../api/calls-api";

type FormValues = {
  mode: "schedule" | "log";
  subject: string;
  description: string;
  direction: "inbound" | "outbound";
  phoneNumber: string;
  assignedTo: string;
  dueAt: string;
  occurredAt: string;
  durationSeconds: number | null;
  outcomeCode: string;
  outcome: string;
};

const OUTCOME_OPTIONS: SelectOption[] = [
  { value: "connected", label: "Connected" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "voicemail", label: "Voicemail" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "failed", label: "Failed" },
];

const EMPTY: FormValues = { mode: "schedule", subject: "", description: "", direction: "outbound", phoneNumber: "", assignedTo: "", dueAt: "", occurredAt: "", durationSeconds: null, outcomeCode: "connected", outcome: "" };

export function CallFormScreen({ canManage = true }: { canManage?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(EMPTY);
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
      setFieldErrors({});
      const input: Record<string, unknown> = {
        entityType: "general",
        mode: values.mode,
        subject: values.subject,
        description: values.description || null,
        direction: values.direction,
        phoneNumber: values.phoneNumber || null,
        assignedTo: values.assignedTo || null,
      };
      if (values.mode === "schedule") {
        input.dueAt = values.dueAt || null;
      } else {
        input.occurredAt = values.occurredAt || new Date().toISOString();
        input.durationSeconds = values.durationSeconds ?? 0;
        input.outcomeCode = values.outcomeCode;
        input.outcome = values.outcome || null;
      }
      return createCall(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "calls") });
      router.push("/crm/calls");
    },
    onError: (error: Error) => {
      setServerError(error instanceof CallApiError ? error.message : error.message);
    },
  });

  if (!canManage) return <PermissionState title="You don't have access to create Calls" />;

  return (
    <RecordFormPage
      header={{ title: "New call", description: "Schedule a call for later, or log one that already happened." }}
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
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>{values.mode === "schedule" ? "Schedule call" : "Log call"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Mode"
          options={[
            { value: "schedule", label: "Schedule for later" },
            { value: "log", label: "Log a completed call" },
          ]}
          selectedKey={values.mode}
          onSelectionChange={(key) => set("mode", String(key) as FormValues["mode"])}
          className="sm:col-span-2"
        />
        <TextField label="Subject" isRequired value={values.subject} onChange={(v) => set("subject", v)} errorMessage={fieldErrors.subject} className="sm:col-span-2" />
        <Select
          label="Direction"
          options={[
            { value: "outbound", label: "Outbound" },
            { value: "inbound", label: "Inbound" },
          ]}
          selectedKey={values.direction}
          onSelectionChange={(key) => set("direction", String(key) as FormValues["direction"])}
        />
        <TextField label="Phone number" value={values.phoneNumber} onChange={(v) => set("phoneNumber", v)} />
        <Select label="Assignee" options={assigneeOptions} selectedKey={values.assignedTo} onSelectionChange={(key) => set("assignedTo", String(key ?? ""))} />
        {values.mode === "schedule" ? (
          <TextField label="Due at" placeholder="YYYY-MM-DDTHH:mm" value={values.dueAt} onChange={(v) => set("dueAt", v)} />
        ) : (
          <>
            <TextField label="Occurred at" placeholder="YYYY-MM-DDTHH:mm" value={values.occurredAt} onChange={(v) => set("occurredAt", v)} />
            <NumberField label="Duration (seconds)" value={values.durationSeconds ?? 0} onChange={(v) => set("durationSeconds", v)} minValue={0} maxValue={86400} />
            <Select label="Outcome" options={OUTCOME_OPTIONS} selectedKey={values.outcomeCode} onSelectionChange={(key) => set("outcomeCode", String(key))} />
          </>
        )}
      </div>
      <TextArea label="Description" value={values.description} onChange={(v) => set("description", v)} />
    </RecordFormPage>
  );
}
