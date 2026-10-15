"use client";

// The project workspace's Tasks tab: the work that delivers the project — who does what, by when, and where it stands — as a list (grouped by
// milestone or assignee if wanted) or a status board, with the task progress that drives the project's progress, and quick task creation.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton, SearchField, Select } from "@vercentlabs/design-system";

import { useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getProjectTasks, taskExportHref, type Project } from "../api/projects-api";
import { AddTaskDialog, GROUP_OPTIONS, TaskBoard, TaskTable, type GroupBy } from "./TaskViews";

const SHOW = [{ value: "all", label: "All but cancelled" }, { value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "blocked", label: "Blocked" },
  { value: "in_review", label: "In review" }, { value: "completed", label: "Done" }, { value: "cancelled", label: "Cancelled" }, { value: "archived", label: "Archived" }];

export function TasksTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [show, setShow] = useState("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const [adding, setAdding] = useState(false);
  const filters = { view: layout === "board" ? "all" : show, search: term || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project-tasks", project.id, filters), queryFn: () => getProjectTasks(project.id, filters), retry: false,
    placeholderData: (previous) => previous });
  if (query.isLoading) return <LoadingState label="Loading tasks" rows={5} />;
  if (query.isError || !query.data) return <Notice tone="danger">{errorMessage(query.error)}</Notice>;
  const data = query.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        {([["Task completion", data.summary.total ? `${data.summary.done} of ${data.summary.total}` : "—"], ["Progress", data.summary.percent === null ? "No tasks" : `${data.summary.percent}%`],
          ["Open", data.summary.open], ["Overdue", data.summary.overdue], ["Blocked", data.summary.blocked], ["In review", data.summary.inReview]] as const).map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-surface p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold">{value}</p></div>
        ))}
      </div>
      {project.status === "ON_HOLD" && <Notice tone="warning">The project is on hold: tasks can be planned and discussed, but not started or completed until it resumes.</Notice>}
      {["DRAFT", "PLANNED"].includes(project.status) && <Notice tone="neutral">Plan the tasks now; they are started once the project is in progress.</Notice>}
      <Panel title="Tasks" description="Progress is done tasks over all tasks but the cancelled — checklist steps never count as tasks."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Select aria-label="Layout" size="compact" selectedKey={layout} onSelectionChange={(key) => setLayout(key === "board" ? "board" : "list")}
              options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]} />
            {data.can.export && data.total > 0 && <LinkButton size="compact" variant="ghost" href={taskExportHref({ projectId: project.id, view: show })}>Export</LinkButton>}
            {data.can.create && <Button size="compact" variant="primary" onPress={() => setAdding(true)}>Add task</Button>}
          </span>
        }>
        <div className="flex flex-wrap items-end gap-2">
          <SearchField aria-label="Search tasks" placeholder="Task, code or tag" className="w-full sm:w-72" value={search} onChange={setSearch} />
          {layout === "list" && <Select aria-label="Show" size="compact" selectedKey={show} onSelectionChange={(key) => setShow(String(key))} options={SHOW} />}
          {layout === "list" && <Select aria-label="Group" size="compact" selectedKey={groupBy} onSelectionChange={(key) => setGroupBy(String(key) as GroupBy)} options={GROUP_OPTIONS.filter((row) => row.value !== "project")} />}
        </div>
        {data.rows.length === 0 ? <p className="text-sm text-text-muted">{data.can.create && !term && show === "all" ? "No tasks yet. Add the work this project needs — each task with one person responsible and a due date." : "No tasks match."}</p>
          : layout === "list" ? <TaskTable rows={data.rows} groupBy={groupBy} showProject={false} /> : <TaskBoard rows={data.rows} onChanged={refresh} />}
      </Panel>
      {adding && <AddTaskDialog data={data} managerId={project.managerId} managerName={project.manager} onClose={() => setAdding(false)} />}
    </div>
  );
}
