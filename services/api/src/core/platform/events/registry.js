// The registered domain-event catalogue. Webhook subscriptions and workflow
// triggers can only name an event listed here, and what leaves the system is
// the event's `project()` output: an explicit allow-list of identifiers and
// state fields, never a whole record. Modules may record other internal
// events (for example a tenant-configured CRM automation "emit_event"); those
// are never delivered or used as triggers.
const pick = (source, fields) =>
  Object.fromEntries(fields.filter((field) => source?.[field] !== undefined && source?.[field] !== null).map((field) => [field, source[field]]));
const leadState = (state) => pick(state, ["status", "sourceId", "ownerUserId"]);
// Projects: every lifecycle change, team change and link, with the project's code, status and manager (never the scope or amounts).
const projectEvent = (key, label, description) => define(`projects.project.${key}`, label, description, "projects.project",
  (event) => ({ projectId: event.entityId, ...pick(event.payload, ["projectCode", "status", "previousStatus", "managerUserId", "source", "changedFields", "memberUserId", "role", "sourceType", "sourceId", "action", "reasonCode", "version"]) }),
  [{ key: "status", label: "Project status" }, { key: "managerUserId", label: "Project Manager", type: "user" }]);
const PROJECT_EVENTS = [
  ["created", "Project created", "A project was created (as a draft)."], ["updated", "Project updated", "A project's details changed."],
  ["activated", "Project activated", "A draft project became planned."], ["approved", "Project approved", "A project's activation was approved."],
  ["started", "Project started", "A project's execution started."], ["held", "Project put on hold", "A project was paused."], ["resumed", "Project resumed", "A paused project resumed."],
  ["completed", "Project completed", "A project was completed."], ["reopened", "Project reopened", "A completed project was reopened."], ["cancelled", "Project cancelled", "A project was cancelled."],
  ["status_changed", "Project status changed", "A project moved to another status (one event for every transition, with the action and its reason code)."],
  ["archived", "Project archived", "A completed or cancelled project was archived."], ["restored", "Project restored", "An archived project was restored."],
  ["member_added", "Project member added", "Someone joined a project team."], ["member_removed", "Project member removed", "Someone left a project team."],
  ["linked", "Project record linked", "A CRM, sales or procurement record was linked to a project."],
];
// Projects — Milestones: the lifecycle and the decisions, with the milestone's code, project and status (never the deliverables or amounts).
const milestoneEvent = (key, label, description) => define(`projects.milestone.${key}`, label, description, "projects.milestone",
  (event) => ({ milestoneId: event.entityId, ...pick(event.payload, ["milestoneCode", "projectId", "status", "decision", "reviewer", "approvalStatus", "dueDate", "completionDate", "salesOrderId"]) }),
  [{ key: "status", label: "Milestone status" }, { key: "decision", label: "Decision" }]);
const MILESTONE_EVENTS = [
  ["created", "Milestone created", "A project milestone was planned."], ["started", "Milestone started", "Work on a milestone started."],
  ["blocked", "Milestone blocked", "A blocker was raised on a milestone."], ["submitted", "Milestone submitted", "A milestone was submitted for review."],
  ["reviewed", "Milestone reviewed", "An internal approval decision was recorded on a milestone."],
  ["customer_decision", "Milestone customer decision", "The customer's acceptance (or request for changes) was recorded on a milestone."],
  ["completed", "Milestone completed", "A milestone was completed."], ["reopened", "Milestone reopened", "A completed milestone was reopened."],
  ["cancelled", "Milestone cancelled", "A milestone was cancelled."], ["due_date_changed", "Milestone rescheduled", "A milestone's due date changed."],
  ["billing_requested", "Milestone billing requested", "A completed milestone's billing was requested from Sales."],
];
// Projects — Tasks: the lifecycle, assignment and review, with the task's code, project, status and assignee (never its description or files).
const taskEvent = (key, label, description) => define(`projects.task.${key}`, label, description, "projects.task",
  (event) => ({ taskId: event.entityId, ...pick(event.payload, ["taskCode", "projectId", "milestoneId", "status", "assigneeUserId", "decision", "from", "to", "dueDate"]) }),
  [{ key: "status", label: "Task status" }, { key: "assigneeUserId", label: "Assignee", type: "user" }]);
const TASK_EVENTS = [
  ["created", "Task created", "A project task was created."], ["reassigned", "Task reassigned", "A task was given to someone else."],
  ["started", "Task started", "Work on a task started."], ["blocked", "Task blocked", "A task was blocked."], ["unblocked", "Task unblocked", "A task's blocker was resolved."],
  ["submitted", "Task submitted for review", "A task was submitted for review."], ["approved", "Task approved", "A task was approved in review and is done."],
  ["changes_requested", "Task changes requested", "A task came back from review with changes requested."], ["completed", "Task completed", "A task was completed."],
  ["reopened", "Task reopened", "A done task was reopened."], ["cancelled", "Task cancelled", "A task was cancelled."], ["due_date_changed", "Task rescheduled", "A task's due date changed."],
];
// Projects — Timesheets: a week's time submitted, approved or returned, a correction applied, approved time handed to billing — with the
// submission's project, employee, week and minutes (never the descriptions, rates or costs).
const timesheetEvent = (key, label, description) => define(`projects.timesheet.${key}`, label, description, "projects.timesheet",
  (event) => ({ submissionId: event.entityId, ...pick(event.payload, ["projectId", "employeeUserId", "periodStart", "status", "version", "totalMinutes", "billableMinutes", "correctionId", "billingRequestId"]) }),
  [{ key: "status", label: "Timesheet status" }, { key: "employeeUserId", label: "Employee", type: "user" }]);
const TIMESHEET_EVENTS = [
  ["submitted", "Timesheet submitted", "An employee submitted a week's time on a project for review."], ["approved", "Timesheet approved", "A submitted timesheet was approved; its time is locked."],
  ["changes_requested", "Timesheet returned", "A submitted timesheet was returned to the employee for correction."],
  ["correction_applied", "Approved time corrected", "A correction of approved time was approved and applied."],
  ["billing_requested", "Time billing requested", "Approved billable time was handed to Sales for invoicing."],
];

const define = (key, label, description, entityType, project, conditionFields) =>
  Object.freeze({ key, moduleKey: key.split(".")[0], label, description, entityType, payloadVersion: 1, project, conditionFields: Object.freeze(conditionFields) });

// Shared Platform plan 6: the business events of Sales, Procurement, Stock and Point of Sale, so automations and webhooks work beyond
// CRM and Projects. Each carries the document's number, its party, the person responsible and (where it is the point) its total;
// never lines, prices or addresses. Manufacturing, HR and Support add theirs when those apps are rebuilt.
const businessEvent = (key, label, description, entityType, idField, fields, conditionFields) =>
  define(key, label, description, entityType, (event) => ({ [idField]: event.entityId, ...pick(event.payload, fields) }), conditionFields);
const TOTAL = { key: "total", label: "Total", type: "number" };
const BUSINESS_EVENTS = [
  businessEvent("sales.quotation.accepted", "Quotation accepted", "The customer accepted a quotation.", "sales.quotation", "quotationId",
    ["quotationNumber", "customerId", "ownerUserId", "total"], [{ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }, TOTAL]),
  businessEvent("sales.quotation.rejected", "Quotation rejected", "The customer rejected a quotation.", "sales.quotation", "quotationId",
    ["quotationNumber", "customerId", "ownerUserId", "total"], [{ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }, TOTAL]),
  businessEvent("sales.order.confirmed", "Sales order confirmed", "A sales order was confirmed.", "sales.order", "orderId",
    ["orderNumber", "customerId", "ownerUserId", "total", "currencyCode"], [{ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }, TOTAL]),
  businessEvent("sales.delivery.dispatched", "Delivery dispatched", "A delivery's goods left the warehouse.", "sales.delivery", "deliveryId",
    ["deliveryNumber", "orderId", "orderNumber", "customerId", "ownerUserId", "carrier", "dispatchDate"], [{ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }, { key: "carrier", label: "Carrier" }]),
  businessEvent("sales.delivery.delivered", "Delivery received", "The customer received a delivery.", "sales.delivery", "deliveryId",
    ["deliveryNumber", "orderId", "customerId", "ownerUserId"], [{ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }]),
  businessEvent("sales.invoice.posted", "Invoice posted", "A sales invoice was posted to the customer's account.", "sales.invoice", "invoiceId",
    ["invoiceNumber", "orderId", "customerId", "ownerUserId", "total"], [{ key: "ownerUserId", label: "Salesperson", type: "user" }, { key: "customerId", label: "Customer" }, TOTAL]),
  businessEvent("procurement.purchase_order.confirmed", "Purchase order confirmed", "A purchase order was confirmed (or an amendment of it).", "procurement.purchase_order", "purchaseOrderId",
    ["purchaseOrderNumber", "supplierId", "buyerUserId", "total", "version"], [{ key: "buyerUserId", label: "Buyer", type: "user" }, { key: "supplierId", label: "Supplier" }, TOTAL]),
  businessEvent("procurement.goods_receipt.posted", "Goods received", "Goods were received against a purchase order.", "procurement.goods_receipt", "receiptId",
    ["receiptNumber", "purchaseOrderId", "purchaseOrderNumber", "supplierId", "buyerUserId"], [{ key: "buyerUserId", label: "Buyer", type: "user" }, { key: "supplierId", label: "Supplier" }]),
  businessEvent("procurement.supplier_bill.posted", "Supplier bill posted", "A supplier bill was posted to Accounts Payable.", "procurement.supplier_bill", "billId",
    ["billNumber", "supplierInvoiceNumber", "purchaseOrderId", "supplierId", "total"], [{ key: "supplierId", label: "Supplier" }, TOTAL]),
  businessEvent("stock.transfer.completed", "Transfer completed", "Stock moved between warehouses or locations arrived in full.", "stock.transfer", "transferId",
    ["transferNumber", "sourceWarehouseId", "destinationWarehouseId"], [{ key: "sourceWarehouseId", label: "From warehouse" }, { key: "destinationWarehouseId", label: "To warehouse" }]),
  businessEvent("stock.low_stock.raised", "Low stock", "An item fell below its minimum (or got worse) in a warehouse.", "stock.low_stock_alert", "alertId",
    ["itemId", "sku", "warehouseId", "condition", "transition"], [{ key: "warehouseId", label: "Warehouse" }, { key: "sku", label: "SKU" }, { key: "transition", label: "Opened, reopened or escalated" }]),
  businessEvent("pos.shift.closed", "POS shift closed", "A cashier's shift was closed.", "pos.shift", "shiftId",
    ["shiftNumber", "storeId", "cashierUserId", "variance"], [{ key: "storeId", label: "Store" }, { key: "cashierUserId", label: "Cashier", type: "user" }, { key: "variance", label: "Cash difference", type: "number" }]),
  businessEvent("pos.day.closed", "POS day closed", "A store's business day was closed with its Z report.", "pos.day", "dayId",
    ["storeId", "businessDate", "zReportId", "netSales", "cashVariance"], [{ key: "storeId", label: "Store" }, { key: "netSales", label: "Net sales", type: "number" }, { key: "cashVariance", label: "Cash difference", type: "number" }]),
];

export const DOMAIN_EVENTS = Object.freeze([
  define("crm.leads.created", "CRM lead created", "A lead was created.", "crm.lead", (event) => ({ leadId: event.entityId, ...leadState(event.payload) }), [
    { key: "status", label: "Lead status" },
    { key: "ownerUserId", label: "Lead owner", type: "user" },
    { key: "sourceId", label: "Lead source" },
  ]),
  define(
    "crm.leads.updated",
    "CRM lead updated",
    "Lead details changed.",
    "crm.lead",
    (event) => ({
      leadId: event.entityId,
      changedFields: Array.isArray(event.payload?.changedFields) ? event.payload.changedFields.map(String).slice(0, 50) : [],
      before: leadState(event.payload?.before),
      after: leadState(event.payload?.after),
    }),
    [
      { key: "changedFields", label: "Changed fields", type: "list" },
      { key: "after.status", label: "Lead status (after)" },
      { key: "after.ownerUserId", label: "Lead owner (after)", type: "user" },
    ],
  ),
  define(
    "crm.leads.assigned",
    "CRM lead assigned",
    "A lead was assigned to an owner.",
    "crm.lead",
    (event) => ({ leadId: event.entityId, ...pick(event.payload, ["previousOwnerUserId", "ownerUserId", "reason", "isOverride"]) }),
    [
      { key: "ownerUserId", label: "New owner", type: "user" },
      { key: "reason", label: "Assignment reason" },
    ],
  ),
  define(
    "crm.lead.stage_changed",
    "CRM lead stage changed",
    "A lead moved to another stage.",
    "crm.lead",
    (event) => ({
      leadId: event.entityId,
      fromStatus: event.payload?.before?.status ?? null,
      toStatus: event.payload?.after?.status ?? null,
      source: typeof event.payload?.source === "string" ? event.payload.source.slice(0, 40) : null,
    }),
    [
      { key: "toStatus", label: "New stage" },
      { key: "fromStatus", label: "Previous stage" },
    ],
  ),
  define("crm.leads.archived", "CRM lead archived", "A lead was archived.", "crm.lead", (event) => ({ leadId: event.entityId }), []),
  define(
    "crm.lead.converted",
    "CRM lead converted",
    "A lead was converted to an account, contact and/or opportunity.",
    "crm.lead",
    (event) => ({ leadId: event.entityId, ...pick(event.payload, ["partyId", "contactId", "opportunityId"]) }),
    [],
  ),
  define(
    "crm.opportunity.stage_changed",
    "CRM opportunity stage changed",
    "An opportunity moved to another stage.",
    "crm.opportunity",
    (event) => ({ opportunityId: event.entityId, ...pick(event.payload, ["fromStageId", "toStageId", "status"]) }),
    [
      { key: "status", label: "Opportunity status" },
      { key: "toStageId", label: "New stage" },
    ],
  ),
  define(
    "crm.opportunity.reopened",
    "CRM opportunity reopened",
    "A closed opportunity was reopened.",
    "crm.opportunity",
    (event) => ({ opportunityId: event.entityId, ...pick(event.payload, ["previousStatus", "toStageId"]) }),
    [],
  ),
  // Companies and contacts (CRM audit: automations on them, not only on leads and deals).
  define("crm.accounts.created", "CRM company created", "A company was added.", "crm.party", (event) => ({ accountId: event.entityId }), []),
  define("crm.accounts.updated", "CRM company updated", "A company's details changed.", "crm.party",
    (event) => ({ accountId: event.entityId, changedFields: Array.isArray(event.payload?.changedFields) ? event.payload.changedFields.map(String).slice(0, 50) : [] }),
    [{ key: "changedFields", label: "Changed fields", type: "list" }]),
  define("crm.contacts.created", "CRM contact created", "A contact was added.", "crm.contact", (event) => ({ contactId: event.entityId, ...pick(event.payload, ["accountId"]) }), []),
  define("crm.contacts.updated", "CRM contact updated", "A contact's details changed.", "crm.contact",
    (event) => ({ contactId: event.entityId, changedFields: Array.isArray(event.payload?.changedFields) ? event.payload.changedFields.map(String).slice(0, 50) : [] }),
    [{ key: "changedFields", label: "Changed fields", type: "list" }]),
  ...PROJECT_EVENTS.map(([key, label, description]) => projectEvent(key, label, description)),
  ...MILESTONE_EVENTS.map(([key, label, description]) => milestoneEvent(key, label, description)),
  ...TASK_EVENTS.map(([key, label, description]) => taskEvent(key, label, description)),
  ...TIMESHEET_EVENTS.map(([key, label, description]) => timesheetEvent(key, label, description)),
  ...BUSINESS_EVENTS,
]);

const BY_KEY = new Map(DOMAIN_EVENTS.map((event) => [event.key, event]));

export function getDomainEvent(key) {
  return BY_KEY.get(String(key || "")) || null;
}

// The external envelope for one event. `data` is the registered projection.
export function projectDomainEvent(row) {
  const definition = getDomainEvent(row.event_type);
  if (!definition) return null;
  return {
    id: row.id,
    type: definition.key,
    version: definition.payloadVersion,
    occurredAt: new Date(row.occurred_at).toISOString(),
    module: definition.moduleKey,
    entity: { type: definition.entityType, id: row.entity_id },
    data: definition.project({ entityId: row.entity_id, payload: row.payload || {} }),
  };
}
