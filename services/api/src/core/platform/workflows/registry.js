// What a tenant workflow may do. Deliberately small and closed:
//   trigger     a REGISTERED domain event (core/platform/events)
//   conditions  a fixed vocabulary on the event's registered condition fields
//   actions     registered actions only - no code, SQL, shell, HTTP or direct
//               module writes. Today: an in-app notification through the
//               canonical notification service (so recipients' notification
//               preferences apply).
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
]);

// Where a notification for an event of a module goes (a registered category
// of that module).
export const WORKFLOW_NOTIFICATION_CATEGORY = Object.freeze({ crm: "crm_workflow" });

// Record links for notifications, by event entity type (internal paths only).
export const WORKFLOW_ENTITY_LINKS = Object.freeze({
  "crm.lead": (id) => `/crm/leads/${id}`,
  "crm.opportunity": (id) => `/crm/opportunities/${id}`,
});
