import { publishDomainEvent } from "../../../core/platform/events/index.js";

// Every CRM domain event goes through the Shared Platform transactional outbox
// (same transaction as the change). Registered events are what webhooks and
// workflows can see, via each event's own payload allow-list.
export async function queueOutboxEvent(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  const eventPayload =
    entityType === "leads"
      ? safeLeadOutboxPayload(eventType, entityId, payload)
      : payload || {};
  return publishDomainEvent(client, { organizationId: context.organizationId, moduleKey: "crm", eventType, entityType, entityId, payload: eventPayload });
}



export function safeLeadOutboxState(record) {
  if (!record || typeof record !== "object") return {};
  return Object.fromEntries(
    ["status", "sourceId", "ownerUserId", "companyId", "branchId"]
      .filter((field) => record[field] !== undefined)
      .map((field) => [field, record[field]]),
  );
}



export const LEAD_OUTBOX_INFRASTRUCTURE_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "customData",
  "scoreExplanation",
]);



export const LEAD_OUTBOX_DERIVED_FIELDS = Object.freeze({
  email: ["normalizedEmail"],
  mobile: ["normalizedMobile"],
  phone: ["normalizedPhone"],
});



export function stableOutboxValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableOutboxValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableOutboxValue(value[key])]),
    );
  }
  return value;
}



export function outboxValuesEqual(left, right) {
  return (
    JSON.stringify(stableOutboxValue(left)) ===
    JSON.stringify(stableOutboxValue(right))
  );
}



export function leadOutboxChangedFields(before, after, requestedFields = []) {
  const candidates = new Set(requestedFields);
  for (const field of requestedFields) {
    for (const derived of LEAD_OUTBOX_DERIVED_FIELDS[field] || [])
      candidates.add(derived);
  }
  if (!outboxValuesEqual(before?.score, after?.score)) candidates.add("score");
  return [...candidates]
    .filter((field) => !LEAD_OUTBOX_INFRASTRUCTURE_FIELDS.has(field))
    .filter((field) => !outboxValuesEqual(before?.[field], after?.[field]))
    .sort();
}



export function safeLeadOutboxPayload(eventType, leadId, payload) {
  if (eventType === "crm.lead.stage_changed")
    return {
      leadId,
      eventId: payload?.eventId || null,
      source: String(payload?.source || "manual").slice(0, 40),
      before: safeLeadOutboxState(payload?.before),
      after: safeLeadOutboxState(payload?.after),
      changedFields: ["status"],
    };
  if (eventType === "crm.leads.assigned")
    return {
      leadId,
      previousOwnerUserId: payload?.previousOwnerUserId || null,
      ownerUserId: payload?.ownerUserId || null,
      policyId: payload?.policyId || null,
      reason: String(payload?.reason || "manual").slice(0, 120),
      isOverride: Boolean(payload?.isOverride),
    };
  if (eventType.endsWith(".updated")) {
    const before = payload?.before || {};
    const after = payload?.after || {};
    const changedFields = Array.isArray(payload?.changedFields)
      ? [...new Set(payload.changedFields)].sort()
      : leadOutboxChangedFields(before, after, [
          ...Object.keys(before),
          ...Object.keys(after),
        ]);
    return {
      leadId,
      changedFields,
      before: safeLeadOutboxState(before),
      after: safeLeadOutboxState(after),
    };
  }
  return { leadId, ...safeLeadOutboxState(payload) };
}
