// crm_activities rows where activity_type='call', camelized by
// call-operations.js's dto(). See CALL_FIELDS for the writable subset.
export type Call = {
  id: string;
  companyId: string | null;
  branchId: string | null;
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId: string | null;
  subject: string;
  description: string | null;
  status: "planned" | "overdue" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string | null;
  assignedName?: string | null;
  startAt: string | null;
  dueAt: string | null;
  reminderAt: string | null;
  direction: "inbound" | "outbound" | null;
  phoneNumber: string | null;
  outcomeCode: string | null;
  outcome: string | null;
  callStartedAt: string | null;
  callEndedAt: string | null;
  callDurationSeconds: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CallListFilters = {
  status?: string;
  direction?: "inbound" | "outbound" | "all";
  due?: "all" | "overdue" | "today" | "upcoming";
  search?: string;
  limit?: number;
  offset?: number;
};

export type CallListResponse = { rows: Call[]; total: number; limit: number; offset: number };
