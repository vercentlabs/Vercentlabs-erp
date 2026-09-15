"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { FollowUpApiError, getFollowUp, updateFollowUp } from "../api/follow-ups-api";
import type { FollowUp } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

// F016 Tranche J (Stage A) — dedicated Follow-up detail view; getCrmFollowUp/
// updateCrmFollowUp (follow-up-operations.js) were already real, already
// routed, with no frontend consumer. Shows snooze count/escalation state
// read-only (real fields, already tracked server-side); a custom
// snooze-duration control and a full reminder/escalation event timeline
// remain disclosed, not-built gaps — this pass only closes the missing
// detail/edit surface, not those deeper history views.
export function FollowUpDetailScreen({ followUpId }: { followUpId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId), queryFn: () => getFollowUp(followUpId) });
  const followUp = query.data?.record;

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading follow-up…</p>;
  if (query.isError) {
    if (query.error instanceof FollowUpApiError && query.error.status === 403) return <PermissionState title="You don't have access to this follow-up" />;
    return <ErrorState title="Follow-up not found" action={{ label: "Back to Follow-ups", onPress: () => router.push("/crm/follow-ups") }} />;
  }
  if (!followUp) return null;

  return (
    <RecordDetailsPage
      header={{
        title: followUp.subject,
        status: <StatusBadge tone={followUp.status === "completed" ? "success" : followUp.status === "cancelled" ? "neutral" : "info"}>{followUp.status}</StatusBadge>,
        fields: [
          { label: "Channel", value: followUp.followUpChannel ?? "—" },
          { label: "Assignee", value: followUp.assignedName ?? "Unassigned" },
        ],
        // updateCrmFollowUp rejects completed/cancelled (CRM_FOLLOW_UP_READ_ONLY)
        // — hiding Edit in those states avoids offering a rejected action.
        primaryAction: canManage && followUp.status !== "completed" && followUp.status !== "cancelled" ? (
          <Button variant="secondary" onPress={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : undefined,
      }}
    >
      <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
        <Field label="Due at" value={followUp.dueAt ? dateFormatter.format(new Date(followUp.dueAt)) : null} />
        <Field label="Reason" value={followUp.followUpReason} />
        <Field label="Snooze count" value={followUp.followUpSnoozeCount ?? 0} />
        <Field label="Escalate after (minutes)" value={followUp.escalateAfterMinutes} />
        <Field label="Escalated at" value={followUp.followUpEscalatedAt ? dateFormatter.format(new Date(followUp.followUpEscalatedAt)) : null} />
        <Field label="Completed at" value={followUp.completedAt ? dateFormatter.format(new Date(followUp.completedAt)) : null} />
      </div>
      {followUp.description && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="text-xs text-text-muted">Description</span>
          <p className="text-sm text-text">{followUp.description}</p>
        </div>
      )}
      <EditFollowUpDialog isOpen={editOpen} onOpenChange={setEditOpen} followUp={followUp} />
    </RecordDetailsPage>
  );
}

function EditFollowUpDialog({ isOpen, onOpenChange, followUp }: { isOpen: boolean; onOpenChange: (open: boolean) => void; followUp: FollowUp }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(followUp.subject);
  const [description, setDescription] = useState(followUp.description ?? "");
  const [followUpReason, setFollowUpReason] = useState(followUp.followUpReason ?? "");
  const [followUpChannel, setFollowUpChannel] = useState(followUp.followUpChannel ?? "call");
  const [assignedTo, setAssignedTo] = useState(followUp.assignedTo ?? "");
  const [error, setError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateFollowUp(followUp.id, {
        subject,
        description: description || null,
        followUpReason: followUpReason || null,
        followUpChannel,
        assignedTo: assignedTo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUp.id) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(err instanceof FollowUpApiError ? err.message : "This follow-up could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Edit ${followUp.subject}`}>
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label="Subject" isRequired value={subject} onChange={setSubject} />
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
          selectedKey={followUpChannel}
          onSelectionChange={(key) => setFollowUpChannel(String(key ?? "call") as "call" | "email" | "meeting" | "whatsapp" | "sms" | "other")}
        />
        <TextField label="Reason" value={followUpReason} onChange={setFollowUpReason} />
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
