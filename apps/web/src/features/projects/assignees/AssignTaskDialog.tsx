"use client";

// Assign or reassign one task: the project's eligible people (searchable), each with the work they already carry here, the current assignee
// marked, a warning when someone has overdue work, and the reason a reassignment needs. Used from the task page, the board, the project's
// task list and a milestone's tasks — always the same server command. Open-task counts help spread work; they do not prove availability.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, SearchField, Select, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { TASK_TONE, errorMessage, getTask, minutesLabel, newKey, taskAction } from "../api/projects-api";
import { ASSIGNMENT_REASON_LABEL, getEligibleAssignees } from "./assignees-api";

export function AssignTaskDialog({ taskId, projectId, onClose, onDone }: { taskId: string; projectId: string; onClose: () => void; onDone: (text: string) => void | Promise<void> }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const task = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "task", taskId), queryFn: () => getTask(taskId) });
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const people = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "eligible-assignees", projectId, term), queryFn: () => getEligibleAssignees(projectId, term) });
  const [chosen, setChosen] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("WORKLOAD_BALANCING");
  const [reasonText, setReasonText] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = task.data;
  const pick = (people.data ?? []).find((row) => row.userId === chosen);
  const ready = Boolean(current && chosen && chosen !== current.assigneeId && (reasonCode !== "OTHER" || reasonText.trim().length >= 3)) && !busy;
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={current ? `Assign ${current.code}` : "Assign task"} size="lg">
      {!current ? <LoadingState label="Loading the task" rows={3} /> : (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{current.title}</span><StatusBadge tone={TASK_TONE[current.status]}>{current.statusLabel}</StatusBadge></p>
          <p className="text-sm text-text-secondary">{`Currently assigned to ${current.assignee ?? "nobody"}${current.reviewer ? ` · reviewed by ${current.reviewer}` : ""}.`}</p>
          <SearchField aria-label="Search the project team" placeholder="Search the project team" value={search} onChange={setSearch} />
          {people.isLoading ? <LoadingState label="Loading the team" rows={3} /> : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Project team members">
              {(people.data ?? []).map((row) => {
                const isCurrent = row.userId === current.assigneeId;
                const selected = row.userId === chosen;
                return (
                  <li key={row.userId}>
                    <button type="button" role="option" aria-selected={selected} disabled={isCurrent}
                      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ${selected ? "border-brand bg-brand-soft" : "border-border"} disabled:opacity-60`}
                      onClick={() => setChosen(row.userId)}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">{row.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                        <span className="flex flex-col"><span className="font-medium">{row.name}{isCurrent ? " (current)" : ""}</span><span className="text-xs text-text-muted">{row.roleLabel}</span></span>
                      </span>
                      <span className="flex flex-col items-end text-xs text-text-secondary">
                        <span>{`${row.project.open} open here · ${row.overall.open} in all`}</span>
                        <span className={row.project.overdue ? "text-danger" : ""}>{`${row.project.overdue} overdue${row.project.estimatedTasks ? ` · ${minutesLabel(row.project.estimateMinutes)} estimated` : ""}`}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {!(people.data ?? []).length && <li className="text-sm text-text-muted">Nobody on the team matches. Add the person to the Project Team first.</li>}
            </ul>
          )}
          {pick && pick.overall.overdue > 0 && <Notice tone="warning">{`${pick.name} has ${pick.overall.overdue} overdue task(s). Open counts are not availability; check with them if unsure.`}</Notice>}
          {current.status === "IN_REVIEW" && <Notice tone="neutral">The task is in review: its submission and reviewer stay as they are.</Notice>}
          <Select label="Why it is reassigned" selectedKey={reasonCode} onSelectionChange={(next) => setReasonCode(String(next))}
            options={Object.entries(ASSIGNMENT_REASON_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextArea label={reasonCode === "OTHER" ? "Explain why" : "Note (optional)"} value={reasonText} onChange={setReasonText} maxLength={500} isRequired={reasonCode === "OTHER"} />
          <p className="text-xs text-text-muted">The task&apos;s status, checklist, comments, files and due date stay as they are; time already recorded stays with whoever worked it.</p>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>Cancel</Button>
            <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={async () => {
              setBusy(true); setError(null);
              try {
                await taskAction(current.id, "assign", { assigneeUserId: chosen, reasonCode, reasonText: reasonText.trim() || undefined, expectedVersion: current.version, idempotencyKey: key });
                await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
                await onDone(`Assigned to ${pick?.name ?? "the new assignee"}: they were told.`);
                onClose();
              } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
            }}>Assign</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
