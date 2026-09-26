// Developer apps and their API keys (credentials).
//
// Key material: 32 random bytes, "vlk_live_" prefix, SHA-256 hash at rest,
// the plaintext returned exactly once at issuance and never logged; lists show
// the prefix only. Revocation and expiry are status/timestamps, never deletes.
// Authentication yields an ApiPrincipal (organisation, app, key, registered
// scopes) - a machine identity with no human roles or permissions.
import { createHash, randomBytes } from "node:crypto";

import { audit } from "../../../security.js";
import { API_SCOPES, getApiScope } from "./scopes.js";

const API_KEY_PREFIX = "vlk_live_";
const API_KEY_TOKEN_BYTES = 32;
const LAST_USED_GRANULARITY_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiKeyError extends Error {
  constructor(status, message, code = "PLATFORM_API_KEY_ERROR") {
    super(message);
    this.name = "ApiKeyError";
    this.status = status;
    this.code = code;
  }
}

function text(value, name, maximum) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ApiKeyError(400, `${name} is required.`, "PLATFORM_API_KEY_INPUT_INVALID");
  if (normalized.length > maximum) throw new ApiKeyError(400, `${name} is too long.`, "PLATFORM_API_KEY_INPUT_INVALID");
  return normalized;
}

function id(value, name) {
  if (!UUID.test(String(value || ""))) throw new ApiKeyError(404, `${name} not found.`, "PLATFORM_API_KEY_NOT_FOUND");
  return String(value);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createTenantApiKeyMaterial() {
  const token = `${API_KEY_PREFIX}${randomBytes(API_KEY_TOKEN_BYTES).toString("base64url")}`;
  return Object.freeze({ token, prefix: token.slice(0, API_KEY_PREFIX.length + 8), hash: hash(token) });
}

export function apiKeyHash(token) {
  const normalized = String(token || "").trim();
  if (!normalized.startsWith(API_KEY_PREFIX) || normalized.length < 40 || normalized.length > 200) {
    throw new ApiKeyError(401, "The API key is invalid.", "PLATFORM_API_KEY_INVALID");
  }
  return hash(normalized);
}

// Only registered scopes can be issued; "*" and unknown strings are refused.
export function normalizeApiScopes(value) {
  if (!Array.isArray(value) || value.length === 0) throw new ApiKeyError(400, "Choose at least one scope.", "PLATFORM_API_SCOPE_REQUIRED");
  const unique = [...new Set(value.map((scope) => String(scope).trim()))];
  for (const scope of unique) {
    if (!getApiScope(scope)) throw new ApiKeyError(400, `"${scope.slice(0, 80)}" is not an available API scope.`, "PLATFORM_API_SCOPE_UNKNOWN");
  }
  return unique.sort();
}

function appDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    revokedAt: row.revoked_at,
    activeKeyCount: Number(row.active_key_count ?? 0),
    lastUsedAt: row.last_used_at ?? null,
  };
}

function keyDto(row) {
  const scopes = (row.scopes || []).map(String);
  const effective = row.status === "active" && (!row.expires_at || new Date(row.expires_at) > new Date());
  return {
    id: row.id,
    developerAppId: row.developer_app_id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: scopes.filter((scope) => getApiScope(scope)),
    unrecognizedScopes: scopes.filter((scope) => !getApiScope(scope)),
    status: row.status === "active" && !effective ? "expired" : row.status,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    revokedAt: row.revoked_at,
  };
}

export async function listDeveloperApps(client, organizationId) {
  const { rows } = await client.query(
    `SELECT app.*, creator.full_name AS created_by_name,
            count(key.id) FILTER (WHERE key.status='active' AND (key.expires_at IS NULL OR key.expires_at > now()))::int AS active_key_count,
            max(key.last_used_at) AS last_used_at
       FROM developer_apps app
       LEFT JOIN api_keys key ON key.developer_app_id = app.id
       LEFT JOIN users creator ON creator.id = app.created_by
      WHERE app.organization_id=$1
      GROUP BY app.id, creator.full_name
      ORDER BY (app.status='active') DESC, app.created_at DESC`,
    [organizationId],
  );
  return rows.map(appDto);
}

async function loadApp(client, organizationId, appId, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM developer_apps WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [organizationId, id(appId, "Developer app")]);
  if (!rows[0]) throw new ApiKeyError(404, "Developer app not found.", "PLATFORM_DEVELOPER_APP_NOT_FOUND");
  return rows[0];
}

export async function createDeveloperApp(client, session, input) {
  const name = text(input?.name, "App name", 120);
  const description = String(input?.description ?? "").trim().slice(0, 1000);
  const { rows } = await client.query(
    `INSERT INTO developer_apps (organization_id, name, description, created_by, updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING *`,
    [session.organizationId, name, description, session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.developer_app_created", entityType: "developer_app", entityId: rows[0].id, afterData: { name } });
  return appDto(rows[0]);
}

export async function updateDeveloperApp(client, session, appId, input) {
  const app = await loadApp(client, session.organizationId, appId, { lock: true });
  if (app.status !== "active") throw new ApiKeyError(409, "A revoked app cannot be changed.", "PLATFORM_DEVELOPER_APP_REVOKED");
  const name = text(input?.name ?? app.name, "App name", 120);
  const description = String(input?.description ?? app.description ?? "").trim().slice(0, 1000);
  const { rows } = await client.query(`UPDATE developer_apps SET name=$2, description=$3, updated_by=$4, updated_at=now() WHERE id=$1 RETURNING *`, [app.id, name, description, session.userId]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.developer_app_updated", entityType: "developer_app", entityId: app.id, beforeData: { name: app.name }, afterData: { name } });
  return appDto(rows[0]);
}

// Revoking an app revokes every one of its keys in the same transaction.
export async function revokeDeveloperApp(client, session, appId) {
  const app = await loadApp(client, session.organizationId, appId, { lock: true });
  if (app.status !== "active") throw new ApiKeyError(409, "This app is already revoked.", "PLATFORM_DEVELOPER_APP_REVOKED");
  await client.query(`UPDATE developer_apps SET status='revoked', revoked_at=now(), revoked_by=$2, updated_at=now() WHERE id=$1`, [app.id, session.userId]);
  const keys = await client.query(
    `UPDATE api_keys SET status='revoked', revoked_at=COALESCE(revoked_at, now()), revoked_by=COALESCE(revoked_by, $3) WHERE organization_id=$1 AND developer_app_id=$2 AND status='active' RETURNING id`,
    [session.organizationId, app.id, session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.developer_app_revoked", entityType: "developer_app", entityId: app.id, metadata: { revokedKeys: keys.rows.length } });
  return { id: app.id, status: "revoked", revokedKeys: keys.rows.length };
}

export async function listApiKeys(client, organizationId, appId = null) {
  const { rows } = await client.query(
    `SELECT key.*, creator.full_name AS created_by_name FROM api_keys key LEFT JOIN users creator ON creator.id = key.created_by
      WHERE key.organization_id=$1 AND ($2::uuid IS NULL OR key.developer_app_id=$2::uuid)
      ORDER BY key.created_at DESC, key.id DESC`,
    [organizationId, appId ? id(appId, "Developer app") : null],
  );
  return rows.map(keyDto);
}

// Returns the plaintext token ONCE; only its hash is stored.
export async function createApiKey(client, session, appId, input) {
  const app = await loadApp(client, session.organizationId, appId, { lock: true });
  if (app.status !== "active") throw new ApiKeyError(409, "Keys cannot be added to a revoked app.", "PLATFORM_DEVELOPER_APP_REVOKED");
  const name = text(input?.name, "Key name", 120);
  const scopes = normalizeApiScopes(input?.scopes);
  let expiresAt = null;
  if (input?.expiresAt) {
    expiresAt = new Date(String(input.expiresAt));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new ApiKeyError(400, "The expiry must be in the future.", "PLATFORM_API_KEY_INPUT_INVALID");
  }
  const material = createTenantApiKeyMaterial();
  const { rows } = await client.query(
    `INSERT INTO api_keys (organization_id, developer_app_id, name, key_prefix, key_hash, scopes, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8) RETURNING *`,
    [session.organizationId, app.id, name, material.prefix, material.hash, scopes, expiresAt, session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.api_key_created", entityType: "api_key", entityId: rows[0].id, metadata: { developerAppId: app.id, prefix: material.prefix, scopes, expiresAt } });
  return { key: keyDto(rows[0]), token: material.token };
}

export async function revokeApiKey(client, session, keyId) {
  const { rows } = await client.query(
    `UPDATE api_keys SET status='revoked', revoked_at=now(), revoked_by=$3 WHERE organization_id=$1 AND id=$2 AND status='active' RETURNING *`,
    [session.organizationId, id(keyId, "API key"), session.userId],
  );
  if (!rows[0]) throw new ApiKeyError(404, "Active API key not found.", "PLATFORM_API_KEY_NOT_FOUND");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.api_key_revoked", entityType: "api_key", entityId: rows[0].id, metadata: { developerAppId: rows[0].developer_app_id, prefix: rows[0].key_prefix } });
  return keyDto(rows[0]);
}

/**
 * Authenticates a bearer token and returns the ApiPrincipal. The key and its
 * app must be active and unexpired. last_used_at is refreshed at most every
 * five minutes, so reads do not write on every request.
 */
export async function authenticateApiKey(client, token) {
  const keyHash = apiKeyHash(token);
  const { rows } = await client.query(
    `SELECT key.id, key.organization_id, key.developer_app_id, key.scopes, key.last_used_at, app.name AS app_name
       FROM api_keys key
       JOIN developer_apps app ON app.id = key.developer_app_id AND app.organization_id = key.organization_id
       JOIN organizations organization ON organization.id = key.organization_id
      WHERE key.key_hash=$1 AND key.status='active' AND (key.expires_at IS NULL OR key.expires_at > now())
        AND app.status='active' AND organization.status = 'active'`,
    [keyHash],
  );
  const row = rows[0];
  if (!row) throw new ApiKeyError(401, "The API key is invalid, revoked or expired.", "PLATFORM_API_KEY_INVALID");
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > LAST_USED_GRANULARITY_MS) {
    await client.query(`UPDATE api_keys SET last_used_at=now() WHERE id=$1`, [row.id]);
  }
  return Object.freeze({
    kind: "api_key",
    organizationId: row.organization_id,
    developerAppId: row.developer_app_id,
    developerAppName: row.app_name,
    apiKeyId: row.id,
    scopes: Object.freeze((row.scopes || []).map(String).filter((scope) => getApiScope(scope))),
  });
}

export function requireApiScope(principal, scope) {
  if (!getApiScope(scope)) throw new ApiKeyError(500, "The endpoint requires an unregistered scope.", "PLATFORM_API_SCOPE_UNREGISTERED");
  if (!principal?.scopes?.includes(scope)) throw new ApiKeyError(403, `This API key does not grant ${scope}.`, "PLATFORM_API_SCOPE_DENIED");
  return principal;
}

export function listApiScopes() {
  return API_SCOPES.map(({ key, displayName, description, risk }) => ({ key, displayName, description, risk }));
}
