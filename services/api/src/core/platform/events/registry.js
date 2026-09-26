// The registered domain-event catalogue. Webhook subscriptions and workflow
// triggers can only name an event listed here, and what leaves the system is
// the event's `project()` output: an explicit allow-list of identifiers and
// state fields, never a whole record. Modules may record other internal
// events (for example a tenant-configured CRM automation "emit_event"); those
// are never delivered or used as triggers.
const pick = (source, fields) =>
  Object.fromEntries(fields.filter((field) => source?.[field] !== undefined && source?.[field] !== null).map((field) => [field, source[field]]));
const leadState = (state) => pick(state, ["status", "sourceId", "ownerUserId", "companyId", "branchId"]);

const define = (key, label, description, entityType, project, conditionFields) =>
  Object.freeze({ key, moduleKey: key.split(".")[0], label, description, entityType, payloadVersion: 1, project, conditionFields: Object.freeze(conditionFields) });

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
