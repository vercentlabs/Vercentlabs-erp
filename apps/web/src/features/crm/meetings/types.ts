// crm_activities rows where activity_type='meeting', camelized by
// meeting-operations.js's dto(). See MEETING_FIELDS for the writable subset.
export type MeetingAttendee = { contactId?: string | null; name: string; email: string; responseStatus?: "needs_action" | "accepted" | "declined" | "tentative" };

export type Meeting = {
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
  endAt: string | null;
  locationType: "in_person" | "online" | "phone" | "other" | null;
  location: string | null;
  meetingUrl: string | null;
  attendees?: MeetingAttendee[];
  attendeeCount?: number;
  outcomeCode: string | null;
  outcome: string | null;
  completedAt: string | null;
  bookingId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MeetingListFilters = {
  status?: string;
  due?: "all" | "overdue" | "today" | "upcoming";
  search?: string;
  limit?: number;
  offset?: number;
};

export type MeetingListResponse = { rows: Meeting[]; total: number; limit: number; offset: number };
