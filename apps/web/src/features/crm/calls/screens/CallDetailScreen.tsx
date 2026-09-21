"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { dueLabel, dueState, formatDateTime, humanize } from "@/features/crm/shared/human";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { RelatedRecordCard } from "@/features/crm/shared/ui/RelatedRecordCard";
import { CallApiError, getCall, updateCall } from "../api/calls-api";
import type { Call } from "../types";

const minutesText = (seconds: number) => (seconds < 60 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`);

// F013 Tranche J (Stage A) — a dedicated Call detail view was missing;
// getCrmCall/updateCrmCall (call-operations.js) were already real,
// already-tested, already routed (/api/crm/calls/[id] GET/PATCH) with no
// frontend consumer. Edit is an inline dialog over CALL_FIELDS' writable
// subset, not a separate route — the create form's schedule/log mode
// toggle has no meaning for an already-existing call, so this is
// deliberately not a reuse of CallFormScreen.
export function CallDetailScreen({ callId }: { callId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "calls", callId), queryFn: () => getCall(callId) });
  const call = query.data?.record;

  if (query.isLoading) return <LoadingState label="Loading call" rows={3} />;
  if (query.isError) {
    if (query.error instanceof CallApiError && query.error.status === 403) return <PermissionState title="You don't have access to this call" />;
    return <ErrorState title="Call not found" action={{ label: "Back to Calls", onPress: () => router.push("/crm/calls") }} />;
  }
  if (!call) return null;

  return (
    <RecordDetailsPage
      header={{
        title: call.subject,
        status: <StatusBadge tone={call.status === "completed" ? "success" : call.status === "cancelled" ? "neutral" : "info"}>{call.status}</StatusBadge>,
        fields: [
          { label: "Direction", value: call.direction ? humanize(call.direction) : "" },
          { label: "Assignee", value: call.assignedName ?? "Unassigned" },
          { label: "When", value: call.dueAt ? `${formatDateTime(call.dueAt)}${(call.status === "planned" || call.status === "overdue") && dueState(call.dueAt) === "overdue" ? " (" + dueLabel(call.dueAt) + ")" : ""}` : "" },
        ].filter((field) => field.value !== ""),
        // updateCrmCall rejects any status other than planned/overdue
        // (CRM_CALL_READ_ONLY) — hiding Edit outside that window avoids
        // offering an action the backend will reject.
        primaryAction: canManage && (call.status === "planned" || call.status === "overdue") ? (
          <Button variant="secondary" onPress={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : undefined,
      }}
    >
      <div className="flex flex-col gap-4 py-4">
        <PropertyList title="Related record" columns={1} items={[{ label: "Belongs to", value: <RelatedRecordCard entityType={call.entityType} entityId={call.entityId} /> }]} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PropertyList title="The call" items={[
            { label: "Phone number", value: call.phoneNumber },
            { label: "Priority", value: humanize(call.priority) },
            { label: "Reminder", value: call.reminderAt ? formatDateTime(call.reminderAt) : null },
            { label: "Description", value: call.description, wide: true },
          ]} />
          <PropertyList title="What happened" description={call.status === "planned" || call.status === "overdue" ? "Nothing logged yet." : undefined} items={[
            { label: "Started", value: call.callStartedAt ? formatDateTime(call.callStartedAt) : null },
            { label: "Ended", value: call.callEndedAt ? formatDateTime(call.callEndedAt) : null },
            { label: "Duration", value: call.callDurationSeconds != null ? minutesText(call.callDurationSeconds) : null },
            { label: "Outcome", value: humanize(call.outcomeCode) },
            { label: "Notes", value: call.outcome, wide: true },
            { label: "Completed", value: call.completedAt ? formatDateTime(call.completedAt) : null },
          ]} />
        </div>
      </div>
      <EditCallDialog isOpen={editOpen} onOpenChange={setEditOpen} call={call} />
    </RecordDetailsPage>
  );
}

function EditCallDialog({ isOpen, onOpenChange, call }: { isOpen: boolean; onOpenChange: (open: boolean) => void; call: Call }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(call.subject);
  const [description, setDescription] = useState(call.description ?? "");
  const [direction, setDirection] = useState(call.direction ?? "outbound");
  const [phoneNumber, setPhoneNumber] = useState(call.phoneNumber ?? "");
  const [assignedTo, setAssignedTo] = useState(call.assignedTo ?? "");
  const [error, setError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const mutation = useMutation({
    mutationFn: () => updateCall(call.id, { subject, description: description || null, direction, phoneNumber: phoneNumber || null, assignedTo: assignedTo || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "calls", call.id) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "calls") });
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(err instanceof CallApiError ? err.message : "This call could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Edit ${call.subject}`}>
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label="Subject" isRequired value={subject} onChange={setSubject} />
        <Select
          label="Direction"
          options={[
            { value: "outbound", label: "Outbound" },
            { value: "inbound", label: "Inbound" },
          ]}
          selectedKey={direction}
          onSelectionChange={(key) => setDirection(String(key ?? "outbound") as "inbound" | "outbound")}
        />
        <TextField label="Phone number" value={phoneNumber} onChange={setPhoneNumber} />
        <Select label="Assignee" options={assigneeOptions} selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key ?? ""))} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!subject.trim()}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
