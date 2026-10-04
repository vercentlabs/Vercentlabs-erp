"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { AlertDialog, Button, ErrorState, Menu, MenuItem, MenuTrigger, RecordDetailsPage } from "@vercentlabs/design-system";

import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { deleteTask, errorMessage, getTask, getTaskOptions, listTaskHistory, reopenTask, startTask } from "../api/tasks-api";
import { AssignTaskDialog, CancelTaskDialog, CompleteTaskDialog, TaskFormDialog } from "../components/TaskDialogs";
import { ErrorBanner, RELATED_LABELS, TaskDue, TaskPriorityBadge, TaskStatusBadge } from "../task-format";

type DialogKind = "edit" | "complete" | "cancel" | "assign" | "delete" | null;

export function TaskDetailScreen({ taskId }: { taskId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "crm", "tasks", "record", taskId);
  const taskQuery = useQuery({ queryKey: key, queryFn: () => getTask(taskId), staleTime: 0, refetchOnWindowFocus: true });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000 });
  const historyQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", "history", taskId, taskQuery.data?.updatedAt), queryFn: () => listTaskHistory(taskId), enabled: Boolean(taskQuery.data) });
  const task = taskQuery.data;
  const options = optionsQuery.data;

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });

  if (taskQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading task" />;
  if (taskQuery.isError || !task)
    return <ErrorState title="Task not found" description="It may have been deleted, or you may not have access to it." action={{ label: "Back to tasks", onPress: () => router.push("/crm/tasks") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  const can = options.capabilities;
  const open = task.status === "open" || task.status === "in_progress";
  const close = (isOpen: boolean) => !isOpen && setDialog(null);
  const primaryAction = open
    ? can.complete && <Button variant="primary" onPress={() => setDialog("complete")}>Complete</Button>
    : can.reopen && <Button variant="primary" onPress={() => action.mutate(() => reopenTask(task.id, { expectedUpdatedAt: task.updatedAt }))} isLoading={action.isPending}>Reopen</Button>;
  const menu = [
    { id: "edit", label: "Edit task", show: open && can.edit, run: () => setDialog("edit") },
    { id: "start", label: "Mark in progress", show: task.status === "open" && can.edit, run: () => action.mutate(() => startTask(task.id, task.updatedAt)) },
    { id: "assign", label: "Reassign", show: open && can.reassign, run: () => setDialog("assign") },
    { id: "cancel", label: "Cancel task", show: open && can.cancel, run: () => setDialog("cancel") },
    { id: "delete", label: "Delete task", show: can.delete, run: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{task.title} <span className="text-base font-normal whitespace-nowrap text-text-muted">{task.number}</span></>,
          status: <span className="flex flex-wrap items-center gap-2"><TaskStatusBadge status={task.status} /><TaskPriorityBadge priority={task.priority} /></span>,
          fields: [
            { label: "Due", value: <TaskDue task={task} /> },
            { label: "Assigned to", value: task.assignedName ?? "Unassigned" },
            { label: "About", value: task.relatedHref ? <Link className="hover:underline" href={task.relatedHref}>{task.relatedName ?? RELATED_LABELS[task.relatedType ?? ""]}</Link> : "Personal task" },
            { label: "Account", value: task.accountId ? <Link className="hover:underline" href={`/crm/accounts/${task.accountId}`}>{task.accountName}</Link> : "—" },
          ],
          primaryAction,
          secondaryActions: menu.length ? (
            <MenuTrigger>
              <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
              <Menu onAction={(id) => menu.find((entry) => entry.id === id)?.run()}>{menu.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}</Menu>
            </MenuTrigger>
          ) : undefined,
        }}
        tabs={<ErrorBanner message={error} />}
      >
        <div className="flex flex-col gap-6">
          {task.status === "completed" && (
            <p role="status" className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm">
              Completed {formatDateTime(task.completedAt)}{task.completedByName ? ` by ${task.completedByName}` : ""}{task.completionNote ? ` — ${task.completionNote}` : ""}
            </p>
          )}
          {task.status === "cancelled" && (
            <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
              Cancelled {formatDateTime(task.cancelledAt)}{task.cancelledByName ? ` by ${task.cancelledByName}` : ""}{task.cancellationReason ? ` — ${task.cancellationReason}` : ""}
            </p>
          )}
          <PropertyList title="Task" columns={3} items={[
            { label: "Description", value: task.description ? <span className="whitespace-pre-wrap">{task.description}</span> : null, wide: true },
            { label: "Reminder", value: task.reminderOffsetMinutes === null ? "None" : options.reminderOptions.find((entry) => entry.minutes === task.reminderOffsetMinutes)?.label ?? `${formatDateTime(task.reminderAt)}` },
            { label: "Created", value: `${formatDateTime(task.createdAt)}${task.createdByName ? ` by ${task.createdByName}` : ""}` },
            { label: "Updated", value: `${formatDateTime(task.updatedAt)}${task.updatedByName ? ` by ${task.updatedByName}` : ""}` },
          ]} />
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">History</h2>
            {historyQuery.isLoading ? <LoadingState label="Loading history" rows={3} /> : (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
                {(historyQuery.data ?? []).map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                    <span className="font-medium">{entry.summary}</span>
                    {typeof entry.changes.reason === "string" && entry.changes.reason && entry.eventType !== "cancelled" && entry.eventType !== "reopened" && <span className="text-text-secondary">{entry.changes.reason}</span>}
                    <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)} · {entry.actorName ?? "System"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </RecordDetailsPage>

      {dialog === "edit" && <TaskFormDialog isOpen onOpenChange={close} options={options} task={task} onSaved={refresh} />}
      {dialog === "complete" && <CompleteTaskDialog isOpen onOpenChange={close} task={task} options={options} onDone={refresh} />}
      {dialog === "cancel" && <CancelTaskDialog isOpen onOpenChange={close} task={task} onDone={refresh} />}
      {dialog === "assign" && <AssignTaskDialog isOpen onOpenChange={close} task={task} options={options} onDone={refresh} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={close} tone="danger" confirmLabel="Delete task" isConfirming={action.isPending}
        title="Delete this task?"
        description="Only a task created by mistake can be deleted: never started, completed, cancelled or reassigned. Otherwise cancel it, so its history is kept."
        onConfirm={() => action.mutate(async () => { try { await deleteTask(task.id); router.replace("/crm/tasks"); } finally { setDialog(null); } })} />
    </>
  );
}
