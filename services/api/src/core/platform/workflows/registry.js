// What a tenant workflow may do. Deliberately small and closed:
//   trigger     a REGISTERED domain event (core/platform/events)
//   conditions  a fixed vocabulary on the event's registered condition fields
//   actions     registered actions only - no code, SQL, shell, HTTP or direct
//               module writes. Today: an in-app notification through the
//               canonical notification service (so recipients' notification
//               preferences apply), plus a module's own actions for that
//               module's events (CRM: follow-up, owner, priority, tag, email,
//               followers).
export const WORKFLOW_LIMITS = Object.freeze({ maxConditions: 10, maxActions: 5, maxNameLength: 120, maxTitle: 120, maxMessage: 500, runsPerTick: 50 });

export const CONDITION_OPERATORS = Object.freeze([
  Object.freeze({ key: "equals", label: "is" }),
  Object.freeze({ key: "not_equals", label: "is not" }),
  Object.freeze({ key: "in", label: "is one of" }),
  Object.freeze({ key: "changed_includes", label: "includes" }),
]);

export const WORKFLOW_ACTIONS = Object.freeze([
  Object.freeze({
    key: "notify",
    label: "Send an in-app notification",
    description: "Notifies a person from the event (for example the lead's new owner) or a named member. Their notification preferences apply.",
  }),
  // A module's own actions (CRM plan 4.6): offered only for that module's events, validated and run by the module
  // (modules/crm/automation/actions.js), each through the same operation a person uses.
  Object.freeze({ key: "crm.create_follow_up", module: "crm", label: "Plan a follow-up", description: "Plans a call, email, meeting or visit on the record, some hours after the event, for its owner or a named member." }),
  Object.freeze({ key: "crm.assign_owner", module: "crm", label: "Give the record an owner", description: "Assigns the lead or deal to a named member. They are told, as with any assignment." }),
  Object.freeze({ key: "crm.set_priority", module: "crm", label: "Set the priority", description: "Sets the lead's or deal's priority to low, medium or high." }),
  Object.freeze({ key: "crm.add_tag", module: "crm", label: "Add a tag", description: "Adds a tag to the lead or deal (the tag is created if it does not exist)." }),
  Object.freeze({ key: "crm.send_email", module: "crm", label: "Send an email from a template", description: "Emails the lead or the deal's contact from an email template, in the owner's name. Unsubscribed and opted-out people are not emailed." }),
  Object.freeze({ key: "crm.notify_followers", module: "crm", label: "Tell the record's followers", description: "Sends an in-app notification to everyone following the lead or deal, its owner included." }),
]);

// Where a module's own actions are implemented (loaded only when a workflow uses one).
export const WORKFLOW_MODULE_ACTIONS = Object.freeze({
  crm: () => import("../../../modules/crm/automation/actions.js").then((module) => ({ validate: module.validateCrmWorkflowAction, execute: module.executeCrmWorkflowAction })),
});

// Where a notification for an event of a module goes (a registered category
// of that module).
export const WORKFLOW_NOTIFICATION_CATEGORY = Object.freeze({ crm: "crm_workflow" });

// Record links for notifications, by event entity type (internal paths only).
export const WORKFLOW_ENTITY_LINKS = Object.freeze({
  "crm.lead": (id) => `/crm/leads/${id}`,
  "crm.opportunity": (id) => `/crm/opportunities/${id}`,
});
