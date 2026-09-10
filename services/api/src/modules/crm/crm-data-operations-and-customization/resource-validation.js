import { READINESS_FIELD_COLUMNS } from "../lead-lifecycle-qualification-and-prioritization/lead-qualification.js";
import { CrmError } from "./errors.js";
import { LEAD_LINKED_GENERIC_RESOURCES, canViewCustomField, recordScope } from "./record-policy.js";
import { resources } from "./resource-registry.js";
import { camelizeRow } from "./record-utils.js";



export async function getLeadRecordForUpdate(client, context, id) {
  const parameters = [context.organizationId, id];
  const result = await client.query(
    `SELECT record.* FROM tenant.crm_leads record
      WHERE record.organization_id=$1 AND record.id=$2${recordScope(resources.leads, context, parameters)}
      FOR UPDATE`,
    parameters,
  );
  if (!result.rows[0])
    throw new CrmError(404, "CRM record not found.", "CRM_LEAD_NOT_FOUND");
  return camelizeRow(result.rows[0]);
}



// Generic optimistic-concurrency check, originally Lead-only (hence the
// CRM_LEAD_* codes preserved for that entity's backward-compatible
// contract). Integrity closeout (Prompts 1-5): generalized with an
// entityLabel/codePrefix so the exact same check now also protects ordinary
// Opportunity edits through the generic updateCrmRecord/archiveCrmRecord
// path — previously Opportunity PATCH/DELETE never passed `expectations`
// at all, so two concurrent editors could silently overwrite each other
// (unlike the dedicated stage/probability commands, which already had this
// protection).
export function assertRecordExpectedVersion(
  record,
  expectedUpdatedAt,
  required = false,
  entityLabel = "Lead",
  codePrefix = "CRM_LEAD",
) {
  const supplied = String(expectedUpdatedAt || "").trim();
  if (!supplied) {
    if (required)
      throw new CrmError(
        400,
        `Refresh this ${entityLabel} before changing it.`,
        `${codePrefix}_VERSION_REQUIRED`,
      );
    return;
  }
  const expected = new Date(supplied);
  if (!Number.isFinite(expected.getTime()))
    throw new CrmError(
      400,
      `The ${entityLabel} version is invalid. Refresh and try again.`,
      `${codePrefix}_VERSION_INVALID`,
    );
  const actual = new Date(record.updatedAt ?? "");
  if (!Number.isFinite(actual.getTime()) || expected.getTime() !== actual.getTime())
    throw new CrmError(
      409,
      `This ${entityLabel} changed after you loaded it. Refresh and try again.`,
      "CRM_STALE_WRITE",
    );
}


export function assertLeadExpectedVersion(record, expectedUpdatedAt, required = false) {
  return assertRecordExpectedVersion(record, expectedUpdatedAt, required, "Lead", "CRM_LEAD");
}



// Prompts 1-5 integrity closeout (blocker C): mutable generic-CRUD
// configuration resources with no existing append-only/versioned model —
// Qualification criteria (F006) and Won/Lost reasons (F026) — get the same
// checked-write contract as leads/opportunities through the generic
// updateCrmRecord/archiveCrmRecord path below, rather than three more
// bespoke timestamp-comparison implementations. Sales Stages (F012),
// Lead Sources and Account/Contact already have their own dedicated
// version-checked operation files and are NOT routed through here.
// Qualification criteria has no archive/DELETE transition defined
// (archiveStatuses below), so it is PATCH-only.
export const GENERIC_VERSIONED_RESOURCES = {
  "qualification-criteria": { entityLabel: "Qualification criterion", codePrefix: "CRM_QUALIFICATION_CRITERIA" },
  "lost-reasons": { entityLabel: "Won/Lost reason", codePrefix: "CRM_LOST_REASON" },
};



export function mutableEntries(definition, input) {
  return Object.entries(input).filter(
    ([key, value]) => definition.fields[key] && value !== undefined,
  );
}



export function validationErrorDetails(issues) {
  const errors = {};
  for (const item of issues) {
    const field = String(item?.field || "form");
    errors[field] ||= [];
    errors[field].push(String(item?.message || "Invalid value."));
  }
  return { errors, issues };
}



export function normalizeStorageInput(resource, input) {
  const prepared = { ...input };
  // comparison_value is jsonb. Web/API validation intentionally decodes the
  // structured-field JSON into its real primitive type. node-postgres sends a
  // JavaScript string verbatim, which PostgreSQL then tries to parse as raw JSON
  // and rejects (for example Manufacturing is not valid JSON). Re-encode string
  // primitives at the storage boundary so guided UI values and API values are
  // stored as a JSON string instead of causing a database 500.
  if (
    resource === "scoring-rules" &&
    Object.prototype.hasOwnProperty.call(prepared, "comparisonValue") &&
    typeof prepared.comparisonValue === "string"
  ) {
    prepared.comparisonValue = JSON.stringify(prepared.comparisonValue);
  }
  if (
    LEAD_LINKED_GENERIC_RESOURCES.has(resource) &&
    Object.prototype.hasOwnProperty.call(prepared, "entityType")
  ) {
    prepared.entityType = String(prepared.entityType || "").trim().toLowerCase();
  }
  // field_keys is a real Postgres text[] column, but the generic admin form
  // only has scalar inputs — accept a comma-separated string from the UI
  // (an actual array from a direct API caller passes through untouched).
  if (
    resource === "qualification-criteria" &&
    typeof prepared.fieldKeys === "string"
  ) {
    prepared.fieldKeys = prepared.fieldKeys
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
  }
  return prepared;
}



export const organizationUserReferenceFields = new Set([
  "ownerUserId",
  "assignedTo",
  "assigneeUserId",
  "userId",
  "managerUserId",
  "executiveSponsorUserId",
  "relationshipOwnerUserId",
  "reviewedBy",
  "internalOwnerUserId",
]);



export async function assertActiveOrganizationUsers(client, context, userIds) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return;
  const memberships = await client.query(
    `SELECT user_id FROM public.organization_memberships
     WHERE organization_id = $1
       AND user_id = ANY($2::uuid[])
       AND status = 'active'`,
    [context.organizationId, uniqueUserIds],
  );
  const active = new Set(memberships.rows.map((row) => row.user_id));
  const invalid = uniqueUserIds.filter((userId) => !active.has(userId));
  if (invalid.length) {
    throw new CrmError(
      409,
      "CRM owners and assignees must be active members of this organization.",
      "CRM_USER_OUTSIDE_ORGANIZATION",
    );
  }
}



export async function validateOrganizationUserReferences(
  client,
  context,
  definition,
  prepared,
) {
  const userIds = Object.entries(prepared)
    .filter(
      ([key, value]) =>
        value &&
        definition.fields[key] &&
        organizationUserReferenceFields.has(key),
    )
    .map(([, value]) => value);
  await assertActiveOrganizationUsers(client, context, userIds);
}



export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}



export function valueMatchesCustomField(field, value) {
  if (value === null || value === undefined) return true;
  if (field.data_type === "boolean") return typeof value === "boolean";
  if (["number", "currency"].includes(field.data_type))
    return typeof value === "number" && Number.isFinite(value);
  if (field.data_type === "multi_select") return Array.isArray(value);
  if (field.data_type === "json") return typeof value === "object";
  if (field.data_type === "date")
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (field.data_type === "datetime")
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  if (field.data_type === "email")
    return (
      typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    );
  if (field.data_type === "url") {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
  return typeof value === "string";
}



// F028: rolling out `required: true` on a field that already has active
// records without a value for it would make every one of those records fail
// on its very next unrelated edit, with no warning at the point the field
// was actually changed. Requires an explicit confirmation once existing gaps
// are known, rather than silently blocking or silently allowing it.
export async function assertCustomFieldRequiredRolloutSafe(
  client,
  context,
  objectDefinitionId,
  fieldKey,
  confirmed,
) {
  if (confirmed) return;
  const gap = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_custom_records
      WHERE organization_id=$1 AND object_definition_id=$2 AND status='active'
        AND (data->>$3 IS NULL OR data->>$3 = '')`,
    [context.organizationId, objectDefinitionId, fieldKey],
  );
  const missing = Number(gap.rows[0]?.count || 0);
  if (missing > 0)
    throw new CrmError(
      409,
      `${missing} existing record(s) have no value for "${fieldKey}". Confirm to make it required anyway.`,
      "CRM_CUSTOM_FIELD_REQUIRED_ROLLOUT_GAP",
      { missing, fieldKey },
    );
}



// F006: field_keys is a caller-editable text[] column, so it's validated
// against the same fixed allowlist evaluateLeadQualificationReadiness reads
// from — a typo becomes a clear 400 here instead of a criterion that
// silently never matches.
export function assertQualificationCriterionFieldsValid(prepared) {
  if (!Object.prototype.hasOwnProperty.call(prepared, "fieldKeys")) return;
  const keys = Array.isArray(prepared.fieldKeys) ? prepared.fieldKeys : [];
  const invalid = keys.filter((key) => !READINESS_FIELD_COLUMNS[key]);
  if (!keys.length || invalid.length)
    throw new CrmError(
      400,
      invalid.length
        ? `Unknown Lead field key(s): ${invalid.join(", ")}.`
        : "At least one field key is required.",
      "CRM_QUALIFICATION_CRITERION_FIELD_INVALID",
    );
  if (prepared.checkType === "positive_number" && keys.length !== 1)
    throw new CrmError(
      400,
      "A positive-number criterion must reference exactly one field.",
      "CRM_QUALIFICATION_CRITERION_FIELD_COUNT_INVALID",
    );
}



export async function validateCustomRecord(
  client,
  context,
  prepared,
  existingId = null,
  changedDataKeys = null,
) {
  if (!prepared.objectDefinitionId)
    throw new CrmError(400, "Custom object definition is required.");
  if (!isPlainObject(prepared.data))
    throw new CrmError(400, "Custom record data must be a JSON object.");

  const definitionResult = await client.query(
    `SELECT id, company_scoped FROM tenant.crm_custom_object_definitions WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, prepared.objectDefinitionId],
  );
  const objectDefinition = definitionResult.rows[0];
  if (!objectDefinition)
    throw new CrmError(409, "The custom object definition is not active.");
  if (objectDefinition.company_scoped && !prepared.companyId)
    throw new CrmError(400, "A company is required for this custom object.");

  const fieldsResult = await client.query(
    `SELECT field_key, data_type, required, unique_value, options, validation, visible_to_roles, depends_on_field_key FROM tenant.crm_custom_field_definitions WHERE organization_id = $1 AND object_definition_id = $2 AND status = 'active' ORDER BY sequence, field_key`,
    [context.organizationId, prepared.objectDefinitionId],
  );
  const knownFields = new Set(
    fieldsResult.rows.map((field) => field.field_key),
  );
  const unknownFields = Object.keys(prepared.data).filter(
    (key) => !knownFields.has(key),
  );
  if (unknownFields.length)
    throw new CrmError(
      400,
      `Unknown custom fields: ${unknownFields.join(", ")}.`,
      "CRM_CUSTOM_FIELD_UNKNOWN",
    );
  // F028 CAP-002: a caller who cannot see a role-restricted field must not be
  // able to set it either — otherwise it could be written blind and then
  // silently redacted back to them, or worse, used to smuggle a value past a
  // reviewer who also can't see it. Only fields the caller actually supplied
  // are checked (changedDataKeys), not every key present in the merged
  // before+after blob — an update that never mentions `data` at all falls
  // back to the record's existing data verbatim and must not be blocked
  // merely because someone else previously set a restricted field.
  const forbiddenField = fieldsResult.rows.find(
    (field) =>
      (changedDataKeys
        ? changedDataKeys.has(field.field_key)
        : Object.prototype.hasOwnProperty.call(prepared.data, field.field_key)) &&
      !canViewCustomField(context, field.visible_to_roles),
  );
  if (forbiddenField)
    throw new CrmError(
      403,
      `You do not have permission to set ${forbiddenField.field_key}.`,
      "CRM_CUSTOM_FIELD_FORBIDDEN",
      { field: forbiddenField.field_key },
    );

  for (const field of fieldsResult.rows) {
    const value = prepared.data[field.field_key];
    const empty = value === undefined || value === null || value === "";
    if (field.required && empty)
      throw new CrmError(
        400,
        `${field.field_key} is required.`,
        "CRM_CUSTOM_FIELD_REQUIRED",
      );
    if (empty) continue;
    if (!valueMatchesCustomField(field, value))
      throw new CrmError(
        400,
        `${field.field_key} has an invalid ${field.data_type} value.`,
        "CRM_CUSTOM_FIELD_TYPE_INVALID",
      );
    if (["select", "multi_select"].includes(field.data_type)) {
      // F028: when depends_on_field_key is set, `options` is a
      // {parentValue: [childValues]} map rather than a flat array — the
      // valid choices for this field narrow to whatever the parent field's
      // current value in this same record allows. An unset/unrecognized
      // parent value has no allowed options, so any non-empty child value
      // is rejected until the parent is set.
      const dependentOptions = field.depends_on_field_key
        ? (isPlainObject(field.options) ? field.options : {})[
            prepared.data[field.depends_on_field_key]
          ]
        : field.options;
      if (Array.isArray(dependentOptions) && dependentOptions.length) {
        const selected = Array.isArray(value) ? value : [value];
        if (selected.some((item) => !dependentOptions.includes(item)))
          throw new CrmError(
            400,
            field.depends_on_field_key
              ? `${field.field_key} does not have a valid option for the selected ${field.depends_on_field_key}.`
              : `${field.field_key} contains an unsupported option.`,
            "CRM_CUSTOM_FIELD_OPTION_INVALID",
          );
      } else if (field.depends_on_field_key && !empty) {
        throw new CrmError(
          400,
          `${field.field_key} does not have a valid option for the selected ${field.depends_on_field_key}.`,
          "CRM_CUSTOM_FIELD_OPTION_INVALID",
        );
      }
    }
    const validation = isPlainObject(field.validation) ? field.validation : {};
    if (typeof value === "string" && validation.pattern) {
      let pattern;
      try {
        pattern = new RegExp(String(validation.pattern));
      } catch {
        throw new CrmError(
          409,
          `${field.field_key} has an invalid configured validation pattern.`,
        );
      }
      if (!pattern.test(value))
        throw new CrmError(
          400,
          `${field.field_key} does not match its validation rule.`,
          "CRM_CUSTOM_FIELD_PATTERN_INVALID",
        );
    }
    if (typeof value === "number") {
      if (
        validation.minimum !== undefined &&
        value < Number(validation.minimum)
      )
        throw new CrmError(400, `${field.field_key} is below its minimum.`);
      if (
        validation.maximum !== undefined &&
        value > Number(validation.maximum)
      )
        throw new CrmError(400, `${field.field_key} exceeds its maximum.`);
    }
    if (field.unique_value) {
      const uniqueParameters = [
        context.organizationId,
        prepared.objectDefinitionId,
        field.field_key,
        JSON.stringify(value),
      ];
      let exclusion = "";
      if (existingId) {
        uniqueParameters.push(existingId);
        exclusion = " AND id <> $5";
      }
      const duplicate = await client.query(
        `SELECT 1 FROM tenant.crm_custom_records WHERE organization_id = $1 AND object_definition_id = $2 AND data -> $3 = $4::jsonb${exclusion} LIMIT 1`,
        uniqueParameters,
      );
      if (duplicate.rows[0])
        throw new CrmError(
          409,
          `${field.field_key} must be unique.`,
          "CRM_CUSTOM_FIELD_NOT_UNIQUE",
        );
    }
  }
}
