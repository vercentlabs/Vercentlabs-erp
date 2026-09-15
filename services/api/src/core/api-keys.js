// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/shared-platform.ts (API-key slice). Security properties preserved:
// SHA-256 key hashing (plaintext token is returned to the caller exactly
// once, at issuance, and never stored); constant-length prefix reveal only
// in list views; wildcard-or-exact scope matching; revocation is a status
// flip (auditable), never a delete.
import { randomBytes, randomUUID, createHash } from "node:crypto";

const API_KEY_PREFIX = "vlk_live_";
const API_KEY_TOKEN_BYTES = 32;
const MAX_SCOPES = 32;
const MAX_SCOPE_LENGTH = 120;

export class ApiKeyError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ApiKeyError";
    this.status = status;
    this.code = code;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ApiKeyError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new ApiKeyError(400, `${name} is too long.`);
  return normalized;
}

function optionalText(value, maximum = 2_000) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new ApiKeyError(400, "The submitted text is too long.");
  return normalized;
}

function scopes(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((scope) => String(scope).trim())
    .filter(Boolean)
    .map((scope) => {
      if (scope.length > MAX_SCOPE_LENGTH || !/^[A-Za-z0-9._:/-]+$/.test(scope)) {
        throw new ApiKeyError(400, "An integration scope is invalid.");
      }
      return scope;
    });
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_SCOPES) throw new ApiKeyError(400, "Too many integration scopes were requested.");
  return unique;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createTenantApiKeyMaterial() {
  const secret = randomBytes(API_KEY_TOKEN_BYTES).toString("base64url");
  const token = `${API_KEY_PREFIX}${secret}`;
  return Object.freeze({ token, prefix: token.slice(0, API_KEY_PREFIX.length + 8), hash: hash(token) });
}

export function apiKeyHash(token) {
  const normalized = String(token || "").trim();
  if (!normalized.startsWith(API_KEY_PREFIX) || normalized.length < 40) {
    throw new ApiKeyError(401, "The API key is invalid.", "PLATFORM_API_KEY_INVALID");
  }
  return hash(normalized);
}

export async function createDeveloperApiKey(client, session, input) {
  const name = text(input.name, "API key name", 120);
  const description = optionalText(input.description, 1_000) || "";
  const normalizedScopes = scopes(input.scopes);
  const expiresAt = input.expiresAt ? new Date(String(input.expiresAt)) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
    throw new ApiKeyError(400, "API key expiry must be a future timestamp.");
  }
  const key = createTenantApiKeyMaterial();
  const appId = randomUUID();
  const keyId = randomUUID();
  await client.query(
    `INSERT INTO developer_apps(id,organization_id,name,description,created_by) VALUES($1,$2,$3,$4,$5)`,
    [appId, session.organizationId, name, description, session.userId],
  );
  await client.query(
    `INSERT INTO api_keys(
       id,organization_id,developer_app_id,name,key_prefix,key_hash,scopes,expires_at,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7::text[],$8,$9)`,
    [keyId, session.organizationId, appId, name, key.prefix, key.hash, normalizedScopes, expiresAt, session.userId],
  );
  return { id: keyId, developerAppId: appId, token: key.token, prefix: key.prefix, scopes: normalizedScopes, expiresAt };
}

export async function listDeveloperApiKeys(client, organizationId) {
  const result = await client.query(
    `SELECT key.id,key.name,key.key_prefix,key.scopes,key.status,key.expires_at,key.last_used_at,key.created_at
       FROM api_keys key
      WHERE key.organization_id=$1
      ORDER BY key.created_at DESC,key.id DESC`,
    [organizationId],
  );
  return result.rows;
}

export async function revokeDeveloperApiKey(client, session, idValue) {
  const id = text(idValue, "API key id", 80);
  const result = await client.query(
    `UPDATE api_keys
        SET status='revoked',revoked_at=COALESCE(revoked_at,now())
      WHERE id=$1 AND organization_id=$2 AND status='active'
      RETURNING id`,
    [id, session.organizationId],
  );
  if (!result.rows[0]) throw new ApiKeyError(404, "Active API key not found.");
}

export async function authenticateTenantApiKey(client, token) {
  const keyHash = apiKeyHash(token);
  const result = await client.query(
    `UPDATE api_keys
        SET last_used_at=now()
      WHERE key_hash=$1 AND status='active'
        AND (expires_at IS NULL OR expires_at>now())
      RETURNING id,organization_id,developer_app_id,scopes`,
    [keyHash],
  );
  if (!result.rows[0]) throw new ApiKeyError(401, "The API key is invalid or expired.", "PLATFORM_API_KEY_INVALID");
  return result.rows[0];
}

export async function requireTenantApiScope(client, request, requiredScope) {
  const authorization = String(request.headers.get("authorization") || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new ApiKeyError(401, "A tenant API key is required.", "PLATFORM_API_KEY_REQUIRED");
  const principal = await authenticateTenantApiKey(client, match[1]);
  const required = text(requiredScope, "API scope", 120);
  const granted = Array.isArray(principal.scopes) ? principal.scopes.map(String) : [];
  if (!granted.includes("*") && !granted.includes(required)) {
    throw new ApiKeyError(403, `The API key does not grant ${required}.`, "PLATFORM_API_SCOPE_DENIED");
  }
  return principal;
}
