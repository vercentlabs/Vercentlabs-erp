// The fixed vocabulary of CRM tasks.

// The status a person sees. Stored values: planned (open), in_progress,
// completed, cancelled. Overdue, due today and upcoming are calculated from
// the due date and never stored.
export const TASK_STATUSES = Object.freeze([
  { code: "open", label: "Open" },
  { code: "in_progress", label: "In Progress" },
  { code: "completed", label: "Completed" },
  { code: "cancelled", label: "Cancelled" },
]);
export const STORED_STATUS = Object.freeze({ open: "planned", in_progress: "in_progress", completed: "completed", cancelled: "cancelled" });
// The stored values that mean "still to do". 'overdue' is a value older rows may still carry.
export const OPEN_STORED_STATUSES = Object.freeze(["planned", "in_progress", "overdue"]);

export const TASK_PRIORITIES = Object.freeze([
  { code: "low", label: "Low" },
  { code: "medium", label: "Medium" },
  { code: "high", label: "High" },
]);

// What a task can be about. A task with no related record is a personal one.
export const TASK_RELATED_TYPES = Object.freeze([
  { code: "lead", label: "Lead" },
  { code: "party", label: "Account" },
  { code: "contact", label: "Contact" },
  { code: "opportunity", label: "Opportunity" },
]);

// The reminders offered; a custom date and time is also accepted.
export const TASK_REMINDER_OPTIONS = Object.freeze([
  { minutes: 0, label: "At the due time" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
]);

export const TASK_VIEWS = Object.freeze([
  { key: "mine", label: "My Tasks" },
  { key: "due_today", label: "Due Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "high_priority", label: "High Priority" },
  { key: "completed", label: "Completed" },
  { key: "created_by_me", label: "Tasks I Created" },
  { key: "team", label: "Team Tasks" },
  { key: "all", label: "All Tasks" },
  { key: "cancelled", label: "Cancelled" },
]);

export const TASK_PERMISSIONS = Object.freeze({
  view: "crm.tasks.view",
  viewTeam: "crm.tasks.view_team",
  viewAll: "crm.tasks.view_all",
  create: "crm.tasks.create",
  edit: "crm.tasks.edit",
  complete: "crm.tasks.complete",
  reopen: "crm.tasks.reopen",
  cancel: "crm.tasks.cancel",
  delete: "crm.tasks.delete",
  assign: "crm.tasks.assign",
  reassign: "crm.tasks.reassign",
  export: "crm.export",
});

export const TASK_NUMBER_DOCUMENT_TYPE = "crm_task";
