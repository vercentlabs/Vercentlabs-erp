// Effective-dated, versioned configuration (settings and feature flags) for
// REGISTERED keys only (see registry.js). Every write is serialised with
// pg_advisory_xact_lock on (organisation, namespace/key) so concurrent
// effective-dated writes cannot race; history is never rewritten - a new
// version closes the one it replaces at its start time. A future-dated value
// is a scheduled change.
//
// Both kinds are stored in configuration_versions (the older feature_flags
// table remains for existing rows and is read by nothing new).
import { audit } from "../../security/request-security.js";
import { CONFIGURATION_DEFINITIONS, getConfigurationDefinition } from "./registry.js";

export class ConfigurationError extends Error {
  constructor(status, message, code = "CONFIGURATION_ERROR") {
    super(message);
    this.name = "ConfigurationError";
    this.status = status;
    this.code = code;
  }
}

function definitionFor(namespace, key, { audience = null } = {}) {
  const definition = getConfigurationDefinition(String(namespace || ""), String(key || ""));
  if (!definition) throw new ConfigurationError(400, "This setting is not available.", "CONFIGURATION_KEY_UNKNOWN");
  if (audience && definition.audience !== audience) throw new ConfigurationError(403, "This setting is managed by Vercentlabs operations.", "CONFIGURATION_OPERATOR_ONLY");
  return definition;
}

async function effectiveRow(client, organizationId, definition, at = new Date()) {
  const { rows } = await client.query(
    `SELECT value, version, effective_from, effective_to, created_by, created_at FROM configuration_versions
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND status='active'
        AND effective_from<=$4 AND (effective_to IS NULL OR effective_to>$4)
      ORDER BY version DESC LIMIT 1`,
    [organizationId, definition.namespace, definition.key, at],
  );
  return rows[0] || null;
}

/** The effective value (or the registered default) of one registered key. */
export async function getConfigurationValue(client, organizationId, namespace, key, at = new Date()) {
  const definition = definitionFor(namespace, key);
  const row = await effectiveRow(client, organizationId, definition, at);
  if (!row) return definition.defaultValue;
  try {
    return definition.validate(row.value);
  } catch {
    return definition.defaultValue;
  }
}

export async function isFeatureFlagEnabled(client, organizationId, namespace, key) {
  const definition = definitionFor(namespace, key);
  if (definition.kind !== "flag") throw new ConfigurationError(400, "This setting is not a feature flag.", "CONFIGURATION_KEY_UNKNOWN");
  return (await getConfigurationValue(client, organizationId, namespace, key)) === true;
}

async function writeVersion(client, session, definition, value, effectiveFromValue, eventType) {
  let validated;
  try {
    validated = definition.validate(value);
  } catch (error) {
    throw new ConfigurationError(400, error instanceof Error ? error.message : "The value is not valid.", "CONFIGURATION_VALUE_INVALID");
  }
  const effectiveFrom = effectiveFromValue ? new Date(String(effectiveFromValue)) : new Date();
  if (!Number.isFinite(effectiveFrom.getTime())) throw new ConfigurationError(400, "The start date is invalid.", "CONFIGURATION_VALUE_INVALID");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [session.organizationId, `configuration:${definition.namespace}:${definition.key}`]);
  const later = await client.query(
    `SELECT 1 FROM configuration_versions WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND status='active' AND effective_from >= $4 LIMIT 1`,
    [session.organizationId, definition.namespace, definition.key, effectiveFrom],
  );
  if (later.rows[0]) throw new ConfigurationError(409, "A change is already scheduled at or after this time. Cancel it first.", "CONFIGURATION_SCHEDULE_CONFLICT");
  const next = (await client.query(`SELECT COALESCE(max(version),0)+1 AS v FROM configuration_versions WHERE organization_id=$1 AND namespace=$2 AND config_key=$3`, [session.organizationId, definition.namespace, definition.key])).rows[0].v;
  await client.query(
    `UPDATE configuration_versions SET effective_to=$4, status=CASE WHEN $4<=now() THEN 'superseded' ELSE status END
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND status='active' AND effective_from<$4 AND (effective_to IS NULL OR effective_to>$4)`,
    [session.organizationId, definition.namespace, definition.key, effectiveFrom],
  );
  const { rows } = await client.query(
    `INSERT INTO configuration_versions (organization_id, namespace, config_key, value, effective_from, version, status, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,'active',$7) RETURNING id, version, effective_from`,
    [session.organizationId, definition.namespace, definition.key, JSON.stringify(validated), effectiveFrom, next, session.userId],
  );
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType,
    entityType: "configuration",
    entityId: `${definition.namespace}.${definition.key}`,
    afterData: { value: validated, effectiveFrom: effectiveFrom.toISOString(), version: rows[0].version },
  });
  return { version: rows[0].version, effectiveFrom: rows[0].effective_from, value: validated };
}

// Tenant administrators: registered tenant-audience keys only.
export async function setTenantConfiguration(client, session, { namespace, key, value, effectiveFrom = null }) {
  const definition = definitionFor(namespace, key, { audience: "tenant" });
  return writeVersion(client, session, definition, value, effectiveFrom, "configuration.version_created");
}

// Operations tooling only (never exposed through a tenant route).
export async function setOperatorConfiguration(client, actor, { namespace, key, value, effectiveFrom = null }) {
  const definition = definitionFor(namespace, key, { audience: "operator" });
  return writeVersion(client, actor, definition, value, effectiveFrom, "configuration.operator_version_created");
}

// Removes a change that has not started yet.
export async function cancelScheduledConfiguration(client, session, { namespace, key, version }) {
  const definition = definitionFor(namespace, key, { audience: "tenant" });
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [session.organizationId, `configuration:${definition.namespace}:${definition.key}`]);
  const { rows } = await client.query(
    `UPDATE configuration_versions SET status='cancelled' WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND version=$4 AND status='active' AND effective_from > now()
     RETURNING effective_from`,
    [session.organizationId, definition.namespace, definition.key, Number(version)],
  );
  if (!rows[0]) throw new ConfigurationError(404, "No scheduled change to cancel.", "CONFIGURATION_SCHEDULE_NOT_FOUND");
  // Reopen the version it would have closed.
  await client.query(
    `UPDATE configuration_versions SET effective_to=NULL WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND status='active' AND effective_to=$4`,
    [session.organizationId, definition.namespace, definition.key, rows[0].effective_from],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "configuration.schedule_cancelled", entityType: "configuration", entityId: `${definition.namespace}.${definition.key}`, metadata: { version: Number(version) } });
  return { cancelled: true };
}

/** Settings view: tenant keys only, with effective value, schedule and history. */
export async function listTenantConfiguration(client, organizationId) {
  const tenantKeys = CONFIGURATION_DEFINITIONS.filter((definition) => definition.audience === "tenant");
  const { rows } = await client.query(
    `SELECT version.namespace, version.config_key, version.value, version.version, version.status, version.effective_from, version.effective_to, version.created_at, member.full_name AS created_by_name
       FROM configuration_versions version LEFT JOIN users member ON member.id = version.created_by
      WHERE version.organization_id=$1 AND (version.namespace, version.config_key) IN (SELECT * FROM unnest($2::text[], $3::text[]))
      ORDER BY version.version DESC`,
    [organizationId, tenantKeys.map((definition) => definition.namespace), tenantKeys.map((definition) => definition.key)],
  );
  const now = Date.now();
  return tenantKeys.map((definition) => {
    const history = rows.filter((row) => row.namespace === definition.namespace && row.config_key === definition.key);
    const effective = history.find((row) => row.status === "active" && new Date(row.effective_from).getTime() <= now && (!row.effective_to || new Date(row.effective_to).getTime() > now));
    const scheduled = history.filter((row) => row.status === "active" && new Date(row.effective_from).getTime() > now);
    return {
      namespace: definition.namespace,
      key: definition.key,
      kind: definition.kind,
      label: definition.label,
      description: definition.description,
      unit: definition.unit ?? null,
      input: definition.input,
      risk: definition.risk,
      defaultValue: definition.defaultValue,
      effectiveValue: effective ? effective.value : definition.defaultValue,
      isDefault: !effective,
      scheduled: scheduled.map((row) => ({ version: row.version, value: row.value, effectiveFrom: row.effective_from })),
      history: history.slice(0, 20).map((row) => ({ version: row.version, value: row.value, status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, createdAt: row.created_at, createdByName: row.created_by_name })),
    };
  });
}
