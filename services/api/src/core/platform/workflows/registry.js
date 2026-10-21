// What a tenant workflow may do. Deliberately small and closed:
//   trigger     a REGISTERED domain event (core/platform/events)
//   conditions  a fixed vocabulary on the event's registered condition fields
//   actions     registered actions only - no code, SQL, shell, HTTP or direct
//               module writes. Today: an in-app notification through the
//               canonical notification service (so recipients' notification
//               preferences apply), plus a module's own actions for that
//               module's events (CRM: follow-up, owner, priority, tag, email,
//               followers, task, stage, WhatsApp template, and a call to one of the company's own webhooks).
export const WORKFLOW_LIMITS = Object.freeze({ maxConditions: 10, maxActions: 5, maxNameLength: 120, maxTitle: 120, maxMessage: 500, runsPerTick: 50 });

export const CONDITION_OPERATORS = Object.freeze([
  Object.freeze({ key: "equals", label: "is" }),
  Object.freeze({ key: "not_equals", label: "is not" }),
  Object.freeze({ key: "in", label: "is one of" }),
  Object.freeze({ key: "changed_includes", label: "includes" }),
  // Shared Platform plan 6: amounts and counts (fields of type "number").
  Object.freeze({ key: "greater_than", label: "is more than" }),
  Object.freeze({ key: "less_than", label: "is less than" }),
]);

export const WORKFLOW_ACTIONS = Object.freeze([
  Object.freeze({
    key: "notify",
    label: "Send an in-app notification",
    description: "Notifies a person from the event (for example the lead's new owner) or a named member. Their notification preferences apply.",
  }),
  // Shared Platform plan 6: for every app's events.
  Object.freeze({
    key: "send_email",
    label: "Send an email",
    description: "Emails a person from the event, a named member or an address, with a subject and message (use {{field}} for the event's values, for example {{invoiceNumber}}).",
  }),
  Object.freeze({
    key: "create_activity",
    label: "Plan an activity on the record",
    description: "Adds a to-do, call, meeting or email to the record's activities, due some days after the event, for a person from the event or a named member.",
  }),
  Object.freeze({
    key: "assign",
    label: "Hand the record to someone",
    description: "Makes a named member the record's salesperson or buyer (quotations, sales orders and purchase orders).",
  }),
  // A module's own actions (CRM plan 4.6): offered only for that module's events, validated and run by the module
  // (modules/crm/automation/actions.js), each through the same operation a person uses.
  Object.freeze({ key: "crm.create_follow_up", module: "crm", label: "Plan a follow-up", description: "Plans a call, email, meeting or visit on the record, some hours after the event, for its owner or a named member." }),
  Object.freeze({ key: "crm.assign_owner", module: "crm", label: "Give the record an owner", description: "Assigns the lead or deal to a named member. They are told, as with any assignment." }),
  Object.freeze({ key: "crm.set_priority", module: "crm", label: "Set the priority", description: "Sets the lead's or deal's priority to low, medium or high." }),
  Object.freeze({ key: "crm.add_tag", module: "crm", label: "Add a tag", description: "Adds a tag to the lead or deal (the tag is created if it does not exist)." }),
  Object.freeze({ key: "crm.send_email", module: "crm", label: "Send an email from a template", description: "Emails the lead or the deal's contact from an email template, in the owner's name. Unsubscribed and opted-out people are not emailed." }),
  Object.freeze({ key: "crm.notify_followers", module: "crm", label: "Tell the record's followers", description: "Sends an in-app notification to everyone following the lead or deal, its owner included." }),
  // CRM audit: more of what a salesperson would do by hand.
  Object.freeze({ key: "crm.create_task", module: "crm", label: "Create a task", description: "Adds a task on the record, due some days after the event, for its owner or a named member." }),
  Object.freeze({ key: "crm.move_stage", module: "crm", label: "Move to a stage", description: "Moves the lead, or the deal, to a stage (a deal's stage rules still apply; won and lost are marked by people)." }),
  Object.freeze({ key: "crm.send_whatsapp", module: "crm", label: "Send a WhatsApp template", description: "Sends an approved WhatsApp template to the lead or contact through the connected WhatsApp Business number. Only people who agreed to WhatsApp get it." }),
  Object.freeze({ key: "crm.call_webhook", module: "crm", label: "Call a webhook", description: "Sends the event to one of your webhooks (Settings › Integrations), signed and retried like every webhook, even if that webhook does not subscribe to this event." }),
]);

// Where a module's own actions are implemented (loaded only when a workflow uses one).
export const WORKFLOW_MODULE_ACTIONS = Object.freeze({
  crm: () => import("../../../modules/crm/automation/actions.js").then((module) => ({ validate: module.validateCrmWorkflowAction, execute: module.executeCrmWorkflowAction })),
});

// Where a notification for an event of a module goes (a registered category
// of that module).
export const WORKFLOW_NOTIFICATION_CATEGORY = Object.freeze({ crm: "crm_workflow", sales: "automation", procurement: "automation", stock: "automation",
  "point-of-sale": "automation", projects: "automation" });

// Records an automation can plan an activity on (the shared record thread's types), by event entity type.
export const WORKFLOW_ACTIVITY_RECORDS = Object.freeze({
  "sales.quotation": "sales.quotation", "sales.order": "sales.order", "sales.invoice": "sales.invoice", "sales.delivery": "sales.delivery",
  "procurement.purchase_order": "procurement.purchase_order", "procurement.supplier_bill": "procurement.supplier_bill",
});
// Records an automation can hand to someone: the table and its responsible-person column.
export const WORKFLOW_ASSIGNABLE = Object.freeze({
  "sales.quotation": { table: "tenant.sales_quotations", column: "owner_user_id", label: "salesperson" },
  "sales.order": { table: "tenant.sales_orders", column: "owner_user_id", label: "salesperson" },
  "procurement.purchase_order": { table: "tenant.purchase_orders", column: "buyer_user_id", label: "buyer" },
});

// Record links for notifications, by event entity type (internal paths only).
export const WORKFLOW_ENTITY_LINKS = Object.freeze({
  "crm.lead": (id) => `/crm/leads/${id}`,
  "crm.opportunity": (id) => `/crm/opportunities/${id}`,
  "crm.party": (id) => `/crm/accounts/${id}`,
  "crm.contact": (id) => `/crm/contacts/${id}`,
  "sales.quotation": (id) => `/sales/quotations/${id}`,
  "sales.order": (id) => `/sales/orders/${id}`,
  "sales.delivery": (id) => `/sales/deliveries/${id}`,
  "sales.invoice": (id) => `/sales/invoices/${id}`,
  "procurement.purchase_order": (id) => `/procurement/purchase-orders/${id}`,
  "procurement.goods_receipt": () => "/procurement/goods-receipts",
  "procurement.supplier_bill": (id) => `/procurement/supplier-bills/${id}`,
  "stock.transfer": (id) => `/inventory/transfers/${id}`,
  "stock.low_stock_alert": (id) => `/inventory/replenishment/alerts/${id}`,
  "pos.shift": () => "/pos/shifts",
  "pos.day": () => "/pos/day-end",
  "projects.project": (id) => `/projects/${id}`,
  "projects.task": (id) => `/projects/tasks/${id}`,
});
