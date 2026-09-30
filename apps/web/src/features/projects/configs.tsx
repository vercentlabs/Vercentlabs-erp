"use client";

import { act } from "@/features/projects/shared/client";
import type { FieldDef } from "@/features/projects/shared/FieldInput";
import type {
  RegisterConfig,
  RowAction,
} from "@/features/projects/shared/Register";
import {
  badge,
  calendarDate,
  col,
  opts,
  quantity,
  strong,
  text,
} from "@/features/projects/shared/helpers";

const PRIORITY = opts("low", "normal", "high", "urgent");

// ------------------------------------------------------------------ F193-F196: projects
const projects: RegisterConfig = {
  key: "projects",
  title: "Projects",
  description:
    "Customer and internal projects. A project is planned, approved by someone other than its creator, then started; completing it checks that tasks are finished and time is approved.",
  searchLabel: "Search projects",
  emptyTitle: "No projects yet",
  emptyDescription: "Create a project to start planning its work.",
  source: { kind: "view", view: "projects" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "draft",
        "planned",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ),
    },
    {
      name: "projectType",
      label: "Type",
      options: opts("customer", "internal"),
    },
    {
      name: "health",
      label: "Health",
      options: opts("on_track", "at_risk", "off_track"),
    },
  ],
  createLabel: "New project",
  createPermission: "projects.create",
  save: { action: "project-create", success: "Project created as a draft." },
  edit: {
    action: "project-update",
    permission: "projects.manage",
    show: (r) => !["completed", "cancelled"].includes(String(r.status)),
  },
  fields: [
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "projectType",
      label: "Type",
      kind: "select",
      options: opts("customer", "internal"),
      defaultValue: "customer",
      createOnly: true,
    },
    {
      name: "customerId",
      label: "Customer",
      kind: "select",
      options: "customers",
      rowKey: "customer_id",
    },
    {
      name: "plannedStartDate",
      label: "Planned start",
      kind: "date",
      rowKey: "planned_start_date",
    },
    {
      name: "plannedEndDate",
      label: "Planned end",
      kind: "date",
      rowKey: "planned_end_date",
    },
    {
      name: "projectManagerId",
      label: "Project manager",
      kind: "select",
      options: "users",
      rowKey: "project_manager_id",
    },
    {
      name: "priority",
      label: "Priority",
      kind: "select",
      options: PRIORITY,
      defaultValue: "normal",
    },
    { name: "category", label: "Category", kind: "text" },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  summary: (rows) => [
    { label: "Projects shown", value: String(rows.length) },
    {
      label: "Open tasks",
      value: String(rows.reduce((s, r) => s + Number(r.open_tasks || 0), 0)),
    },
  ],
  columns: () => [
    strong("number", "Project", (r) => String(r.project_number)),
    col("name", "Name", (r) => String(r.name)),
    badge("type", "Type", (r) => r.project_type),
    col("customer", "Customer", (r) => String(r.customer_name ?? "")),
    col("manager", "Manager", (r) => String(r.manager_name ?? "")),
    col("progress", "Progress", (r) => `${quantity(r.percent_complete)}%`),
    col("end", "Planned end", (r) => calendarDate(r.planned_end_date)),
    badge("health", "Health", (r) => r.health),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, ["project_number", "name", "customer_name", "manager_name"]),
  rowActions: [
    {
      label: "Plan",
      permission: "projects.manage",
      show: (r) => r.status === "draft",
      run: (r) => act("project-status", { id: r.id, transition: "plan" }),
      success: "Planned.",
    },
    {
      label: "Approve",
      permission: "projects.approve",
      show: (r) => r.status === "planned" && !r.approved_by,
      run: (r) => act("project-approve", { id: r.id }),
      success: "Approved.",
    },
    {
      label: "Start",
      permission: "projects.manage",
      show: (r) => r.status === "planned" && Boolean(r.approved_by),
      run: (r) => act("project-status", { id: r.id, transition: "activate" }),
      success: "The project is active.",
    },
    {
      label: "Hold",
      permission: "projects.manage",
      show: (r) => r.status === "active",
      note: { label: "Reason", required: true },
      run: (r, note) =>
        act("project-status", { id: r.id, transition: "hold", reason: note }),
      success: "On hold.",
    },
    {
      label: "Resume",
      permission: "projects.manage",
      show: (r) => r.status === "on_hold",
      run: (r) => act("project-status", { id: r.id, transition: "resume" }),
      success: "Resumed.",
    },
    {
      label: "Complete",
      permission: "projects.approve",
      show: (r) => r.status === "active",
      note: { label: "Closing note" },
      run: (r, note) =>
        act("project-status", {
          id: r.id,
          transition: "complete",
          reason: note,
        }),
      success: "Completed.",
    },
    {
      label: "Cancel",
      permission: "projects.approve",
      show: (r) => ["draft", "planned", "on_hold"].includes(String(r.status)),
      note: { label: "Reason", required: true },
      run: (r, note) =>
        act("project-status", { id: r.id, transition: "cancel", reason: note }),
      success: "Cancelled.",
    },
    {
      label: "Reopen",
      permission: "projects.approve",
      show: (r) => ["completed", "cancelled"].includes(String(r.status)),
      note: { label: "Reason", required: true },
      run: (r, note) =>
        act("project-status", { id: r.id, transition: "reopen", reason: note }),
      success: "Reopened and active.",
    },
  ],
};

// ------------------------------------------------------------------ F199-F203: tasks and milestones
const taskActions: RowAction[] = [
  {
    label: "Start",
    permission: "projects.view",
    show: (r) =>
      ["todo", "blocked"].includes(String(r.status)) && !r.child_count,
    run: (r) => act("task-status", { id: r.id, status: "in_progress" }),
    success: "In progress.",
  },
  {
    label: "Block",
    permission: "projects.view",
    show: (r) => r.status === "in_progress" && !r.child_count,
    note: { label: "Why is it blocked?", required: true },
    run: (r, note) =>
      act("task-status", { id: r.id, status: "blocked", reason: note }),
    success: "Blocked.",
  },
  {
    label: "Review",
    permission: "projects.view",
    show: (r) => r.status === "in_progress" && !r.child_count,
    run: (r) => act("task-status", { id: r.id, status: "review" }),
    success: "In review.",
  },
  {
    label: "Done",
    permission: "projects.view",
    show: (r) =>
      ["todo", "in_progress", "review"].includes(String(r.status)) &&
      !r.child_count,
    run: (r) => act("task-status", { id: r.id, status: "done" }),
    success: "Done.",
  },
  {
    label: "Reopen",
    permission: "projects.view",
    show: (r) => r.status === "done",
    run: (r) => act("task-status", { id: r.id, status: "in_progress" }),
    success: "Reopened.",
  },
  {
    label: "Progress",
    permission: "projects.view",
    show: (r) =>
      !["done", "cancelled"].includes(String(r.status)) && !r.child_count,
    fields: [
      {
        name: "percent",
        label: "Percent complete",
        kind: "number",
        step: 5,
        min: 0,
        required: true,
      },
    ],
    run: (r, _n, v) => act("task-progress", { id: r.id, percent: v.percent }),
    success: "Progress recorded.",
  },
  {
    label: "Add predecessor",
    permission: "projects.tasks.manage",
    show: (r) => r.status !== "cancelled",
    fields: [
      {
        name: "predecessorTaskId",
        label: "Must finish first",
        kind: "select",
        options: "tasks",
        required: true,
      },
      {
        name: "lagDays",
        label: "Lag (days)",
        kind: "number",
        step: 1,
        min: -30,
      },
    ],
    run: (r, _n, v) => act("dependency-add", { successorTaskId: r.id, ...v }),
    success: "Dependency added. A loop would have been refused.",
  },
  {
    label: "Cancel",
    permission: "projects.tasks.manage",
    show: (r) =>
      !["done", "cancelled"].includes(String(r.status)) && !r.child_count,
    run: (r) => act("task-status", { id: r.id, status: "cancelled" }),
    success: "Cancelled.",
  },
];

const tasks: RegisterConfig = {
  key: "tasks",
  title: "Tasks",
  description:
    "Every task and sub-task with its WBS code. Assignees move their own tasks; a task cannot start before its predecessors finish or finish before its sub-tasks.",
  searchLabel: "Search tasks",
  emptyTitle: "No tasks",
  emptyDescription: "Add a task to a project.",
  source: { kind: "view", view: "tasks" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "todo",
        "in_progress",
        "blocked",
        "review",
        "done",
        "cancelled",
      ),
    },
  ],
  createLabel: "New task",
  createPermission: "projects.tasks.manage",
  save: { action: "task-create", success: "Task created." },
  edit: { action: "task-update", permission: "projects.tasks.manage" },
  fields: [
    {
      name: "projectId",
      label: "Project",
      kind: "select",
      required: true,
      options: "projects",
      createOnly: true,
    },
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "parentTaskId",
      label: "Sub-task of",
      kind: "select",
      options: "tasks",
      rowKey: "parent_task_id",
    },
    {
      name: "assigneeUserId",
      label: "Assignee",
      kind: "select",
      options: "users",
      rowKey: "assignee_user_id",
    },
    {
      name: "priority",
      label: "Priority",
      kind: "select",
      options: PRIORITY,
      defaultValue: "normal",
    },
    {
      name: "plannedStartDate",
      label: "Start",
      kind: "date",
      rowKey: "planned_start_date",
    },
    {
      name: "durationDays",
      label: "Duration (working days)",
      kind: "number",
      step: 1,
      min: 0,
      rowKey: "duration_days",
    },
    {
      name: "plannedEndDate",
      label: "End",
      kind: "date",
      rowKey: "planned_end_date",
    },
    {
      name: "estimatedHours",
      label: "Estimated hours",
      kind: "number",
      step: 0.5,
      rowKey: "estimated_hours",
    },
    {
      name: "billable",
      label: "Billable",
      kind: "bool",
      defaultValue: "false",
    },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  columns: () => [
    strong("number", "Task", (r) =>
      `${r.wbs_code ?? ""} ${r.task_number}`.trim(),
    ),
    col("name", "Name", (r) => String(r.name)),
    col("project", "Project", (r) => String(r.project_number ?? "")),
    col("assignee", "Assignee", (r) => String(r.assignee_name ?? "")),
    col("end", "Due", (r) => calendarDate(r.planned_end_date)),
    col("progress", "Progress", (r) => `${quantity(r.percent_complete)}%`),
    col(
      "hours",
      "Hours (actual / est.)",
      (r) => `${quantity(r.actual_hours)} / ${quantity(r.estimated_hours)}`,
    ),
    badge("priority", "Priority", (r) => r.priority),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, [
      "task_number",
      "wbs_code",
      "name",
      "project_number",
      "assignee_name",
    ]),
  rowActions: taskActions,
};

const milestones: RegisterConfig = {
  key: "milestones",
  title: "Milestones",
  description:
    "Key dates. A milestone completes only when its tasks are finished.",
  searchLabel: "Search milestones",
  emptyTitle: "No milestones",
  emptyDescription: "Add a milestone to a project.",
  source: { kind: "view", view: "milestones" },
  createLabel: "New milestone",
  createPermission: "projects.milestones.manage",
  save: { action: "milestone-save", success: "Milestone saved." },
  edit: {
    action: "milestone-save",
    permission: "projects.milestones.manage",
    show: (r) => !["completed", "cancelled"].includes(String(r.status)),
  },
  fields: [
    {
      name: "projectId",
      label: "Project",
      kind: "select",
      required: true,
      options: "projects",
      createOnly: true,
    },
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "plannedDate",
      label: "Planned date",
      kind: "date",
      rowKey: "planned_date",
    },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  columns: () => [
    strong("seq", "Milestone", (r) => `${r.project_number} #${r.sequence}`),
    col("name", "Name", (r) => String(r.name)),
    col("date", "Planned", (r) => calendarDate(r.planned_date)),
    col("done", "Completed", (r) => calendarDate(r.completed_date)),
    col("open", "Open tasks", (r) => `${r.open_tasks} of ${r.task_count}`),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["project_number", "name"]),
  rowActions: [
    {
      label: "Complete",
      permission: "projects.milestones.manage",
      show: (r) => ["planned", "in_progress"].includes(String(r.status)),
      run: (r) => act("milestone-status", { id: r.id, transition: "complete" }),
      success: "Completed.",
    },
    {
      label: "Reopen",
      permission: "projects.milestones.manage",
      show: (r) => r.status === "completed",
      run: (r) => act("milestone-status", { id: r.id, transition: "reopen" }),
      success: "Reopened.",
    },
    {
      label: "Cancel",
      permission: "projects.milestones.manage",
      show: (r) => ["planned", "in_progress"].includes(String(r.status)),
      note: { label: "Reason", required: true },
      run: (r, note) =>
        act("milestone-status", {
          id: r.id,
          transition: "cancel",
          reason: note,
        }),
      success: "Cancelled. Its tasks are released.",
    },
  ],
};

// ------------------------------------------------------------------ F208: allocation
const allocation: RegisterConfig = {
  key: "team",
  title: "Project team",
  description:
    "Who is on which project, at what share of their time. Allocating someone past 100% across projects in the same period is refused unless you confirm it.",
  searchLabel: "Search the team",
  emptyTitle: "No allocations",
  emptyDescription: "Add people to a project.",
  source: { kind: "view", view: "teams" },
  createLabel: "Allocate someone",
  createPermission: "projects.resources.manage",
  save: { action: "member-save", success: "Allocation saved." },
  edit: { action: "member-save", permission: "projects.resources.manage" },
  fields: [
    {
      name: "projectId",
      label: "Project",
      kind: "select",
      required: true,
      options: "projects",
      createOnly: true,
      rowKey: "project_id",
    },
    {
      name: "userId",
      label: "Person",
      kind: "select",
      required: true,
      options: "users",
      createOnly: true,
      rowKey: "user_id",
    },
    {
      name: "roleName",
      label: "Role",
      kind: "text",
      defaultValue: "Team member",
      rowKey: "role_name",
    },
    {
      name: "allocationPercent",
      label: "Allocation %",
      kind: "number",
      step: 5,
      min: 1,
      defaultValue: 100,
      rowKey: "allocation_percent",
    },
    { name: "startDate", label: "From", kind: "date", rowKey: "start_date" },
    { name: "endDate", label: "To", kind: "date", rowKey: "end_date" },
    {
      name: "allowOverAllocation",
      label: "Confirm over-allocation",
      kind: "bool",
      defaultValue: "false",
    },
  ],
  columns: () => [
    strong("project", "Project", (r) => String(r.project_number)),
    col("person", "Person", (r) => String(r.full_name ?? "")),
    col("role", "Role", (r) => String(r.role_name)),
    col("alloc", "Allocation", (r) => `${quantity(r.allocation_percent)}%`),
    col("from", "From", (r) => calendarDate(r.start_date)),
    col("to", "To", (r) => calendarDate(r.end_date)),
    badge("status", "Status", (r) => (r.active ? "active" : "cancelled")),
  ],
  searchText: (r) => text(r, ["project_number", "full_name", "role_name"]),
  rowActions: [
    {
      label: "Remove",
      permission: "projects.resources.manage",
      show: (r) => Boolean(r.active),
      run: (r) =>
        act("member-remove", { projectId: r.project_id, userId: r.user_id }),
      success: "Removed from the project.",
    },
  ],
};

// ------------------------------------------------------------------ F209/F210: time and timesheets
const time: RegisterConfig = {
  key: "time",
  title: "Time entries",
  description:
    "Log hours against a leaf task on an active project. Rates are captured from the team member at the time of entry; submitting a week sends its draft time for approval.",
  searchLabel: "Search time",
  emptyTitle: "No time logged",
  emptyDescription: "Log time against a project you are on.",
  source: { kind: "view", view: "time-entries" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts("draft", "submitted", "approved", "rejected"),
    },
  ],
  createLabel: "Log time",
  createPermission: "projects.time.enter",
  save: {
    action: "time-log",
    success: "Time logged as a draft. Submit the week for approval.",
  },
  edit: {
    action: "time-update",
    permission: "projects.time.enter",
    show: (r) => ["draft", "rejected"].includes(String(r.status)),
  },
  fields: [
    {
      name: "projectId",
      label: "Project",
      kind: "select",
      required: true,
      options: "projects",
      createOnly: true,
    },
    {
      name: "taskId",
      label: "Task",
      kind: "select",
      options: "tasks",
      rowKey: "task_id",
    },
    {
      name: "workDate",
      label: "Date",
      kind: "date",
      required: true,
      rowKey: "work_date",
    },
    {
      name: "hours",
      label: "Hours",
      kind: "number",
      step: 0.25,
      min: 0.25,
      required: true,
    },
    {
      name: "billable",
      label: "Billable",
      kind: "bool",
      defaultValue: "false",
    },
    {
      name: "description",
      label: "What was done",
      kind: "textarea",
      wide: true,
    },
  ],
  summary: (rows) => [
    {
      label: "Hours shown",
      value: quantity(rows.reduce((s, r) => s + Number(r.hours || 0), 0)),
    },
  ],
  columns: () => [
    strong("date", "Date", (r) => calendarDate(r.work_date)),
    col("project", "Project", (r) => String(r.project_number)),
    col("task", "Task", (r) => String(r.task_number ?? "")),
    col("who", "Person", (r) => String(r.user_name ?? "")),
    col("hours", "Hours", (r) => quantity(r.hours)),
    col("billable", "Billable", (r) => (r.billable ? "Yes" : "No")),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, ["project_number", "task_number", "user_name", "description"]),
  rowActions: [
    {
      label: "Submit week",
      permission: "projects.time.enter",
      show: (r) => ["draft", "rejected"].includes(String(r.status)),
      run: (r) =>
        act("timesheet-submit", {
          weekStart: String(r.work_date).slice(0, 10),
        }),
      success: "Week submitted.",
    },
    {
      label: "Delete",
      permission: "projects.time.enter",
      show: (r) => r.status === "draft",
      run: (r) => act("time-delete", { id: r.id }),
      success: "Deleted.",
    },
    {
      label: "Reopen approved time",
      permission: "projects.approve",
      show: (r) => r.status === "approved" && !r.billed_billing_id,
      note: { label: "Reason", required: true },
      run: (r, note) => act("time-reopen", { id: r.id, reason: note }),
      success: "Reopened for correction.",
    },
  ],
};

const timesheets: RegisterConfig = {
  key: "timesheets",
  title: "Timesheets",
  description:
    "One per person per week. An approver other than the person who logged the time approves or rejects the week.",
  searchLabel: "Search timesheets",
  emptyTitle: "No timesheets",
  emptyDescription: "Timesheets appear once time is logged.",
  source: { kind: "view", view: "timesheets" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts("draft", "submitted", "approved", "rejected"),
    },
  ],
  columns: () => [
    strong("week", "Week of", (r) => calendarDate(r.week_start)),
    col("who", "Person", (r) => String(r.user_name ?? "")),
    col("entries", "Entries", (r) => quantity(r.entry_count)),
    col("hours", "Hours", (r) => quantity(r.total_hours)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["user_name", "status"]),
  rowActions: [
    {
      label: "Recall",
      permission: "projects.time.enter",
      show: (r) => r.status === "submitted",
      run: (r) =>
        act("timesheet-recall", {
          weekStart: String(r.week_start).slice(0, 10),
        }),
      success: "Recalled to draft.",
    },
    {
      label: "Approve",
      permission: "projects.time.approve",
      show: (r) => r.status === "submitted",
      run: (r) => act("timesheet-approve", { id: r.id }),
      success: "Approved.",
    },
    {
      label: "Reject",
      permission: "projects.time.approve",
      show: (r) => r.status === "submitted",
      note: { label: "Reason", required: true },
      run: (r, note) => act("timesheet-reject", { id: r.id, reason: note }),
      success: "Rejected.",
    },
  ],
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  all: projects,
  tasks,
  milestones,
  team: allocation,
  time,
  timesheets,
};

void (null as unknown as FieldDef);
