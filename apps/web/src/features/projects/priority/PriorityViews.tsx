"use client";

// Projects — Priority, the read views: open work by priority on the Projects overview, a project team's open work by priority, and the
// priority reports (rendered inside Project Reports).
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LinkButton } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { TileGrid, OverviewPanel } from "@/shared/ui/overview";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MILESTONES_BASE, PRIORITY_LABEL, PROJECTS_BASE, TASKS_BASE, type Priority } from "../api/projects-api";
import { PriorityBadge } from "./Priority";
import { PRIORITIES, getPriorityReport } from "./priority-api";

type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));

// Open work by priority (projects, milestones and tasks, each by its own priority) — where the important work is, at a glance.
export function PrioritySummary() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "priority-distribution"), queryFn: () => getPriorityReport<Row>("distribution") });
  if (!query.data) return null;
  const tasks = query.data.find((row) => row.entity === "TASK");
  return (
    <OverviewPanel title="Open work by priority" action={<LinkButton variant="ghost" size="compact" href={`${PROJECTS_BASE}/reports?report=pr-distribution`}>Priority reports</LinkButton>}>
      <TileGrid tiles={PRIORITIES.map((level) => ({ key: level, label: `${PRIORITY_LABEL[level]} tasks`, value: s(tasks?.[level] ?? 0), href: `${TASKS_BASE}?view=open&priority=${level}` }))} />
      <p className="text-xs text-text-muted">{query.data.filter((row) => row.entity !== "TASK").map((row) =>
        `${s(row.label)}: ${PRIORITIES.filter((level) => Number(row[level])).map((level) => `${s(row[level])} ${PRIORITY_LABEL[level].toLowerCase()}`).join(", ") || "none open"}`).join(" · ")}</p>
    </OverviewPanel>
  );
}

// A project team's open tasks by priority: where the important work sits (a count, not a measure of anyone's capacity).
export function TeamPriorityPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "priority-by-assignee", projectId), queryFn: () => getPriorityReport<Row>("by-assignee", { projectId }) });
  if (!query.data?.length) return null;
  return (
    <Panel title="Open work by priority" description="Open tasks of each person on this project, by priority. Estimates and availability are separate.">
      <LevelTable first="Team member" rows={query.data} label={(row) => s(row.assignee)} withOpen />
    </Panel>
  );
}

function LevelTable({ first, rows, label, withOpen = false }: { first: string; rows: Row[]; label: (row: Row) => React.ReactNode; withOpen?: boolean }) {
  return (
    <LinesTable columns={[first, ...PRIORITIES.map((level) => ({ label: PRIORITY_LABEL[level], numeric: true })), ...(withOpen ? [{ label: "Open", numeric: true }] : [])]}>
      {rows.map((row, index) => (
        <tr key={index}><Cell>{label(row)}</Cell>
          {PRIORITIES.map((level) => <Cell key={level} numeric><span className={level === "URGENT" && Number(row[level]) ? "font-semibold text-danger" : ""}>{s(row[level])}</span></Cell>)}
          {withOpen && <Cell numeric>{s(row.open)}</Cell>}</tr>
      ))}
    </LinesTable>
  );
}

// The priority reports, as a set of Project Reports.
export const PRIORITY_REPORT_TABS = [{ id: "pr-distribution", label: "Work by priority" }, { id: "pr-urgent-open", label: "Urgent open tasks" },
  { id: "pr-high-priority-overdue", label: "High-priority overdue" }, { id: "pr-blocked-urgent", label: "Blocked urgent" }, { id: "pr-by-priority", label: "Tasks by priority" },
  { id: "pr-by-assignee", label: "By assignee" }, { id: "pr-by-project", label: "By project" }, { id: "pr-completed", label: "Completed by priority" }, { id: "pr-changes", label: "Priority changes" }];
const ENTITY_LABEL: Record<string, string> = { PROJECT: "Project", MILESTONE: "Milestone", TASK: "Task" };

// kind: a PRIORITY_REPORT_TABS id. taskRows renders the queue reports (urgent open, high-priority overdue, blocked urgent) as the task reports do.
export function PriorityReport({ kind, rows, taskRows }: { kind: string; rows: Row[]; taskRows: () => React.ReactNode }) {
  switch (kind) {
    case "pr-urgent-open": case "pr-high-priority-overdue": case "pr-blocked-urgent": return <>{taskRows()}</>;
    case "pr-distribution": return <LevelTable first="" rows={rows} label={(row) => s(row.label)} />;
    case "pr-by-priority": return (
      <LinesTable columns={["Priority", { label: "Open", numeric: true }, { label: "Overdue", numeric: true }, { label: "Blocked", numeric: true }, { label: "Done", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.priority)}><Cell><PriorityBadge priority={row.priority as Priority} /></Cell><Cell numeric>{s(row.open)}</Cell><Cell numeric>{s(row.overdue)}</Cell>
          <Cell numeric>{s(row.blocked)}</Cell><Cell numeric>{s(row.done)}</Cell></tr>)}
      </LinesTable>
    );
    case "pr-by-assignee": return <LevelTable first="Assigned to" rows={rows} label={(row) => s(row.assignee)} withOpen />;
    case "pr-by-project": return <LevelTable first="Project" rows={rows} withOpen label={(row) => (
      <Link className="text-brand underline" href={`${PROJECTS_BASE}/${s(row.projectId)}?tab=tasks`}>{s(row.projectName) || s(row.projectCode)}
        <span className="text-text-muted"> {s(row.projectCode)}</span>{row.projectPriority ? <span className="ml-2"><PriorityBadge priority={row.projectPriority as Priority} /></span> : null}</Link>)} />;
    case "pr-completed": return (
      <LinesTable columns={["Priority when done", { label: "Tasks completed", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.priority)}><Cell><PriorityBadge priority={row.priority as Priority} /></Cell><Cell numeric>{s(row.completed)}</Cell></tr>)}
      </LinesTable>
    );
    case "pr-changes": return (
      <LinesTable columns={["When", "Record", "Project", "From", "To", "Why", "Who"]}>
        {rows.map((row, index) => (
          <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell>
            <Cell><Link className="text-brand underline" href={row.entity === "TASK" ? `${TASKS_BASE}/${s(row.entityId)}` : row.entity === "MILESTONE" ? `${MILESTONES_BASE}/${s(row.entityId)}` : `${PROJECTS_BASE}/${s(row.entityId)}`}>
              {s(row.name) || s(row.code)} <span className="text-text-muted">{s(row.code)}</span></Link><span className="block text-xs text-text-muted">{ENTITY_LABEL[s(row.entity)]}</span></Cell>
            <Cell>{s(row.projectCode)}</Cell><Cell>{s(row.fromLabel) || "—"}</Cell><Cell>{s(row.toLabel) || "—"}</Cell><Cell>{s(row.reason) || "—"}</Cell><Cell>{s(row.actor) || "System"}</Cell></tr>
        ))}
      </LinesTable>
    );
    default: return null;
  }
}
