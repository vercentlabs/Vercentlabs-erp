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
    key: "crm_dwell_breach",
    displayName: "Lead stuck in a stage too long",
    description: "When a lead you own, or one owned by your team, exceeds its stage time limit.",
    moduleKey: "crm",
    defaultInAppEnabled: true,
    userConfigurable: true,
  },
  {
    key: "crm_nurture_queue_due",
    displayName: "Lead nurture action due",
    description: "When a lead in your nurture queue is due for its next action.",
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
