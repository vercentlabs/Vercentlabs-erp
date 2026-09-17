// crm_activities rows where activity_type='follow_up', camelized by
// follow-up-operations.js's dto(). See FOLLOW_UP_FIELDS for the writable
// subset.
export type FollowUp = {
  id: string;
  companyId: string | null;
  branchId: string | null;
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId: string | null;
  subject: string;
  description: string | null;
  status: "planned" | "in_progress" | "overdue" | "completed" | "cancelled";
  assignedTo: string | null;
  assignedName?: string | null;
  dueAt: string | null;
  followUpReason: string | null;
  followUpChannel: "call" | "email" | "meeting" | "whatsapp" | "sms" | "other" | null;
  followUpSnoozeCount?: number;
  followUpEscalatedAt?: string | null;
  escalateAfterMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FollowUpListFilters = {
  status?: string;
  due?: "all" | "overdue" | "today" | "upcoming";
  search?: string;
  limit?: number;
  offset?: number;
};

export type FollowUpListResponse = { rows: FollowUp[]; total: number; limit: number; offset: number };

// tenant.crm_activity_reminders rows for one Follow-up (listRemindersForActivity).
export type FollowUpReminder = {
  id: string;
  activityId: string;
  offsetMinutes: number;
  channel: "in_app" | "email";
  fireAt: string;
  status: "pending" | "dispatching" | "sent" | "failed" | "acknowledged" | "cancelled";
  failureReason: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
};

// tenant.crm_follow_up_events rows (listCrmFollowUpHistory) — covers the
// lifecycle ledger including escalation.
export type FollowUpHistoryEvent = {
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  metadata: Record<string, unknown>;
  actorUserId: string | null;
  occurredAt: string;
};
