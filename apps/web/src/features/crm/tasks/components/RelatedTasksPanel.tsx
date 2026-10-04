"use client";

// The tasks on one lead, account, contact or opportunity: quick create with
// the record prefilled, and quick complete or reopen without opening the task.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getTaskOptions, listTasks, reopenTask, type Task, type TaskRelatedType } from "../api/tasks-api";
import { ErrorBanner, TaskDue, TaskPriorityBadge, TaskStatusBadge } from "../task-format";
import { CompleteTaskDialog, TaskFormDialog } from "./TaskDialogs";

export function RelatedTasksPanel({ relatedType, relatedId, relatedName, canCreate = true, onChanged }: {
  relatedType: TaskRelatedType; relatedId: string; relatedName?: string | null; canCreate?: boolean; onChanged?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Task | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filters = relatedType === "party" ? { view: "all" as const, accountId: relatedId } : { view: "all" as const, relatedType, relatedId };
  const key = scopedQueryKey(workspace, "crm", "tasks", "related", relatedType, relatedId);
  const query = useQuery({ queryKey: key, queryFn: () => listTasks({ ...filters, limit: 100 }) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
    onChanged?.();
  };
  const reopen = useMutation({ mutationFn: (task: Task) => reopenTask(task.id, { expectedUpdatedAt: task.updatedAt }), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const tasks = query.data?.rows ?? [];
  const open = tasks.filter((task) => task.status === "open" || task.status === "in_progress");
  const shown = showClosed ? tasks : open;
  const can = options?.capabilities;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          {open.length} open {open.length === 1 ? "task" : "tasks"}{relatedType === "party" ? ", including those on this account's opportunities and contacts" : ""}. Tasks also appear in CRM Tasks.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox isSelected={showClosed} onChange={setShowClosed}>Show completed and cancelled</Checkbox>
          {canCreate && can?.create && <Button variant="primary" size="compact" onPress={() => setCreating(true)}>New task</Button>}
        </div>
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading tasks" rows={3} /> : shown.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
          {showClosed ? "No tasks yet." : "No open tasks."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {shown.map((task) => {
            const isOpen = task.status === "open" || task.status === "in_progress";
            return (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/crm/tasks/${task.id}`} className={`font-medium hover:underline ${task.status === "completed" ? "text-text-secondary line-through" : ""}`}>{task.title}</Link>
                    <TaskStatusBadge status={task.status} />
                    {task.priority !== "medium" && <TaskPriorityBadge priority={task.priority} />}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
                    <TaskDue task={task} />
                    <span>· {task.assignedName ?? "Unassigned"}</span>
                    {relatedType === "party" && task.relatedType !== "party" && task.relatedName && <span>· {task.relatedName}</span>}
                    {task.completionNote && <span>· {task.completionNote}</span>}
                  </span>
                </div>
                {isOpen && can?.complete && <Button variant="secondary" size="compact" onPress={() => setCompleting(task)}>Complete</Button>}
                {!isOpen && can?.reopen && <Button variant="ghost" size="compact" isLoading={reopen.isPending && reopen.variables?.id === task.id} onPress={() => reopen.mutate(task)}>Reopen</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {options && creating && (
        <TaskFormDialog isOpen onOpenChange={setCreating} options={options} related={{ type: relatedType, id: relatedId, name: relatedName }} onSaved={refresh} />
      )}
      {options && completing && <CompleteTaskDialog isOpen onOpenChange={(isOpen) => !isOpen && setCompleting(null)} task={completing} options={options} onDone={refresh} />}
    </section>
  );
}
