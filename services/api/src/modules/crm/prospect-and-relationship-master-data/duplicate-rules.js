// F008 governed duplicate-rule configuration (CRM vNext Prompt 3
// continuation, CRM-VNEXT-044). See migration 090_f008_duplicate_rules.sql
// for the security design: a rule row is pure structured data selecting one
// of the fixed comparisons below — never free-text/executable SQL.
import { CrmError, queueOutboxEvent } from "../index.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DUPLICATE_ENTITY_TYPES = Object.freeze(["lead", "contact", "account"]);
export const DUPLICATE_METHODS = Object.freeze(["exact", "normalized", "fuzzy"]);

// The fixed, code-reviewed catalog of comparisons an organization may
// enable/reweight. A rule row's (entity_type, signal, method) must match one
// of these — the settings UI only ever lets an admin pick FROM this list,
// never type a signal/method freely.
export const DUPLICATE_SIGNAL_CATALOG = Object.freeze({
  lead: [
    { signal: "email", method: "exact", label: "Email (exact match)" },
    { signal: "mobile", method: "normalized", label: "Mobile number (normalized, last 15 digits)" },
    { signal: "name_and_company", method: "normalized", label: "Name + company name (normalized)" },
  ],
  contact: [
    { signal: "email", method: "exact", label: "Email (exact match)" },
    { signal: "mobile", method: "normalized", label: "Mobile/phone (normalized, last 15 digits)" },
    { signal: "name", method: "normalized", label: "Full name (normalized)" },
    { signal: "name", method: "fuzzy", label: "Full name (fuzzy similarity)" },
  ],
  account: [
    { signal: "gstin", method: "exact", label: "GSTIN (exact match)" },
    { signal: "pan", method: "exact", label: "PAN (exact match)" },
    { signal: "legal_name", method: "normalized", label: "Legal/company name (normalized)" },
    { signal: "legal_name", method: "fuzzy", label: "Legal/company name (fuzzy similarity)" },
  ],
});

function assertId(value, label) {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new CrmError(400, `${label} identifier is invalid.`, "CRM_IDENTIFIER_INVALID");
  }
  return String(value);
}

function camelize(value) {
  return value.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
}

function dto(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [camelize(key), value]),
  );
}

function isCataloged(entityType, signal, method) {
  return (DUPLICATE_SIGNAL_CATALOG[entityType] || []).some(
    (entry) => entry.signal === signal && entry.method === method,
  );
}

export async function listDuplicateRules(client, context, entityType = null) {
  const parameters = [context.organizationId];
  let where = "WHERE organization_id=$1";
  if (entityType) {
    if (!DUPLICATE_ENTITY_TYPES.includes(entityType)) {
      throw new CrmError(400, "Unknown entity type.", "CRM_DUPLICATE_RULE_ENTITY_INVALID");
    }
    parameters.push(entityType);
    where += ` AND entity_type=$${parameters.length}`;
  }
  const result = await client.query(
    `SELECT * FROM tenant.crm_duplicate_rules ${where} ORDER BY entity_type, signal, method`,
    parameters,
  );
  return result.rows.map(dto);
}

// Reads only ENABLED rules — the shape the scoring engine actually consumes.
export async function getActiveDuplicateRules(client, context, entityType) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_duplicate_rules
     WHERE organization_id=$1 AND entity_type=$2 AND enabled=true`,
    [context.organizationId, entityType],
  );
  return result.rows.map(dto);
}

export async function upsertDuplicateRule(client, context, input = {}) {
  const entityType = String(input.entityType || "");
  const signal = String(input.signal || "");
  const method = String(input.method || "");
  if (!DUPLICATE_ENTITY_TYPES.includes(entityType)) {
    throw new CrmError(400, "Choose a valid entity type.", "CRM_DUPLICATE_RULE_ENTITY_INVALID", {
      errors: { entityType: ["Choose a valid entity type."] },
    });
  }
  if (!isCataloged(entityType, signal, method)) {
    throw new CrmError(
      400,
      "That signal/method combination is not a supported duplicate-matching comparison.",
      "CRM_DUPLICATE_RULE_SIGNAL_INVALID",
      { errors: { signal: ["Choose a supported signal and method."] } },
    );
  }
  const weight = Number(input.weight);
  if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
    throw new CrmError(400, "Weight must be an integer between 0 and 100.", "CRM_DUPLICATE_RULE_WEIGHT_INVALID", {
      errors: { weight: ["Weight must be an integer between 0 and 100."] },
    });
  }
  let fuzzyThreshold = null;
  if (method === "fuzzy") {
    fuzzyThreshold = Number(input.fuzzyThreshold ?? 0.55);
    if (!(fuzzyThreshold > 0 && fuzzyThreshold <= 1)) {
      throw new CrmError(
        400,
        "Fuzzy threshold must be between 0 and 1.",
        "CRM_DUPLICATE_RULE_THRESHOLD_INVALID",
        { errors: { fuzzyThreshold: ["Fuzzy threshold must be between 0 and 1."] } },
      );
    }
  }
  const enabled = input.enabled !== false;
  const blocking = Boolean(input.blocking);
  const result = await client.query(
    `INSERT INTO tenant.crm_duplicate_rules
       (organization_id, entity_type, signal, method, weight, fuzzy_threshold, enabled, blocking, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     ON CONFLICT (organization_id, entity_type, signal, method)
     DO UPDATE SET
       weight=EXCLUDED.weight,
       fuzzy_threshold=EXCLUDED.fuzzy_threshold,
       enabled=EXCLUDED.enabled,
       blocking=EXCLUDED.blocking,
       updated_by=EXCLUDED.updated_by
     RETURNING *`,
    [context.organizationId, entityType, signal, method, weight, fuzzyThreshold, enabled, blocking, context.userId],
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.duplicate_rules.updated",
    "duplicate_rule",
    result.rows[0].id,
    { entityType, signal, method, weight, enabled, blocking },
  );
  return dto(result.rows[0]);
}

export async function setDuplicateRuleEnabled(client, context, id, enabled) {
  assertId(id, "Rule");
  const result = await client.query(
    `UPDATE tenant.crm_duplicate_rules
     SET enabled=$3, updated_by=$4
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [context.organizationId, id, Boolean(enabled), context.userId],
  );
  if (!result.rows[0]) {
    throw new CrmError(404, "Duplicate rule not found.", "CRM_DUPLICATE_RULE_NOT_FOUND");
  }
  await queueOutboxEvent(
    client,
    context,
    enabled ? "crm.duplicate_rules.enabled" : "crm.duplicate_rules.disabled",
    "duplicate_rule",
    id,
    { id, enabled: Boolean(enabled) },
  );
  return dto(result.rows[0]);
}

// A single monotonic "as of" marker for staleness detection: the latest
// updated_at across every currently-enabled rule for this entity type. If a
// dismissal's stored rules_snapshot_at predates this, the rule set has
// changed materially since the dismissal was recorded.
export async function activeRuleSetTimestamp(client, context, entityType) {
  const result = await client.query(
    `SELECT max(updated_at) AS at FROM tenant.crm_duplicate_rules
     WHERE organization_id=$1 AND entity_type=$2 AND enabled=true`,
    [context.organizationId, entityType],
  );
  return result.rows[0]?.at || new Date(0);
}
