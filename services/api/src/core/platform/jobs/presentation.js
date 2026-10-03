// Presentation metadata for background job types. The worker's handler
// registry (services/worker/src/registry.js) remains the only EXECUTION
// registry; this only says how a job type is shown and whether the person who
// requested it may see it. verify:shared-runtime checks every worker JOB_TYPE
// has an entry here.
//   userVisible: true  - started by a person (bulk update, export, ...): the requester sees it.
//   userVisible: false - scheduler/system work: only operations viewers see it.
export const JOB_TYPE_PRESENTATION = Object.freeze([
  { jobType: "crm.opportunities.bulk_update", label: "Bulk opportunity update", category: "CRM", userVisible: true },
  { jobType: "crm.opportunities.stage_migration", label: "Opportunity stage migration", category: "CRM", userVisible: true },
  { jobType: "crm.duplicates.full_scan", label: "Duplicate scan", category: "CRM", userVisible: true },
  { jobType: "crm.meetings.calendar_push", label: "Calendar sync for a meeting", category: "CRM", userVisible: true },
  { jobType: "crm.calendar.sync", label: "Calendar account sync", category: "CRM automation", userVisible: false },
  { jobType: "crm.automation.detect_overdue_activities", label: "Overdue activity check", category: "CRM automation", userVisible: false },
  { jobType: "crm.follow_ups.dispatch_reminders", label: "Follow-up reminder delivery", category: "CRM automation", userVisible: false },
  { jobType: "crm.pipeline.capture_daily_snapshot", label: "Daily pipeline snapshot", category: "CRM reporting", userVisible: false },
  { jobType: "crm.forecast.capture_snapshots", label: "Scheduled forecast snapshot", category: "CRM reporting", userVisible: false },
  { jobType: "platform.reports.run", label: "Report export", category: "Reports", userVisible: true },
  { jobType: "sales.automation.detect_expired_quotations", label: "Expired quotation check", category: "Sales automation", userVisible: false },
]);

const BY_TYPE = new Map(JOB_TYPE_PRESENTATION.map((entry) => [entry.jobType, entry]));

export function jobPresentation(jobType) {
  return BY_TYPE.get(String(jobType)) || { jobType: String(jobType), label: "Background task", category: "System", userVisible: false };
}

export const USER_VISIBLE_JOB_TYPES = Object.freeze(JOB_TYPE_PRESENTATION.filter((entry) => entry.userVisible).map((entry) => entry.jobType));
