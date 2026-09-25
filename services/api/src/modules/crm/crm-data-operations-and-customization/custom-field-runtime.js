// F028 Custom fields — runtime binding for BUILT-IN CRM entities
// (Lead/Opportunity/Account/Contact), deliberately separate from
// crm_custom_object_definitions/crm_custom_field_definitions (the
// tenant-defined CUSTOM OBJECT system — a different, standalone entity
// builder, not a mechanism for adding fields to built-in records; see
// the settings screen's own documented finding on this distinction).
//
// Uses the platform-level public.custom_field_definitions/
// custom_field_values tables (002_platform_foundation.sql) — confirmed
// by direct search that these existed in the schema with ZERO service
// layer anywhere in the codebase before this file, not a CRM-only
// mechanism repurposed. entity_type values match the SAME vocabulary
// resolveCrmEntityAccess (Notes/Attachments/Timeline's shared parent-
// record authorization) already uses: lead/opportunity/party/contact.
//
// Deliberately does NOT touch Lead/Opportunity's existing customData
// JSONB column or their governed create/update commands — that stays
// exactly as it is, untouched and unrisked. This is a new, additive,
// independently-validated custom-field system, not a retrofit of
// already-shipped, tested mutation paths.
import { CrmError } from "./errors.js";
import { queueOutboxEvent } from "./outbox.js";
import { resolveCrmEntityAccess } from "../seller-activity-and-follow-up-workspace/timeline/timeline.js";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact"]);
const DATA_TYPES = new Set(["text", "textarea", "number", "currency", "percentage", "boolean", "date", "datetime", "select", "multi_select"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// F028 — writing a value is editing the record: the caller needs that record
// type's manage permission, not just CRM access (organization owners pass).
const MANAGE_PERMISSION = { lead: "crm.leads.manage", opportunity: "crm.opportunities.manage", party: "crm.accounts.manage", contact: "crm.accounts.manage" };
function assertCanEditValues(context, entityType) {
  if (context.roleSlugs?.includes("organization_owner")) return;
  if (!context.permissions?.includes(MANAGE_PERMISSION[entityType]))
    throw new CrmError(403, "You do not have permission to edit this record's custom fields.", "CRM_CUSTOM_FIELD_EDIT_FORBIDDEN");
}

function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }
function text(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function assertEntityType(entityType) {
  if (!ENTITY_TYPES.has(entityType)) throw new CrmError(400, "Unsupported custom-field entity type.", "CRM_CUSTOM_FIELD_ENTITY_INVALID");
}
function assertUuid(value, label) {
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_CUSTOM_FIELD_REFERENCE_INVALID");
  return String(value);
}

// --- Definitions (setup) ----------------------------------------------

export async function listCustomFieldDefinitions(client, context, entityType) {
  assertEntityType(entityType);
  const result = await client.query(
    `SELECT * FROM custom_field_definitions WHERE organization_id=$1 AND entity_type=$2 ORDER BY status='active' DESC, label`,
    [context.organizationId, entityType],
  );
  return result.rows.map(dto);
}

export async function createCustomFieldDefinition(client, context, input = {}) {
  const entityType = String(input.entityType || "");
  assertEntityType(entityType);
  const fieldKey = text(input.fieldKey, 80).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!fieldKey) throw new CrmError(400, "A field key is required.", "CRM_CUSTOM_FIELD_KEY_REQUIRED");
  const label = text(input.label, 160);
  if (!label) throw new CrmError(400, "A label is required.", "CRM_CUSTOM_FIELD_LABEL_REQUIRED");
  const dataType = String(input.dataType || "").toLowerCase();
  if (!DATA_TYPES.has(dataType)) throw new CrmError(400, "Choose a valid field type.", "CRM_CUSTOM_FIELD_TYPE_INVALID");
  const required = Boolean(input.required);
  const configuration = {};
  if (dataType === "select" || dataType === "multi_select") {
    const options = Array.isArray(input.options) ? input.options.map((option) => text(option, 120)).filter(Boolean) : [];
    if (!options.length) throw new CrmError(400, "Provide at least one option.", "CRM_CUSTOM_FIELD_OPTIONS_REQUIRED");
    configuration.options = options;
  }
  if (input.maxLength != null) configuration.maxLength = Math.max(1, Math.min(5000, Math.trunc(Number(input.maxLength)) || 500));
  try {
    const result = await client.query(
      `INSERT INTO custom_field_definitions(organization_id,entity_type,field_key,label,data_type,required,configuration,status)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'active') RETURNING *`,
      [context.organizationId, entityType, fieldKey, label, dataType, required, JSON.stringify(configuration)],
    );
    return dto(result.rows[0]);
  } catch (error) {
    if (error?.code === "23505") throw new CrmError(409, "A field with that key already exists for this entity type.", "CRM_CUSTOM_FIELD_DUPLICATE_KEY");
    throw error;
  }
}

export async function setCustomFieldDefinitionActive(client, context, id, active) {
  const definitionId = assertUuid(id, "Custom field");
  const result = await client.query(
    `UPDATE custom_field_definitions SET status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, definitionId, active ? "active" : "inactive"],
  );
  if (!result.rows[0]) throw new CrmError(404, "Custom field not found.", "CRM_CUSTOM_FIELD_NOT_FOUND");
  return dto(result.rows[0]);
}

// --- Runtime values on a specific record -------------------------------

function coerceValue(definition, raw) {
  if (raw === null || raw === undefined || raw === "") {
    if (definition.required) throw new CrmError(400, `${definition.label} is required.`, "CRM_CUSTOM_FIELD_VALUE_REQUIRED", { fieldKey: definition.fieldKey });
    return null;
  }
  const configuration = definition.configuration || {};
  switch (definition.dataType) {
    case "text":
    case "textarea": {
      const value = text(raw, configuration.maxLength || 2000);
      return value || null;
    }
    case "number":
    case "currency":
    case "percentage": {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new CrmError(400, `${definition.label} must be a number.`, "CRM_CUSTOM_FIELD_VALUE_INVALID", { fieldKey: definition.fieldKey });
      if (definition.dataType === "percentage" && (value < 0 || value > 100)) throw new CrmError(400, `${definition.label} must be between 0 and 100.`, "CRM_CUSTOM_FIELD_VALUE_INVALID", { fieldKey: definition.fieldKey });
      return value;
    }
    case "boolean":
      // "false"/"0"/"no" are false — Boolean("false") would store true.
      if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase();
        if (["true", "1", "yes"].includes(normalized)) return true;
        if (["false", "0", "no"].includes(normalized)) return false;
        throw new CrmError(400, `${definition.label} must be yes or no.`, "CRM_CUSTOM_FIELD_VALUE_INVALID", { fieldKey: definition.fieldKey });
      }
      return Boolean(raw);
    case "date":
    case "datetime": {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw new CrmError(400, `${definition.label} is not a valid date.`, "CRM_CUSTOM_FIELD_VALUE_INVALID", { fieldKey: definition.fieldKey });
      return parsed.toISOString();
    }
    case "select": {
      const options = configuration.options || [];
      const value = text(raw, 120);
      if (!options.includes(value)) throw new CrmError(400, `Choose a valid option for ${definition.label}.`, "CRM_CUSTOM_FIELD_VALUE_INVALID", { fieldKey: definition.fieldKey });
      return value;
    }
    case "multi_select": {
      const options = configuration.options || [];
      const values = Array.isArray(raw) ? raw.map((value) => text(value, 120)) : [];
      if (values.some((value) => !options.includes(value))) throw new CrmError(400, `Choose valid options for ${definition.label}.`, "CRM_CUSTOM_FIELD_VALUE_INVALID", { fieldKey: definition.fieldKey });
      return values;
    }
    default:
      return raw;
  }
}

// Read: definitions + current values merged into one row per field, so
// the UI never has to reconcile two separate fetches itself.
export async function getCustomFieldValues(client, context, entityType, entityId) {
  assertEntityType(entityType);
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) return [];
  const result = await client.query(
    `SELECT definition.id AS definition_id, definition.field_key, definition.label, definition.data_type, definition.required, definition.configuration,
            value.value, value.updated_at AS value_updated_at
       FROM custom_field_definitions definition
       LEFT JOIN custom_field_values value
         ON value.organization_id=definition.organization_id AND value.definition_id=definition.id AND value.entity_id=$3
      WHERE definition.organization_id=$1 AND definition.entity_type=$2 AND definition.status='active'
      ORDER BY definition.label`,
    [context.organizationId, entityType, entityId],
  );
  return result.rows.map(dto);
}

// F028 — who changed which custom field, from what to what, newest first.
// Same record-access rule as reading the values; labels are as they were.
export async function getCustomFieldValueHistory(client, context, entityType, entityId) {
  assertEntityType(entityType);
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) return [];
  const result = await client.query(
    `SELECT history.id, history.field_key, history.field_label, history.previous_value, history.new_value, history.changed_at, account.full_name AS changed_by_name
       FROM custom_field_value_history history
       LEFT JOIN users account ON account.id=history.changed_by
      WHERE history.organization_id=$1 AND history.entity_type=$2 AND history.entity_id=$3
      ORDER BY history.changed_at DESC LIMIT 100`,
    [context.organizationId, entityType, entityId],
  );
  return result.rows.map(dto);
}

// Write: every submitted value is validated against its OWN active
// definition (type/required/options/length/range) before anything is
// persisted — a partially-invalid submission writes nothing, not a
// partial update. Unknown field keys (no matching active definition)
// are rejected rather than silently stored, so the value table never
// accumulates orphaned data for a field that was renamed/archived.
export async function setCustomFieldValues(client, context, entityType, entityId, values = {}) {
  assertEntityType(entityType);
  assertUuid(entityId, "Record");
  assertCanEditValues(context, entityType);
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) throw new CrmError(404, "The related CRM record is unavailable.", "CRM_CUSTOM_FIELD_RELATION_INVALID");

  const definitionsResult = await client.query(
    `SELECT * FROM custom_field_definitions WHERE organization_id=$1 AND entity_type=$2 AND status='active'`,
    [context.organizationId, entityType],
  );
  const definitionsByKey = new Map(definitionsResult.rows.map((row) => [row.field_key, dto(row)]));

  const submittedKeys = Object.keys(values || {});
  const unknown = submittedKeys.filter((key) => !definitionsByKey.has(key));
  if (unknown.length) throw new CrmError(400, `Unknown custom field(s): ${unknown.join(", ")}.`, "CRM_CUSTOM_FIELD_UNKNOWN", { fields: unknown });

  // A required field is missing only if it is neither submitted nor already
  // stored — saving one field must not demand re-sending every other one.
  const storedResult = await client.query(
    `SELECT definition_id, value FROM custom_field_values WHERE organization_id=$1 AND entity_id=$2`,
    [context.organizationId, entityId],
  );
  const stored = new Map(storedResult.rows.map((row) => [row.definition_id, row.value]));
  const missingRequired = [...definitionsByKey.values()].filter(
    (definition) => definition.required && !Object.prototype.hasOwnProperty.call(values, definition.fieldKey) && (stored.get(definition.id) ?? null) === null,
  );
  if (missingRequired.length) throw new CrmError(400, `Missing required field(s): ${missingRequired.map((d) => d.label).join(", ")}.`, "CRM_CUSTOM_FIELD_VALUE_REQUIRED");

  const coerced = [];
  for (const [fieldKey, raw] of Object.entries(values || {})) {
    const definition = definitionsByKey.get(fieldKey);
    coerced.push({ definition, value: coerceValue(definition, raw) });
  }

  for (const { definition, value } of coerced) {
    // F028 — the prior value is kept in an append-only ledger, so a later
    // change never erases what the record said before.
    const previous = stored.has(definition.id) ? stored.get(definition.id) : null;
    if (JSON.stringify(previous) !== JSON.stringify(value)) {
      await client.query(
        `INSERT INTO custom_field_value_history(organization_id,definition_id,entity_type,entity_id,field_key,field_label,previous_value,new_value,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
        [context.organizationId, definition.id, entityType, entityId, definition.fieldKey, definition.label, JSON.stringify(previous), JSON.stringify(value), context.userId ?? null],
      );
    }
    await client.query(
      `INSERT INTO custom_field_values(organization_id,definition_id,entity_id,value,updated_at)
       VALUES($1,$2,$3,$4::jsonb,now())
       ON CONFLICT (organization_id,definition_id,entity_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [context.organizationId, definition.id, entityId, JSON.stringify(value)],
    );
  }
  await queueOutboxEvent(client, context, "crm.custom_field_values.updated", entityType, entityId, { fields: coerced.map((c) => c.definition.fieldKey) });
  return getCustomFieldValues(client, context, entityType, entityId);
}
