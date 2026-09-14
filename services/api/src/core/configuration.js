// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/shared-platform.ts (effective-dated configuration + feature-flag
// slice). Security/consistency property preserved: every write is
// serialized with pg_advisory_xact_lock keyed on (organizationId,
// namespace/flagKey) so two concurrent effective-dated writes cannot race
// and produce an inconsistent version history.
export class ConfigurationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ConfigurationError";
    this.status = status;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ConfigurationError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new ConfigurationError(400, `${name} is too long.`);
  return normalized;
}

export async function getEffectiveConfiguration(client, organizationId, namespaceValue, keyValue, at = new Date()) {
  const namespace = text(namespaceValue, "Configuration namespace", 120);
  const configKey = text(keyValue, "Configuration key", 160);
  const result = await client.query(
    `SELECT value,version,effective_from
       FROM configuration_versions
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND status='active'
        AND effective_from<=$4 AND (effective_to IS NULL OR effective_to>$4)
      ORDER BY version DESC LIMIT 1`,
    [organizationId, namespace, configKey, at],
  );
  return result.rows[0] || null;
}

export async function listConfigurationVersions(client, organizationId, namespaceValue) {
  const namespace = namespaceValue ? text(namespaceValue, "Configuration namespace", 120) : null;
  const result = await client.query(
    `SELECT id,namespace,config_key,value,effective_from,effective_to,version,status,created_at
       FROM configuration_versions
      WHERE organization_id=$1 AND ($2::text IS NULL OR namespace=$2)
      ORDER BY namespace,config_key,version DESC LIMIT 500`,
    [organizationId, namespace],
  );
  return result.rows;
}

export async function writeConfigurationVersion(client, session, input) {
  const namespace = text(input.namespace, "Configuration namespace", 120);
  const configKey = text(input.key, "Configuration key", 160);
  const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date();
  if (!Number.isFinite(effectiveFrom.getTime())) throw new ConfigurationError(400, "Configuration effective timestamp is invalid.");
  const value = input.value ?? null;

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    session.organizationId,
    `configuration:${namespace}:${configKey}`,
  ]);
  const version = await client.query(
    `SELECT COALESCE(max(version),0)+1 AS next_version
       FROM configuration_versions
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3`,
    [session.organizationId, namespace, configKey],
  );
  const later = await client.query(
    `SELECT 1 FROM configuration_versions
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3
        AND status='active' AND effective_from >= $4
      LIMIT 1`,
    [session.organizationId, namespace, configKey, effectiveFrom],
  );
  if (later.rows[0]) {
    throw new ConfigurationError(409, "A configuration version already starts at or after this timestamp. Cancel or reorder the scheduled version first.");
  }
  await client.query(
    `UPDATE configuration_versions
        SET effective_to=$4,
            status=CASE WHEN $4<=now() THEN 'superseded' ELSE status END
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3
        AND status='active' AND effective_from<$4
        AND (effective_to IS NULL OR effective_to>$4)`,
    [session.organizationId, namespace, configKey, effectiveFrom],
  );
  const result = await client.query(
    `INSERT INTO configuration_versions(
       organization_id,namespace,config_key,value,effective_from,version,status,created_by
     ) VALUES($1,$2,$3,$4::jsonb,$5,$6,'active',$7)
     RETURNING id,version`,
    [session.organizationId, namespace, configKey, JSON.stringify(value), effectiveFrom, version.rows[0].next_version, session.userId],
  );
  return result.rows[0];
}

export async function setFeatureFlag(client, session, input) {
  const flagKey = text(input.key, "Feature flag key", 160);
  const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date();
  const effectiveTo = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
  if (!Number.isFinite(effectiveFrom.getTime()) || (effectiveTo && !Number.isFinite(effectiveTo.getTime()))) {
    throw new ConfigurationError(400, "Feature flag effective timestamp is invalid.");
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) throw new ConfigurationError(400, "Feature flag end must be after its start.");

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    session.organizationId,
    `feature-flag:${flagKey}`,
  ]);
  const current = await client.query(
    `SELECT version FROM feature_flags
      WHERE organization_id=$1 AND flag_key=$2
      ORDER BY version DESC LIMIT 1`,
    [session.organizationId, flagKey],
  );
  const later = await client.query(
    `SELECT 1 FROM feature_flags
      WHERE organization_id=$1 AND flag_key=$2 AND effective_from >= $3
      LIMIT 1`,
    [session.organizationId, flagKey, effectiveFrom],
  );
  if (later.rows[0]) {
    throw new ConfigurationError(409, "A feature-flag version already starts at or after this timestamp. Reorder the scheduled version first.");
  }
  await client.query(
    `UPDATE feature_flags SET effective_to=$3,updated_at=now()
      WHERE organization_id=$1 AND flag_key=$2 AND effective_from<$3
        AND (effective_to IS NULL OR effective_to>$3)`,
    [session.organizationId, flagKey, effectiveFrom],
  );
  const version = (current.rows[0]?.version || 0) + 1;
  const result = await client.query(
    `INSERT INTO feature_flags(
       organization_id,flag_key,enabled,rules,effective_from,effective_to,version,updated_by
     ) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
     RETURNING id,version`,
    [session.organizationId, flagKey, input.enabled === true, JSON.stringify(input.rules ?? {}), effectiveFrom, effectiveTo, version, session.userId],
  );
  return result.rows[0];
}

export async function listFeatureFlags(client, organizationId) {
  const result = await client.query(
    `SELECT id,flag_key,enabled,rules,effective_from,effective_to,version,updated_at
       FROM feature_flags WHERE organization_id=$1
      ORDER BY flag_key,version DESC,id DESC LIMIT 500`,
    [organizationId],
  );
  return result.rows;
}

export async function isFeatureFlagEnabled(client, organizationId, flagKeyValue, context = {}) {
  const flagKey = text(flagKeyValue, "Feature flag key", 160);
  const result = await client.query(
    `SELECT enabled,rules FROM feature_flags
      WHERE organization_id=$1 AND flag_key=$2 AND effective_from<=now()
        AND (effective_to IS NULL OR effective_to>now())
      ORDER BY version DESC LIMIT 1`,
    [organizationId, flagKey],
  );
  const flag = result.rows[0];
  if (!flag?.enabled) return false;
  const allowedRoles = Array.isArray(flag.rules?.roles) ? flag.rules.roles.map(String) : [];
  if (allowedRoles.length && !context.roleSlugs?.some((role) => allowedRoles.includes(role))) return false;
  const allowedUsers = Array.isArray(flag.rules?.users) ? flag.rules.users.map(String) : [];
  if (allowedUsers.length && (!context.userId || !allowedUsers.includes(context.userId))) return false;
  return true;
}
