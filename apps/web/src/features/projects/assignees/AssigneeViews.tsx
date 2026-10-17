"use client";

// Projects — Assignees, the read views: a task's assignment history, the team's workload on a project, what a member still owns before they
// leave, and the "Needs an owner" mark on a task whose assignee is inactive or no longer on the team.
import { useQuery } from "@tanstack/react-query";
import { LinkButton, StatusBadge } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getAssignmentHistory, getAssignmentImpact, getTeamWorkload } from "./assignees-api";

export function NeedsOwnerBadge() {
  return <StatusBadge tone="danger">Needs an owner</StatusBadge>;
}

// Who held the task, from whom, by whom, when and why (the creation is the first assignment).
export function AssignmentHistory({ taskId, version }: { taskId: string; version: number }) {
  const workspace = useWorkspaceContext();
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "task-assignments", taskId, version), queryFn: () => getAssignmentHistory(taskId) });
  if (!history.data?.length) return null;
  return (
    <Panel title="Assignment history">
      <HistoryList title={null} entries={history.data.map((row) => ({
        at: row.at, actor: row.by,
        summary: row.action === "CREATED" ? `Assigned to ${row.to ?? "—"} when created` : row.action === "REASSIGNED" ? `${row.from ?? "—"} → ${row.to ?? "—"}` : row.summary ?? "The assignee left the project",
        detail: [row.reason, row.reasonText].filter(Boolean).join(": ") || undefined,
      }))} />
    </Panel>
  );
}

// The team's open work on the project: counts and recorded estimates (with how many tasks have none), and anyone still holding tasks
// they can no longer do. A guide for spreading work, not a measure of anyone's capacity.
export function TeamWorkloadPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "team-workload", projectId), queryFn: () => getTeamWorkload(projectId) });
  const data = query.data;
  if (!data) return null;
  const hours = (minutes: number, tasks: number) => (tasks ? `${Math.round((minutes / 60) * 10) / 10} h (${tasks} with an estimate)` : "No estimates");
  return (
    <Panel title="Workload" description={data.note}>
      <LinesTable columns={["Team member", { label: "Open", numeric: true }, { label: "In progress", numeric: true }, { label: "Overdue", numeric: true }, { label: "Due this week", numeric: true },
        { label: "High priority", numeric: true }, "Estimated", { label: "Open in all projects", numeric: true }, ""]}>
        {data.members.map((row) => (
          <tr key={row.userId}>
            <Cell><span className="flex flex-col"><span>{row.name}</span><span className="text-xs text-text-muted">{row.roleLabel}</span></span></Cell>
            <Cell numeric>{row.open}</Cell><Cell numeric>{row.inProgress}</Cell><Cell numeric>{row.overdue}</Cell><Cell numeric>{row.dueThisWeek}</Cell><Cell numeric>{row.highPriority}</Cell>
            <Cell>{hours(row.estimateMinutes, row.estimatedTasks)}</Cell><Cell numeric>{row.overallOpen}</Cell>
            <Cell>{row.open > 0 && <LinkButton variant="ghost" size="compact" href={`/projects/tasks?view=open&assigneeId=${row.userId}`}>Open assignments</LinkButton>}</Cell>
          </tr>
        ))}
      </LinesTable>
      {data.unestimatedOpenTasks > 0 && <p className="text-xs text-text-muted">{`${data.unestimatedOpenTasks} open task(s) have no estimate; they are not counted as zero hours.`}</p>}
      {data.needsOwner.length > 0 && (
        <Notice tone="warning">
          <span className="flex flex-col gap-1">
            <span>{`Tasks that need a new owner: ${data.needsOwner.map((row) => `${row.name} (${row.open})`).join(", ")} — inactive or no longer on the team.`}</span>
            <LinkButton variant="ghost" size="compact" href="/projects/tasks?view=unassigned">Open the needs-an-owner queue</LinkButton>
          </span>
        </Notice>
      )}
    </Panel>
  );
}

// Before a member leaves: the reviews, blockers and milestones they own besides their open tasks (which the leave dialog reassigns).
export function MemberLeaveImpact({ projectId, memberId }: { projectId: string; memberId: string }) {
  const workspace = useWorkspaceContext();
  const impact = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "assignment-impact", projectId, memberId), queryFn: () => getAssignmentImpact(projectId, memberId) });
  const data = impact.data;
  return (
    <>
      {data && (data.reviews.length > 0 || data.blockers.length > 0 || data.milestones.length > 0) && (
        <Notice tone="neutral">
          <span className="flex flex-col gap-1 text-sm">
            {data.reviews.length > 0 && <span>{`Reviews ${data.reviews.map((row) => row.code).join(", ")}: these go to the Project Manager.`}</span>}
            {data.blockers.length > 0 && <span>{`Owns ${data.blockers.length} active blocker(s): they move with the tasks when reassigned.`}</span>}
            {data.milestones.length > 0 && <span>{`Owns milestone(s) ${data.milestones.map((row) => row.code).join(", ")}: give them a new owner on the milestone page.`}</span>}
          </span>
        </Notice>
      )}
      <p className="text-xs text-text-muted">{data?.note ?? "Time entries and expenses recorded by this person stay theirs."}</p>
    </>
  );
}
