// Custom fields on leads and deals (CRM plan 5.3). The organization defines them (CRM settings); their values live in the record's
// custom_data, keyed by the field's key, and are set through the lead and deal forms like any other field. A switched-off field is no
// longer shown or accepted, but its values stay.
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
export const CUSTOM_FIELD_ENTITIES = Object.freeze(["lead", "opportunity"]);
export const CUSTOM_FIELD_TYPES = Object.freeze(["text", "number", "date", "select", "checkbox"]);
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message, code = "CRM_CUSTOM_FIELD_VALIDATION") => new CrmError(400, message, code, { issues: [{ field, message }] });

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage custom fields.", "PERMISSION_DENIED");
}
function requireEntity(entity) {
  if (!CUSTOM_FIELD_ENTITIES.includes(entity)) throw invalid("entityType", "Custom fields are for leads and deals.");
}

function toField(row) {
  return {
    id: row.id, entityType: row.entity_type, key: row.key, label: row.label, type: row.field_type, options: row.options ?? [], isRequired: row.is_required,
    helpText: row.help_text ?? null, sequence: row.sequence, isActive: row.status === "active",
  };
}

export async function listCustomFields(client, context, entity, { includeInactive = false } = {}) {
  requireEntity(entity);
  if (includeInactive) requireManage(context);
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_custom_fields WHERE organization_id = $1 AND entity_type = $2 AND ($3 OR status = 'active') ORDER BY (status = 'active') DESC, sequence, lower(label)`,
    [context.organizationId, entity, includeInactive]);
  return rows.map(toField);
}

function cleanOptions(type, value) {
  if (type !== "select") return [];
  const options = [...new Set((Array.isArray(value) ? value : []).map((option) => text(option).slice(0, 80)).filter(Boolean))];
  if (options.length < 2 || options.length > 50) throw invalid("options", "Give a choice field between 2 and 50 choices.");
  return options;
}

// input: { entityType, label, type, options?, isRequired?, helpText? }. The key is made from the label and never changes.
export async function createCustomField(client, context, input = {}) {
  requireManage(context);
  requireEntity(input.entityType);
  const label = text(input.label);
  if (!label || label.length > 80) throw invalid("label", "Name the field (up to 80 characters).");
  if (!CUSTOM_FIELD_TYPES.includes(input.type)) throw invalid("type", "Choose the kind of field.");
  const existing = (await client.query("SELECT key, label, status FROM tenant.crm_custom_fields WHERE organization_id = $1 AND entity_type = $2", [context.organizationId, input.entityType])).rows;
  if (existing.some((row) => row.status === "active" && row.label.toLowerCase() === label.toLowerCase())) throw invalid("label", "Another field already has this name.");
  if (existing.filter((row) => row.status === "active").length >= 50) throw invalid("label", "Up to 50 custom fields per record type.");
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1") || "field").slice(0, 34);
  const taken = new Set(existing.map((row) => row.key));
  let key = base;
  for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}_${suffix}`;
  const row = (await client.query(
    `INSERT INTO tenant.crm_custom_fields (organization_id, entity_type, key, label, field_type, options, is_required, help_text, sequence, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, (SELECT COALESCE(max(sequence), 0) + 10 FROM tenant.crm_custom_fields WHERE organization_id = $1 AND entity_type = $2), $9, $9) RETURNING *`,
    [context.organizationId, input.entityType, key, label, input.type, JSON.stringify(cleanOptions(input.type, input.options)), Boolean(input.isRequired),
      text(input.helpText).slice(0, 200) || null, context.userId ?? null])).rows[0];
  return toField(row);
}

// input: any of { label, options, isRequired, helpText, sequence, isActive }. The kind and key stay.
export async function updateCustomField(client, context, fieldId, input = {}) {
  requireManage(context);
  const current = UUID.test(String(fieldId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_custom_fields WHERE organization_id = $1 AND id = $2", [context.organizationId, fieldId])).rows[0] : null;
  if (!current) throw new CrmError(404, "Custom field not found.", "CRM_CUSTOM_FIELD_NOT_FOUND");
  const sets = {};
  if (has(input, "label")) {
    const label = text(input.label);
    if (!label || label.length > 80) throw invalid("label", "Name the field (up to 80 characters).");
    sets.label = label;
  }
  if (has(input, "options")) sets.options = JSON.stringify(cleanOptions(current.field_type, input.options));
  if (has(input, "isRequired")) sets.is_required = Boolean(input.isRequired);
  if (has(input, "helpText")) sets.help_text = text(input.helpText).slice(0, 200) || null;
  if (has(input, "sequence")) sets.sequence = Math.max(0, Math.trunc(Number(input.sequence) || 0));
  if (has(input, "isActive")) sets.status = input.isActive ? "active" : "inactive";
  const columns = Object.keys(sets);
  if (columns.length)
    await client.query(`UPDATE tenant.crm_custom_fields SET ${columns.map((column, index) => `${column} = $${index + 4}${column === "options" ? "::jsonb" : ""}`).join(", ")}, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, context.userId ?? null, ...columns.map((column) => sets[column])]);
  return toField((await client.query("SELECT * FROM tenant.crm_custom_fields WHERE id = $1", [current.id])).rows[0]);
}

// One value, checked against its field. Empty means "no value" (null).
function cleanValue(field, value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  switch (field.field_type) {
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > 1e15) throw invalid(`custom.${field.key}`, `${field.label} must be a number.`);
      return number;
    }
    case "date":
      if (!DATE.test(text(value))) throw invalid(`custom.${field.key}`, `${field.label} must be a date.`);
      return text(value);
    case "checkbox":
      return value === true || value === "true" || value === "yes";
    case "select":
      if (!(field.options ?? []).includes(text(value))) throw invalid(`custom.${field.key}`, `Choose ${field.label} from its list.`);
      return text(value);
    default: {
      const result = text(value);
      if (result.length > 2000) throw invalid(`custom.${field.key}`, `${field.label} is too long.`);
      return result;
    }
  }
}

// Writes the custom field values given (customFields: { key: value }) onto a lead or deal. Unknown or switched-off keys are refused; when
// values are given, every required field must have one. Returns the fields that changed: [{ key, label, from, to }].
export async function applyCustomFields(client, context, entity, recordId, values) {
  requireEntity(entity);
  const fields = (await client.query("SELECT * FROM tenant.crm_custom_fields WHERE organization_id = $1 AND entity_type = $2 AND status = 'active'", [context.organizationId, entity])).rows;
  if (values === undefined || values === null) return [];
  const given = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const key of Object.keys(given)) if (!byKey.has(key)) throw invalid(`custom.${key}`, "That field does not exist or is switched off.");
  const current = (await client.query(`SELECT custom_data FROM tenant.${TABLE[entity]} WHERE organization_id = $1 AND id = $2`, [context.organizationId, recordId])).rows[0]?.custom_data ?? {};
  const next = { ...current };
  const changed = [];
  for (const [key, value] of Object.entries(given)) {
    const field = byKey.get(key);
    const clean = cleanValue(field, value);
    if (JSON.stringify(next[key] ?? null) !== JSON.stringify(clean)) {
      changed.push({ key, label: field.label, from: next[key] ?? null, to: clean });
      if (clean === null) delete next[key];
      else next[key] = clean;
    }
  }
  // Required fields are asked of the person filling in the form (a lead from a connector, an email or an import is never refused).
  const missing = fields.filter((field) => field.is_required && field.field_type !== "checkbox" && (next[field.key] === undefined || next[field.key] === null));
  if (missing.length && values !== undefined && values !== null) throw invalid(`custom.${missing[0].key}`, `Fill in ${missing[0].label}.`);
  if (changed.length)
    await client.query(`UPDATE tenant.${TABLE[entity]} SET custom_data = $3::jsonb WHERE organization_id = $1 AND id = $2`, [context.organizationId, recordId, JSON.stringify(next)]);
  return changed;
}
