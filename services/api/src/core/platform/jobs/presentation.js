// Presentation metadata for background job types. The worker's handler
// registry (services/worker/src/registry.js) remains the only EXECUTION
// registry; this only says how a job type is shown and whether the person who
// requested it may see it. verify:shared-runtime checks every worker JOB_TYPE
// has an entry here.
//   userVisible: true  - started by a person (bulk update, export, ...): the requester sees it.
//   userVisible: false - scheduler/system work: only operations viewers see it.
export const JOB_TYPE_PRESENTATION = Object.freeze([
  { jobType: "crm.duplicates.full_scan", label: "Duplicate scan", category: "CRM", userVisible: true },
  { jobType: "crm.follow_ups.dispatch_reminders", label: "Follow-up reminder delivery", category: "CRM automation", userVisible: false },
  { jobType: "platform.reports.run", label: "Report export", category: "Reports", userVisible: true },
  { jobType: "stock.reorder.reconcile", label: "Reorder level check", category: "Inventory automation", userVisible: false },
  { jobType: "crm.tasks.notify_overdue", label: "Overdue task alerts", category: "CRM automation", userVisible: false },
  { jobType: "stock.low_stock.dispatch_notifications", label: "Low stock alerts", category: "Inventory automation", userVisible: false },
  { jobType: "manufacturing.production_hold.notify_overdue", label: "Overdue production hold alerts", category: "Manufacturing automation", userVisible: false },
  { jobType: "projects.alerts.notify", label: "Project due-date alerts", category: "Projects automation", userVisible: false },
  { jobType: "sales.automation.detect_expired_quotations", label: "Expired quotation check", category: "Sales automation", userVisible: false },
  { jobType: "sales.automation.payment_reminders", label: "Payment reminders", category: "Sales automation", userVisible: false },
  { jobType: "sales.automation.recurring", label: "Recurring orders and invoices", category: "Sales automation", userVisible: false },
  { jobType: "platform.workspace.export", label: "Full workspace export", category: "Your data", userVisible: true },
  { jobType: "platform.record_activities.remind", label: "Activity reminders", category: "Comments and activities", userVisible: false },
]);

const BY_TYPE = new Map(JOB_TYPE_PRESENTATION.map((entry) => [entry.jobType, entry]));

export function jobPresentation(jobType) {
  return BY_TYPE.get(String(jobType)) || { jobType: String(jobType), label: "Background task", category: "System", userVisible: false };
}

export const USER_VISIBLE_JOB_TYPES = Object.freeze(JOB_TYPE_PRESENTATION.filter((entry) => entry.userVisible).map((entry) => entry.jobType));
