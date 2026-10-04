// The canonical registry of in-app notification categories. Every notification
// written through createNotification() must use a key registered here; a new
// emitter registers its category here first (verify:shared-runtime enforces it).
//
// Only categories with a real emitter today are listed. In-app is the only
// generic channel: there is no platform-wide notification email or push
// transport, and security email (sign-in, password reset, MFA) never goes
// through notification preferences.
export const NOTIFICATION_CHANNELS = Object.freeze(["in_app"]);

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
    key: "crm_automation",
    displayName: "CRM automation alerts",
    description: "Alerts sent to you by CRM automation rules.",
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
]);

const BY_KEY = new Map(NOTIFICATION_CATEGORIES.map((category) => [category.key, category]));

export function getNotificationCategory(key) {
  return BY_KEY.get(String(key || "")) || null;
}
