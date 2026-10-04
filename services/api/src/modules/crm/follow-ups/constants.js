// The fixed vocabulary of CRM follow-ups.

// What a person sees. Stored values: planned (scheduled), completed,
// cancelled. Overdue, due today and upcoming are calculated from the
// scheduled time and never stored.
export const FOLLOW_UP_STATUSES = Object.freeze([
  { code: "scheduled", label: "Scheduled" },
  { code: "completed", label: "Completed" },
  { code: "cancelled", label: "Cancelled" },
]);
// The stored values that mean "still to do". 'in_progress' and 'overdue' are values older rows may carry.
export const OPEN_STORED_STATUSES = Object.freeze(["planned", "in_progress", "overdue"]);

export const FOLLOW_UP_TYPES = Object.freeze([
  { code: "call", label: "Call" },
  { code: "email", label: "Email" },
  { code: "meeting", label: "Meeting" },
  { code: "demo", label: "Demo" },
  { code: "other", label: "Other" },
]);
// The older channel column keeps a value the activity table already accepts.
export const CHANNEL_OF_TYPE = Object.freeze({ call: "call", email: "email", meeting: "meeting", demo: "meeting", other: "other" });
// The activity a completed follow-up records on the timeline; Other records none.
export const ACTIVITY_OF_TYPE = Object.freeze({ call: "call", email: "email", meeting: "meeting", demo: "meeting" });

export const FOLLOW_UP_OUTCOMES = Object.freeze([
  { code: "connected", label: "Connected" },
  { code: "no_response", label: "No Response" },
  { code: "interested", label: "Interested" },
  { code: "not_interested", label: "Not Interested" },
  { code: "meeting_scheduled", label: "Meeting Scheduled" },
  { code: "other", label: "Other" },
]);

export const FOLLOW_UP_RELATED_TYPES = Object.freeze([
  { code: "lead", label: "Lead" },
  { code: "party", label: "Account" },
  { code: "contact", label: "Contact" },
  { code: "opportunity", label: "Opportunity" },
]);

export const FOLLOW_UP_REMINDER_OPTIONS = Object.freeze([
  { minutes: 0, label: "At the time of the follow-up" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
]);

export const FOLLOW_UP_VIEWS = Object.freeze([
  { key: "due_today", label: "Due Today" },
  { key: "mine", label: "My Follow-ups" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "created_by_me", label: "Created by Me" },
  { key: "team", label: "Team Follow-ups" },
  { key: "all", label: "All Follow-ups" },
  { key: "cancelled", label: "Cancelled" },
]);

export const FOLLOW_UP_PERMISSIONS = Object.freeze({
  view: "crm.follow_ups.view",
  viewTeam: "crm.follow_ups.view_team",
  viewAll: "crm.follow_ups.view_all",
  create: "crm.follow_ups.create",
  edit: "crm.follow_ups.edit",
  complete: "crm.follow_ups.complete",
  reschedule: "crm.follow_ups.reschedule",
  cancel: "crm.follow_ups.cancel",
  reassign: "crm.follow_ups.reassign",
  delete: "crm.follow_ups.delete",
  export: "crm.export",
});

export const FOLLOW_UP_NUMBER_DOCUMENT_TYPE = "crm_follow_up";
