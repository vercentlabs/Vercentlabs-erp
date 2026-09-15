// crm_activities rows where activity_type='task', camelized by
// task-operations.js's dto(). See TASK_FIELDS for the writable subset.
export type Task = {
  id: string;
  companyId: string | null;
  branchId: string | null;
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId: string | null;
  subject: string;
  description: string | null;
  status: "planned" | "in_progress" | "overdue" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string | null;
  assignedName?: string | null;
  teamId: string | null;
  teamName?: string | null;
  startAt: string | null;
  dueAt: string | null;
  reminderAt: string | null;
  recurringRule: string | null;
  recurrenceConfig: Record<string, unknown> | null;
  completedAt: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskListFilters = {
  status?: string;
  due?: "all" | "overdue" | "today" | "upcoming";
  mine?: boolean;
  teamId?: string;
  queueOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

export type TaskListResponse = { rows: Task[]; total: number; limit: number; offset: number };
