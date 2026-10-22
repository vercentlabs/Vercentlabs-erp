// The canonical registry of in-app notification categories. Every notification
// written through createNotification() must use a key registered here; a new
// emitter registers its category here first (verify:shared-runtime enforces it).
//
// Only categories with a real emitter today are listed. In-app is the only
// generic channel: there is no platform-wide notification email or push
// transport, and security email (sign-in, password reset, MFA) never goes
// through notification preferences.
export const NOTIFICATION_CHANNELS = Object.freeze(["in_app", "email"]);

export const NOTIFICATION_CATEGORIES = Object.freeze([
  {
    key: "report_delivered",
    displayName: "Scheduled report ready",
    description: "When a report scheduled for you has been generated.",
    // Only CRM datasets are schedulable today (orchestration/reporting/datasets.js
    // schedulePermission), so a viewer who loses CRM access loses the link too.
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_assignment",
    displayName: "Lead assigned to me",
    description: "When a lead is assigned to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_follow_up_reminder",
    displayName: "Follow-up reminder",
    description: "Reminders for follow-ups assigned to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_follow_up_escalation",
    displayName: "Overdue follow-up escalated to me",
    description: "When a team member's follow-up is overdue and escalated to you as their manager.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_account_assignment",
    displayName: "Account assigned to me",
    description: "When an account is assigned or reassigned to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_contact_assignment",
    displayName: "Contact assigned to me",
    description: "When a contact is assigned or reassigned to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_lead_reassigned",
    displayName: "Lead reassigned",
    description: "When a lead is reassigned to you, or a lead you owned is moved to someone else.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_opportunity_assignment",
    displayName: "Opportunity assigned to me",
    description: "When an opportunity is assigned or reassigned to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_opportunity_stage",
    displayName: "Opportunity reached Closing",
    description: "When someone else moves an opportunity you own to the Closing stage.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_opportunity_outcome",
    displayName: "Opportunity won or lost",
    description: "When someone else marks an opportunity you own as won or lost.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_lead_outcome",
    displayName: "Lead qualified, disqualified or converted",
    description: "When someone else qualifies, disqualifies or converts a lead you own.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_lead_assignment_failed",
    displayName: "Lead assignment rule failed",
    description: "When an assignment rule you manage could not assign a lead, for example because its user or team is inactive.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_follow_up_overdue",
    displayName: "Follow-up overdue",
    description: "When a follow-up assigned to you passes its due time.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_follow_up_assignment",
    displayName: "Follow-up assigned to me",
    description: "When someone gives you a follow-up, or reassigns one to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_task_assignment",
    displayName: "Task assigned to me",
    description: "When someone gives you a task, or reassigns one to you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_task_completed",
    displayName: "Task I created was completed",
    description: "When someone completes a task you created for them.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_task_due",
    displayName: "Task reminder",
    description: "When a reminder you set on a task assigned to you fires.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_task_overdue",
    displayName: "Task overdue",
    description: "When a task assigned to you passes its due time.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_lead_response_due",
    displayName: "New lead waiting for you",
    description: "When a lead you own has had no call, email or meeting within the first-response time.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_lead_response_escalation",
    displayName: "Untouched lead escalated to me",
    description: "When a team member's new lead is still untouched past the escalation time.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_follow_up_overdue",
    displayName: "Follow-up overdue",
    description: "When a follow-up assigned to you passes its due time.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_task_escalation",
    displayName: "Overdue task escalated to me",
    description: "When a team member's task is still overdue past the escalation time.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_whatsapp_received",
    displayName: "WhatsApp message on your record",
    description: "When a customer messages your business WhatsApp number about a lead or contact you own.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_mention",
    displayName: "Mentioned in a note",
    description: "When someone mentions you in a note on a lead, deal, company or contact.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_followed_record",
    displayName: "Records you follow",
    description: "When a note, email or message is added to a lead, deal, company or contact you follow.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_opportunity_stage_overdue",
    displayName: "Deal over its stage time limit",
    description: "When a deal you own stays in a stage longer than the stage's time limit.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_opportunity_stage_escalation",
    displayName: "Stuck deal in your team",
    description: "When a deal of someone you manage stays in a stage more than twice its time limit.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_chat_message",
    displayName: "Website chat",
    description: "When a visitor starts a chat on your website, or writes again in one you answer.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_repeat_enquiry",
    displayName: "Repeat enquiry",
    description: "When someone you own submits the website form again.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_email_received",
    displayName: "Email on your record",
    description: "When an email arrives on a lead, deal, company or contact you own, or opens a new lead for you.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "sales_data_job_finished",
    displayName: "Import finished",
    description: "When a Sales import (customers, addresses, contacts or prices) you started in the background finishes.",
    moduleKey: "sales",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_data_job_finished",
    displayName: "Import or export finished",
    description: "When a CRM import or export you started in the background finishes.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Sent by Settings > Automations workflows triggered by CRM events.
    key: "crm_workflow",
    displayName: "Automations about CRM records",
    description: "Notifications from your organization's automations when CRM leads or opportunities change.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Inventory Low-Stock Alerts: a warehouse went out of stock, needs replenishing, or is low (covered by incoming), or got worse. Delivered
    // only to users who may see that warehouse's alerts.
    key: "inventory_low_stock",
    displayName: "Low-stock alerts",
    description: "When an item at a warehouse you can see goes out of stock, needs replenishing or is low, or gets worse.",
    moduleKey: "stock",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Production holds (manufacturing/holds): an order stopped, a reason cleared, everything cleared, resumed, overdue; to the order's
    // production owner, the hold owner and those who clear its reasons.
    key: "manufacturing_production_hold",
    displayName: "Production holds",
    description: "When a manufacturing order you own or clear is put on hold, becomes ready to resume, resumes or stays on hold too long.",
    moduleKey: "manufacturing",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects: being added to a project or made its manager.
    key: "project_assignment",
    displayName: "Project assignments",
    description: "When you are added to a project, made its Project Manager or handed over.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects: a project you are on starts, pauses, resumes, completes, is cancelled or reopened, or its dates change.
    key: "project_update",
    displayName: "Project updates",
    description: "When a project you work on starts, is put on hold or resumed, is completed, cancelled or reopened, or its dates change.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects (worker, daily): an approaching or passed target date, or a project left without an active manager — each once.
    key: "project_alert",
    displayName: "Project alerts",
    description: "When a project you manage is due soon or overdue, or a project you are on needs a new manager.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Milestones: you are made a milestone's owner, it is submitted, reviewed, blocked, completed, reopened or cancelled.
    key: "project_milestone",
    displayName: "Milestone updates",
    description: "When you are made a milestone's owner, or a milestone you own or manage is submitted, reviewed, blocked, rescheduled, completed, reopened or cancelled.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects (worker, daily): a milestone due soon or overdue — each once per due date.
    key: "project_milestone_alert",
    displayName: "Milestone deadlines",
    description: "When a milestone you own or manage is due soon or overdue.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Assets — Asset Register: an asset placed in your care, a warranty ending, an asset declared missing, assets due for verification.
    key: "asset_register",
    displayName: "Asset register",
    description: "When an asset is assigned to you, its warranty is ending, it is declared missing, or assets you registered are due for verification.",
    moduleKey: "assets",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Assets — Asset Disposal: a disposal waiting for approval, approved, rejected or sent back, and completed — one per case, never one per asset.
    key: "asset_disposal",
    displayName: "Asset disposal",
    description: "When a disposal waits for your approval, is approved, rejected or sent back, or is completed.",
    moduleKey: "assets",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Assets — Asset Maintenance: a problem reported (and any safety restriction), a Work Order assigned, work waiting for verification,
    // preventive services due, overdue work, an asset found unrepairable. One per event, to the maintenance team or the person concerned.
    key: "asset_maintenance",
    displayName: "Asset maintenance",
    description: "When an asset problem is reported, maintenance is assigned to you, a repair waits for verification, a service is due or work is overdue.",
    moduleKey: "assets",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Assets — Automatic Depreciation Accounting: a run ready for approval, posted, blocked or being verified; automatic posting turned on or off.
    // One notification per run outcome, never one per asset.
    key: "asset_depreciation",
    displayName: "Depreciation accounting",
    description: "When a depreciation run is ready for approval, posted, blocked or being verified, and when automatic posting is turned on or off.",
    moduleKey: "assets",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Project Profitability: a recorded snapshot found new financial warnings (a forecast loss, a low margin, an overrun).
    key: "project_profitability",
    displayName: "Project profitability warnings",
    description: "When a project you manage shows a new financial warning: a loss, a forecast margin below the threshold, or a budget overrun.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Project Cost: a project's cost (or its estimate at completion) reached the company's alert threshold of its budget.
    key: "project_cost",
    displayName: "Project cost alerts",
    description: "When a project you manage reaches the cost alert threshold of its approved budget, or its forecast exceeds it.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Project Expenses: a claim waits for your approval or Finance review, or yours was approved, returned, rejected or paid.
    key: "project_expense",
    displayName: "Project expense claims",
    description: "When an expense claim needs your approval or review, or a decision or payment is recorded on yours.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Progress Tracking: a project you manage turned at risk or blocked, became ready to complete, or its weekly summary.
    key: "project_progress",
    displayName: "Project progress alerts",
    description: "When a project you manage becomes at risk or blocked, is ready to complete, or gets its weekly progress summary.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Comments and Collaboration: someone mentioned you in a project, task or milestone discussion.
    key: "project_comment_mention",
    displayName: "Mentions in project discussions",
    description: "When someone mentions you in a comment on a project, task or milestone you can see.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Comments and Collaboration: a reply to your comment, or a new comment in a discussion you follow.
    key: "project_comment",
    displayName: "Replies and followed discussions",
    description: "When someone replies to your comment, or comments in a project, task or milestone discussion you follow.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Timesheets: a timesheet waits for your review, or yours was approved or returned; a correction of your time was decided.
    key: "project_timesheet",
    displayName: "Timesheet reviews",
    description: "When a timesheet waits for your review, yours is approved or returned for changes, or a correction of approved time is decided.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Timesheets (worker, daily, or a manager's reminder): a week's time is due or late — each once per week and day.
    key: "project_timesheet_reminder",
    displayName: "Timesheet reminders",
    description: "When your week's time is due or late, or a late timesheet on a project you manage needs following up.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Billing: the company is near (80%) or at a plan allowance — file storage or this month's messages.
    key: "billing_usage",
    displayName: "Plan usage",
    description: "When your company has used 80% of its file storage or of this month's messages.",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Automations (Shared Platform plan 6) of every app other than CRM (which has its own).
    key: "automation",
    displayName: "Automations",
    description: "Notifications your company's automations send you (an invoice overdue, an order confirmed …).",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Approvals (Shared Platform plan 5): a request waits for you, or the request you raised was decided. Emailed by default.
    key: "approval_request",
    displayName: "Approvals waiting for you",
    description: "When a document (a quotation, an invoice, a bill, a payment, a journal, a POS override) waits for your approval.",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    defaultEmailEnabled: true,
    userConfigurable: true,
  },
  {
    key: "approval_decided",
    displayName: "Your approval requests",
    description: "When a request you raised is approved or rejected.",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    defaultEmailEnabled: true,
    userConfigurable: true,
  },
  {
    // Sales (Shared Platform plan 5): your quotation was accepted or rejected, your order was confirmed, your delivery was dispatched.
    key: "sales_document",
    displayName: "Your sales documents",
    description: "When a quotation you own is accepted or rejected, an order you own is confirmed, or its delivery is dispatched.",
    moduleKey: "sales",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Procurement: goods arrived against a purchase order you raised.
    key: "procurement_document",
    displayName: "Your purchase orders",
    description: "When goods are received against a purchase order you raised.",
    moduleKey: "procurement",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Quality: an inspection failed, or a non-conformance was given to you.
    key: "quality_issue",
    displayName: "Quality issues",
    description: "When an inspection fails, or a non-conformance is assigned to you.",
    moduleKey: "quality",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Support: a ticket was assigned to you, or its customer replied or reopened it.
    key: "support_ticket",
    displayName: "Support tickets",
    description: "When a ticket is assigned to you, or its customer replies to it.",
    moduleKey: "support",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Point of Sale: a shift closed with a cash difference.
    key: "pos_cash_difference",
    displayName: "Cash differences",
    description: "When a cashier closes a shift and the counted cash differs from what was expected.",
    moduleKey: "point-of-sale",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // The shared record thread: someone mentioned you, commented on a record you follow, or gave you an activity (and its reminder).
    key: "record_thread",
    displayName: "Comments and activities",
    description: "When you are mentioned, a record you follow gets a comment, or an activity is given to you or falls due.",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // The full workspace export the person asked for is ready to download.
    key: "workspace_export",
    displayName: "Workspace export ready",
    description: "When the full export of your company's data you asked for is ready to download.",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    userConfigurable: false,
  },
  {
    // Billing: a yearly (or monthly) subscription renews soon.
    key: "billing_renewal",
    displayName: "Subscription renewals",
    description: "Before your subscription renews, with the amount that will be charged.",
    moduleKey: "platform",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Sales (Sales plan): an order is held for credit and the salesperson asks someone who can release credit to look at it.
    key: "sales_credit_release",
    displayName: "Orders held for credit",
    description: "When a salesperson asks you to release an order held over the customer's credit limit or for overdue bills.",
    moduleKey: "sales",
    defaultInAppEnabled: true,
    defaultEmailEnabled: true,
    userConfigurable: true,
  },
  {
    // Sales: an open quotation passed its Valid Until date (told once, by the daily expiry check).
    key: "sales_quotation_expired",
    displayName: "Expired quotations",
    description: "When a quotation you own passes its Valid Until date without a decision.",
    moduleKey: "sales",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects -> Sales: a completed milestone's billing is requested on a sales order (Sales invoices it).
    key: "project_milestone_billing",
    displayName: "Milestone billing requests",
    description: "When a completed project milestone is ready to be invoiced on a sales order you handle.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects — Tasks: a task is assigned to you, reassigned, blocked, sent for your review, returned with changes, done, or you are mentioned on it.
    key: "project_task",
    displayName: "Task updates",
    description: "When a task is assigned to you or reassigned, is blocked, needs your review, comes back with changes, is done, or someone mentions you on it.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    // Projects (worker, daily): a task due soon (one reminder) or overdue (with the Project Manager) — each once per due date.
    key: "project_task_alert",
    displayName: "Task deadlines",
    description: "When a task assigned to you is due soon or overdue; managers hear about overdue tasks on their projects.",
    moduleKey: "projects",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
]);

const BY_KEY = new Map(NOTIFICATION_CATEGORIES.map((category) => [category.key, category]));

export function getNotificationCategory(key) {
  return BY_KEY.get(String(key || "")) || null;
}
