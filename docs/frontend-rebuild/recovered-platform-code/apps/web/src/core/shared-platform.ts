import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { PoolClient } from "pg";

import type { WorkspaceSessionContext } from "@/core/auth";
import { query, transaction } from "@/core/db";
import { HttpError } from "@/core/http";

const API_KEY_PREFIX = "vlk_live_";
const API_KEY_TOKEN_BYTES = 32;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SCOPES = 32;
const MAX_SCOPE_LENGTH = 120;

export type PlatformOAuthProvider = "google" | "microsoft";

type OAuthProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
};

function text(value: unknown, name: string, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new HttpError(400, `${name} is required.`);
  if (normalized.length > maximum)
    throw new HttpError(400, `${name} is too long.`);
  return normalized;
}

function optionalText(value: unknown, maximum = 2_000) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maximum)
    throw new HttpError(400, "The submitted text is too long.");
  return normalized;
}

function scopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((scope) => String(scope).trim())
    .filter(Boolean)
    .map((scope) => {
      if (scope.length > MAX_SCOPE_LENGTH || !/^[A-Za-z0-9._:/-]+$/.test(scope)) {
        throw new HttpError(400, "An integration scope is invalid.");
      }
      return scope;
    });
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_SCOPES)
    throw new HttpError(400, "Too many integration scopes were requested.");
  return unique;
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function createTenantApiKeyMaterial() {
  const secret = randomBytes(API_KEY_TOKEN_BYTES).toString("base64url");
  const token = `${API_KEY_PREFIX}${secret}`;
  return Object.freeze({
    token,
    prefix: token.slice(0, API_KEY_PREFIX.length + 8),
    hash: hash(token),
  });
}

export function apiKeyHash(token: string) {
  const normalized = String(token || "").trim();
  if (!normalized.startsWith(API_KEY_PREFIX) || normalized.length < 40) {
    throw new HttpError(401, "The API key is invalid.", "PLATFORM_API_KEY_INVALID");
  }
  return hash(normalized);
}

export async function createDeveloperApiKey(
  session: WorkspaceSessionContext,
  input: {
    name?: unknown;
    description?: unknown;
    scopes?: unknown;
    expiresAt?: unknown;
  },
) {
  const name = text(input.name, "API key name", 120);
  const description = optionalText(input.description, 1_000) || "";
  const normalizedScopes = scopes(input.scopes);
  const expiresAt = input.expiresAt ? new Date(String(input.expiresAt)) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
    throw new HttpError(400, "API key expiry must be a future timestamp.");
  }
  const key = createTenantApiKeyMaterial();
  const appId = randomUUID();
  const keyId = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO developer_apps(id,organization_id,name,description,created_by)
       VALUES($1,$2,$3,$4,$5)`,
      [appId, session.organizationId, name, description, session.userId],
    );
    await client.query(
      `INSERT INTO api_keys(
         id,organization_id,developer_app_id,name,key_prefix,key_hash,scopes,expires_at,created_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7::text[],$8,$9)`,
      [
        keyId,
        session.organizationId,
        appId,
        name,
        key.prefix,
        key.hash,
        normalizedScopes,
        expiresAt,
        session.userId,
      ],
    );
  });
  return { id: keyId, developerAppId: appId, token: key.token, prefix: key.prefix, scopes: normalizedScopes, expiresAt };
}

export async function listDeveloperApiKeys(organizationId: string) {
  return query<{
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    status: string;
    expires_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
  }>(
    `SELECT key.id,key.name,key.key_prefix,key.scopes,key.status,key.expires_at,key.last_used_at,key.created_at
       FROM api_keys key
      WHERE key.organization_id=$1
      ORDER BY key.created_at DESC,key.id DESC`,
    [organizationId],
  );
}

export async function revokeDeveloperApiKey(
  session: WorkspaceSessionContext,
  idValue: string,
) {
  const id = text(idValue, "API key id", 80);
  const rows = await query<{ id: string }>(
    `UPDATE api_keys
        SET status='revoked',revoked_at=COALESCE(revoked_at,now())
      WHERE id=$1 AND organization_id=$2 AND status='active'
      RETURNING id`,
    [id, session.organizationId],
  );
  if (!rows[0]) throw new HttpError(404, "Active API key not found.");
}

export async function authenticateTenantApiKey(token: string) {
  const keyHash = apiKeyHash(token);
  const rows = await query<{
    id: string;
    organization_id: string;
    developer_app_id: string | null;
    scopes: string[];
  }>(
    `UPDATE api_keys
        SET last_used_at=now()
      WHERE key_hash=$1 AND status='active'
        AND (expires_at IS NULL OR expires_at>now())
      RETURNING id,organization_id,developer_app_id,scopes`,
    [keyHash],
  );
  if (!rows[0]) throw new HttpError(401, "The API key is invalid or expired.", "PLATFORM_API_KEY_INVALID");
  return rows[0];
}

export async function requireTenantApiScope(request: Request, requiredScope: string) {
  const authorization = String(request.headers.get("authorization") || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, "A tenant API key is required.", "PLATFORM_API_KEY_REQUIRED");
  const principal = await authenticateTenantApiKey(match[1]);
  const required = text(requiredScope, "API scope", 120);
  const granted = Array.isArray(principal.scopes) ? principal.scopes.map(String) : [];
  if (!granted.includes("*") && !granted.includes(required)) {
    throw new HttpError(403, `The API key does not grant ${required}.`, "PLATFORM_API_SCOPE_DENIED");
  }
  return principal;
}

function oauthConfig(provider: PlatformOAuthProvider): OAuthProviderConfig {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = String(process.env[`${prefix}_OAUTH_CLIENT_ID`] || "").trim();
  const clientSecret = String(process.env[`${prefix}_OAUTH_CLIENT_SECRET`] || "").trim();
  if (!clientId || !clientSecret) {
    throw new HttpError(
      503,
      `${provider === "google" ? "Google" : "Microsoft"} OAuth is not configured by the operator.`,
      "PLATFORM_OAUTH_NOT_CONFIGURED",
    );
  }
  return provider === "google"
    ? {
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientId,
        clientSecret,
      }
    : {
        authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientId,
        clientSecret,
      };
}

function encryptionKey() {
  const raw = String(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new HttpError(
      503,
      "Integration token encryption is not configured.",
      "PLATFORM_TOKEN_ENCRYPTION_NOT_CONFIGURED",
    );
  }
  const candidate = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (candidate.length !== 32) {
    throw new HttpError(503, "Integration token encryption key must be exactly 32 bytes.");
  }
  return candidate;
}

export function encryptIntegrationCredentials(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptIntegrationCredentials(value: unknown) {
  const payload = value as {
    algorithm?: string;
    iv?: string;
    tag?: string;
    ciphertext?: string;
  };
  if (payload?.algorithm !== "A256GCM" || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new HttpError(500, "Stored integration credentials are invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(decrypted) as Record<string, unknown>;
}

export async function beginOAuthConnection(
  session: WorkspaceSessionContext,
  provider: PlatformOAuthProvider,
  input: { redirectUri?: unknown; scopes?: unknown },
) {
  const config = oauthConfig(provider);
  const redirectUri = text(input.redirectUri, "OAuth redirect URI", 1_000);
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new HttpError(400, "OAuth redirect URI is invalid.");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new HttpError(400, "OAuth redirect URI must use HTTPS in production.");
  }
  const requestedScopes = scopes(input.scopes);
  const state = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO oauth_states(
       organization_id,user_id,provider,state_hash,redirect_uri,requested_scopes,expires_at
     ) VALUES($1,$2,$3,$4,$5,$6::text[],$7)`,
    [
      session.organizationId,
      session.userId,
      provider,
      hash(state),
      parsed.toString(),
      requestedScopes,
      new Date(Date.now() + OAUTH_STATE_TTL_MS),
    ],
  );
  const authorize = new URL(config.authorizeUrl);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", parsed.toString());
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", state);
  if (requestedScopes.length) authorize.searchParams.set("scope", requestedScopes.join(" "));
  if (provider === "google") {
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
  }
  return { state, authorizeUrl: authorize.toString(), expiresInSeconds: OAUTH_STATE_TTL_MS / 1000 };
}

export async function completeOAuthConnection(
  session: WorkspaceSessionContext,
  provider: PlatformOAuthProvider,
  input: { state?: unknown; code?: unknown },
) {
  const config = oauthConfig(provider);
  const state = text(input.state, "OAuth state", 500);
  const code = text(input.code, "OAuth authorization code", 2_000);

  // Consume the one-time state in its own short transaction before any network I/O.
  // Provider calls never hold database locks open. A failed exchange requires a new
  // authorization attempt instead of leaving a reusable state token behind.
  const current = await transaction(async (client) => {
    const stateRow = await client.query<{
      id: string;
      redirect_uri: string;
      requested_scopes: string[];
    }>(
      `UPDATE oauth_states
          SET consumed_at=now()
        WHERE organization_id=$1 AND user_id=$2 AND provider=$3
          AND state_hash=$4 AND consumed_at IS NULL AND expires_at>now()
        RETURNING id,redirect_uri,requested_scopes`,
      [session.organizationId, session.userId, provider, hash(state)],
    );
    const claimed = stateRow.rows[0];
    if (!claimed) throw new HttpError(409, "OAuth state is invalid, expired, or already used.");
    return claimed;
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: current.redirect_uri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new HttpError(502, "OAuth provider token exchange failed. Start a new connection attempt.", "PLATFORM_OAUTH_EXCHANGE_FAILED");
  }
  const expiresIn = Number(payload.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
  const encrypted = encryptIntegrationCredentials({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    tokenType: payload.token_type || null,
    scope: payload.scope || current.requested_scopes.join(" "),
    receivedAt: new Date().toISOString(),
  });
  const result = await query<{ id: string }>(
    `INSERT INTO oauth_connections(
       organization_id,user_id,provider,scopes,encrypted_credentials,expires_at,status
     ) VALUES($1,$2,$3,$4::text[],$5::jsonb,$6,'active')
     ON CONFLICT (organization_id,user_id,provider) DO UPDATE SET
       scopes=EXCLUDED.scopes,
       encrypted_credentials=EXCLUDED.encrypted_credentials,
       credential_version=oauth_connections.credential_version+1,
       expires_at=EXCLUDED.expires_at,
       status='active',last_error=NULL,revoked_at=NULL,updated_at=now()
     RETURNING id`,
    [
      session.organizationId,
      session.userId,
      provider,
      current.requested_scopes,
      JSON.stringify(encrypted),
      expiresAt,
    ],
  );
  return { id: result[0].id, expiresAt };
}

export async function listOAuthConnections(organizationId: string) {
  return query<{
    id: string;
    user_id: string | null;
    provider: string;
    provider_account_label: string | null;
    scopes: string[];
    status: string;
    expires_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT id,user_id,provider,provider_account_label,scopes,status,expires_at,updated_at
       FROM oauth_connections WHERE organization_id=$1
       ORDER BY updated_at DESC,id DESC`,
    [organizationId],
  );
}

export async function revokeOAuthConnection(session: WorkspaceSessionContext, idValue: string) {
  const id = text(idValue, "OAuth connection id", 80);
  const rows = await query<{ id: string }>(
    `UPDATE oauth_connections
        SET status='revoked',revoked_at=COALESCE(revoked_at,now()),updated_at=now()
      WHERE id=$1 AND organization_id=$2 AND status<>'revoked'
      RETURNING id`,
    [id, session.organizationId],
  );
  if (!rows[0]) throw new HttpError(404, "OAuth connection not found.");
}

export async function setNotificationPreference(
  session: WorkspaceSessionContext,
  input: { channel?: unknown; category?: unknown; enabled?: unknown; quietHoursStart?: unknown; quietHoursEnd?: unknown },
) {
  const channel = text(input.channel, "Notification channel", 30);
  if (!(["in_app", "email", "push"] as const).includes(channel as "in_app" | "email" | "push")) {
    throw new HttpError(400, "Notification channel is invalid.");
  }
  const category = text(input.category, "Notification category", 120);
  const enabled = input.enabled !== false;
  await query(
    `INSERT INTO notification_preferences(
       organization_id,user_id,channel,category,enabled,quiet_hours_start,quiet_hours_end
     ) VALUES($1,$2,$3,$4,$5,$6::time,$7::time)
     ON CONFLICT (organization_id,user_id,channel,category) DO UPDATE SET
       enabled=EXCLUDED.enabled,quiet_hours_start=EXCLUDED.quiet_hours_start,
       quiet_hours_end=EXCLUDED.quiet_hours_end,updated_at=now()`,
    [
      session.organizationId,
      session.userId,
      channel,
      category,
      enabled,
      input.quietHoursStart ? String(input.quietHoursStart) : null,
      input.quietHoursEnd ? String(input.quietHoursEnd) : null,
    ],
  );
}

export async function listNotificationPreferences(session: WorkspaceSessionContext) {
  return query<{
    channel: string;
    category: string;
    enabled: boolean;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    updated_at: Date;
  }>(
    `SELECT channel,category,enabled,quiet_hours_start::text,quiet_hours_end::text,updated_at
       FROM notification_preferences
      WHERE organization_id=$1 AND user_id=$2
      ORDER BY category,channel`,
    [session.organizationId, session.userId],
  );
}

function inboundMailSecret() {
  const secret = String(process.env.INBOUND_MAIL_WEBHOOK_SECRET || "").trim();
  if (secret.length < 32) {
    throw new HttpError(503, "Inbound mail webhook signing is not configured.", "PLATFORM_INBOUND_MAIL_NOT_CONFIGURED");
  }
  return secret;
}

export function verifyInboundMailSignature(rawBody: Uint8Array, signatureValue: string | null) {
  const supplied = String(signatureValue || "").trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(supplied)) {
    throw new HttpError(401, "Inbound mail signature is invalid.", "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID");
  }
  const expected = createHmac("sha256", inboundMailSecret()).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new HttpError(401, "Inbound mail signature is invalid.", "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID");
  }
}

export async function recordInboundMailEvent(input: {
  organizationId: string;
  provider: string;
  providerMessageId: string;
  routeKey: string;
  sender?: string | null;
  subject?: string | null;
  payloadDigest: string;
}) {
  const provider = text(input.provider, "Inbound mail provider", 80);
  const providerMessageId = text(input.providerMessageId, "Provider message id", 240);
  const routeKey = text(input.routeKey, "Inbound route key", 160);
  if (!/^[0-9a-f]{64}$/i.test(input.payloadDigest)) throw new HttpError(400, "Inbound payload digest is invalid.");
  const rows = await query<{ id: string }>(
    `INSERT INTO inbound_mail_events(
       organization_id,provider,provider_message_id,route_key,sender_hash,subject,payload_digest
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id,provider,provider_message_id) DO NOTHING
     RETURNING id`,
    [
      input.organizationId,
      provider,
      providerMessageId,
      routeKey,
      input.sender ? hash(String(input.sender).trim().toLowerCase()) : null,
      optionalText(input.subject, 500),
      input.payloadDigest.toLowerCase(),
    ],
  );
  if (rows[0]) return { id: rows[0].id, replayed: false };
  const existing = await query<{ id: string; payload_digest: string }>(
    `SELECT id,payload_digest FROM inbound_mail_events
      WHERE organization_id=$1 AND provider=$2 AND provider_message_id=$3`,
    [input.organizationId, provider, providerMessageId],
  );
  if (!existing[0]) {
    throw new HttpError(409, "Inbound mail idempotency replay could not be resolved.", "PLATFORM_INBOUND_MAIL_REPLAY_MISSING");
  }
  if (String(existing[0].payload_digest).toLowerCase() !== input.payloadDigest.toLowerCase()) {
    throw new HttpError(409, "The provider message id was reused with different inbound-mail content.", "PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT");
  }
  return { id: existing[0].id, replayed: true };
}


export async function createTagDefinition(
  session: WorkspaceSessionContext,
  input: { entityType?: unknown; name?: unknown; color?: unknown },
) {
  const entityType = text(input.entityType, "Tag entity type", 120);
  const name = text(input.name, "Tag name", 120);
  const color = input.color == null ? null : optionalText(input.color, 40);
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new HttpError(400, "Tag color must be a six-digit hexadecimal colour.");
  }
  const rows = await query<{ id: string; entity_type: string; name: string; color: string | null }>(
    `INSERT INTO tag_definitions(organization_id,entity_type,name,color,created_by)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (organization_id,entity_type,name) DO UPDATE SET
       color=EXCLUDED.color,status='active',updated_at=now()
     RETURNING id,entity_type,name,color`,
    [session.organizationId, entityType, name, color, session.userId],
  );
  return rows[0];
}

export async function listTagDefinitions(organizationId: string, entityTypeValue?: string) {
  const entityType = entityTypeValue ? text(entityTypeValue, "Tag entity type", 120) : null;
  return query<{ id: string; entity_type: string; name: string; color: string | null; status: string; updated_at: Date }>(
    `SELECT id,entity_type,name,color,status,updated_at
       FROM tag_definitions
      WHERE organization_id=$1 AND ($2::text IS NULL OR entity_type=$2)
      ORDER BY entity_type,name,id`,
    [organizationId, entityType],
  );
}

export async function assignEntityTag(
  session: WorkspaceSessionContext,
  input: { tagId?: unknown; entityType?: unknown; entityId?: unknown },
) {
  const tagId = text(input.tagId, "Tag id", 80);
  const entityType = text(input.entityType, "Tagged entity type", 120);
  const entityId = text(input.entityId, "Tagged entity id", 240);
  const rows = await query<{ tag_id: string }>(
    `INSERT INTO entity_tags(organization_id,tag_id,entity_type,entity_id,assigned_by)
     SELECT $1,tag.id,$3,$4,$5
       FROM tag_definitions tag
      WHERE tag.id=$2 AND tag.organization_id=$1 AND tag.entity_type=$3 AND tag.status='active'
     ON CONFLICT (organization_id,tag_id,entity_type,entity_id) DO NOTHING
     RETURNING tag_id`,
    [session.organizationId, tagId, entityType, entityId, session.userId],
  );
  if (!rows[0]) {
    const existing = await query<{ tag_id: string }>(
      `SELECT entity_tag.tag_id
         FROM entity_tags entity_tag
         JOIN tag_definitions tag ON tag.id=entity_tag.tag_id AND tag.organization_id=entity_tag.organization_id
        WHERE entity_tag.organization_id=$1 AND entity_tag.tag_id=$2
          AND entity_tag.entity_type=$3 AND entity_tag.entity_id=$4 AND tag.status='active'`,
      [session.organizationId, tagId, entityType, entityId],
    );
    if (!existing[0]) throw new HttpError(404, "Active tag definition not found for this entity type.");
    return { tagId, replayed: true };
  }
  return { tagId, replayed: false };
}

export async function removeEntityTag(
  session: WorkspaceSessionContext,
  input: { tagId?: unknown; entityType?: unknown; entityId?: unknown },
) {
  const tagId = text(input.tagId, "Tag id", 80);
  const entityType = text(input.entityType, "Tagged entity type", 120);
  const entityId = text(input.entityId, "Tagged entity id", 240);
  await query(
    `DELETE FROM entity_tags
      WHERE organization_id=$1 AND tag_id=$2 AND entity_type=$3 AND entity_id=$4`,
    [session.organizationId, tagId, entityType, entityId],
  );
}

export async function listEntityTags(organizationId: string, entityTypeValue: string, entityIdValue: string) {
  const entityType = text(entityTypeValue, "Tagged entity type", 120);
  const entityId = text(entityIdValue, "Tagged entity id", 240);
  return query<{ id: string; name: string; color: string | null; assigned_at: Date }>(
    `SELECT tag.id,tag.name,tag.color,entity_tag.assigned_at
       FROM entity_tags entity_tag
       JOIN tag_definitions tag ON tag.id=entity_tag.tag_id AND tag.organization_id=entity_tag.organization_id
      WHERE entity_tag.organization_id=$1 AND entity_tag.entity_type=$2 AND entity_tag.entity_id=$3
        AND tag.status='active'
      ORDER BY tag.name,tag.id`,
    [organizationId, entityType, entityId],
  );
}

export async function getEffectiveConfiguration(
  organizationId: string,
  namespaceValue: string,
  keyValue: string,
  at = new Date(),
) {
  const namespace = text(namespaceValue, "Configuration namespace", 120);
  const configKey = text(keyValue, "Configuration key", 160);
  const rows = await query<{ value: unknown; version: number; effective_from: Date }>(
    `SELECT value,version,effective_from
       FROM configuration_versions
      WHERE organization_id=$1 AND namespace=$2 AND config_key=$3 AND status='active'
        AND effective_from<=$4 AND (effective_to IS NULL OR effective_to>$4)
      ORDER BY version DESC LIMIT 1`,
    [organizationId, namespace, configKey, at],
  );
  return rows[0] || null;
}

export async function listConfigurationVersions(organizationId: string, namespaceValue?: string) {
  const namespace = namespaceValue ? text(namespaceValue, "Configuration namespace", 120) : null;
  return query<{
    id: string; namespace: string; config_key: string; value: unknown;
    effective_from: Date; effective_to: Date | null; version: number; status: string; created_at: Date;
  }>(
    `SELECT id,namespace,config_key,value,effective_from,effective_to,version,status,created_at
       FROM configuration_versions
      WHERE organization_id=$1 AND ($2::text IS NULL OR namespace=$2)
      ORDER BY namespace,config_key,version DESC LIMIT 500`,
    [organizationId, namespace],
  );
}

export async function writeConfigurationVersion(
  session: WorkspaceSessionContext,
  input: { namespace?: unknown; key?: unknown; value?: unknown; effectiveFrom?: unknown },
) {
  const namespace = text(input.namespace, "Configuration namespace", 120);
  const configKey = text(input.key, "Configuration key", 160);
  const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date();
  if (!Number.isFinite(effectiveFrom.getTime())) throw new HttpError(400, "Configuration effective timestamp is invalid.");
  const value = input.value ?? null;
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [session.organizationId, `configuration:${namespace}:${configKey}`],
    );
    const version = await client.query<{ next_version: number }>(
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
      throw new HttpError(409, "A configuration version already starts at or after this timestamp. Cancel or reorder the scheduled version first.");
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
    const result = await client.query<{ id: string; version: number }>(
      `INSERT INTO configuration_versions(
         organization_id,namespace,config_key,value,effective_from,version,status,created_by
       ) VALUES($1,$2,$3,$4::jsonb,$5,$6,'active',$7)
       RETURNING id,version`,
      [
        session.organizationId,
        namespace,
        configKey,
        JSON.stringify(value),
        effectiveFrom,
        version.rows[0].next_version,
        session.userId,
      ],
    );
    return result.rows[0];
  });
}

export async function setFeatureFlag(
  session: WorkspaceSessionContext,
  input: { key?: unknown; enabled?: unknown; rules?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown },
) {
  const flagKey = text(input.key, "Feature flag key", 160);
  const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date();
  const effectiveTo = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
  if (!Number.isFinite(effectiveFrom.getTime()) || (effectiveTo && !Number.isFinite(effectiveTo.getTime()))) {
    throw new HttpError(400, "Feature flag effective timestamp is invalid.");
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) throw new HttpError(400, "Feature flag end must be after its start.");
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [session.organizationId, `feature-flag:${flagKey}`],
    );
    const current = await client.query<{ version: number }>(
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
      throw new HttpError(409, "A feature-flag version already starts at or after this timestamp. Reorder the scheduled version first.");
    }
    await client.query(
      `UPDATE feature_flags SET effective_to=$3,updated_at=now()
        WHERE organization_id=$1 AND flag_key=$2 AND effective_from<$3
          AND (effective_to IS NULL OR effective_to>$3)`,
      [session.organizationId, flagKey, effectiveFrom],
    );
    const version = (current.rows[0]?.version || 0) + 1;
    const result = await client.query<{ id: string; version: number }>(
      `INSERT INTO feature_flags(
         organization_id,flag_key,enabled,rules,effective_from,effective_to,version,updated_by
       ) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
       RETURNING id,version`,
      [
        session.organizationId,
        flagKey,
        input.enabled === true,
        JSON.stringify(input.rules ?? {}),
        effectiveFrom,
        effectiveTo,
        version,
        session.userId,
      ],
    );
    return result.rows[0];
  });
}

export async function listFeatureFlags(organizationId: string) {
  return query<{
    id: string; flag_key: string; enabled: boolean; rules: Record<string, unknown>;
    effective_from: Date; effective_to: Date | null; version: number; updated_at: Date;
  }>(
    `SELECT id,flag_key,enabled,rules,effective_from,effective_to,version,updated_at
       FROM feature_flags WHERE organization_id=$1
      ORDER BY flag_key,version DESC,id DESC LIMIT 500`,
    [organizationId],
  );
}

export async function isFeatureFlagEnabled(
  organizationId: string,
  flagKeyValue: string,
  context: { roleSlugs?: string[]; userId?: string } = {},
) {
  const flagKey = text(flagKeyValue, "Feature flag key", 160);
  const rows = await query<{ enabled: boolean; rules: Record<string, unknown> }>(
    `SELECT enabled,rules FROM feature_flags
      WHERE organization_id=$1 AND flag_key=$2 AND effective_from<=now()
        AND (effective_to IS NULL OR effective_to>now())
      ORDER BY version DESC LIMIT 1`,
    [organizationId, flagKey],
  );
  const flag = rows[0];
  if (!flag?.enabled) return false;
  const allowedRoles = Array.isArray(flag.rules?.roles) ? flag.rules.roles.map(String) : [];
  if (allowedRoles.length && !context.roleSlugs?.some((role) => allowedRoles.includes(role))) return false;
  const allowedUsers = Array.isArray(flag.rules?.users) ? flag.rules.users.map(String) : [];
  if (allowedUsers.length && (!context.userId || !allowedUsers.includes(context.userId))) return false;
  return true;
}

const PRIVACY_TRANSITIONS: Record<string, string[]> = {
  received: ["verified", "rejected", "cancelled"],
  verified: ["in_progress", "rejected", "cancelled"],
  in_progress: ["completed", "rejected", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function assertPrivacyTransition(current: string, next: string) {
  if (!(PRIVACY_TRANSITIONS[current] || []).includes(next)) {
    throw new HttpError(409, `Privacy request cannot move from ${current} to ${next}.`);
  }
}

export async function createPrivacyRequest(
  session: WorkspaceSessionContext,
  input: { requestType?: unknown; subjectReference?: unknown; payload?: unknown },
) {
  const requestType = text(input.requestType, "Privacy request type", 80);
  if (![
    "access",
    "export",
    "correction",
    "restriction",
    "erasure",
    "consent_withdrawal",
  ].includes(requestType)) throw new HttpError(400, "Privacy request type is invalid.");
  const subjectReference = text(input.subjectReference, "Subject reference", 240);
  const rows = await query<{ id: string; status: string }>(
    `INSERT INTO privacy_requests(
       organization_id,request_type,subject_reference,request_payload,requested_by
     ) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id,status`,
    [session.organizationId, requestType, subjectReference, JSON.stringify(input.payload ?? {}), session.userId],
  );
  return rows[0];
}

export async function transitionPrivacyRequest(
  session: WorkspaceSessionContext,
  idValue: string,
  nextValue: string,
  resultPayload?: unknown,
) {
  const id = text(idValue, "Privacy request id", 80);
  const next = text(nextValue, "Privacy request status", 40);
  return transaction(async (client) => {
    const locked = await client.query<{ status: string }>(
      `SELECT status FROM privacy_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [id, session.organizationId],
    );
    const current = locked.rows[0];
    if (!current) throw new HttpError(404, "Privacy request not found.");
    assertPrivacyTransition(current.status, next);
    const rows = await client.query<{ status: string; completed_at: Date | null }>(
      `UPDATE privacy_requests SET status=$3,result_payload=$4::jsonb,
         completed_at=CASE WHEN $3='completed' THEN now() ELSE completed_at END,
         updated_at=now()
       WHERE id=$1 AND organization_id=$2 RETURNING status,completed_at`,
      [id, session.organizationId, next, resultPayload == null ? null : JSON.stringify(resultPayload)],
    );
    return rows.rows[0];
  });
}

export async function listPrivacyRequests(organizationId: string) {
  return query<{
    id: string; request_type: string; subject_reference: string; status: string;
    requested_by: string | null; assigned_to: string | null; requested_at: Date; completed_at: Date | null; updated_at: Date;
  }>(
    `SELECT id,request_type,subject_reference,status,requested_by,assigned_to,requested_at,completed_at,updated_at
       FROM privacy_requests WHERE organization_id=$1
       ORDER BY requested_at DESC,id DESC LIMIT 250`,
    [organizationId],
  );
}

export async function writeRetentionPolicy(
  session: WorkspaceSessionContext,
  input: { dataClass?: unknown; retentionDays?: unknown; legalBasis?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown },
) {
  const dataClass = text(input.dataClass, "Privacy data class", 120);
  const retentionDays = Number(input.retentionDays);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
    throw new HttpError(400, "Retention days must be an integer between 1 and 36500.");
  }
  const legalBasis = text(input.legalBasis, "Privacy legal basis", 500);
  const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date();
  const effectiveTo = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
  if (!Number.isFinite(effectiveFrom.getTime()) || (effectiveTo && !Number.isFinite(effectiveTo.getTime()))) {
    throw new HttpError(400, "Privacy policy effective timestamp is invalid.");
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) throw new HttpError(400, "Privacy policy end must be after its start.");
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [session.organizationId, `retention:${dataClass}`]);
    const current = await client.query<{ version: number }>(
      `SELECT version FROM privacy_retention_policies
        WHERE organization_id=$1 AND data_class=$2 ORDER BY version DESC LIMIT 1`,
      [session.organizationId, dataClass],
    );
    const later = await client.query(
      `SELECT 1 FROM privacy_retention_policies
        WHERE organization_id=$1 AND data_class=$2 AND effective_from >= $3
        LIMIT 1`,
      [session.organizationId, dataClass, effectiveFrom],
    );
    if (later.rows[0]) {
      throw new HttpError(409, "A retention-policy version already starts at or after this timestamp. Reorder the scheduled version first.");
    }
    await client.query(
      `UPDATE privacy_retention_policies SET effective_to=$3
        WHERE organization_id=$1 AND data_class=$2 AND effective_from<$3
          AND (effective_to IS NULL OR effective_to>$3)`,
      [session.organizationId, dataClass, effectiveFrom],
    );
    const version = (current.rows[0]?.version || 0) + 1;
    const rows = await client.query<{ id: string; version: number }>(
      `INSERT INTO privacy_retention_policies(
         organization_id,data_class,retention_days,legal_basis,effective_from,effective_to,version,created_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version`,
      [session.organizationId,dataClass,retentionDays,legalBasis,effectiveFrom,effectiveTo,version,session.userId],
    );
    return rows.rows[0];
  });
}

export async function listRetentionPolicies(organizationId: string) {
  return query<{
    id: string; data_class: string; retention_days: number; legal_basis: string;
    effective_from: Date; effective_to: Date | null; version: number; created_at: Date;
  }>(
    `SELECT id,data_class,retention_days,legal_basis,effective_from,effective_to,version,created_at
       FROM privacy_retention_policies WHERE organization_id=$1
      ORDER BY data_class,version DESC,id DESC LIMIT 500`,
    [organizationId],
  );
}

const PLATFORM_REPORT_DATASETS = Object.freeze({
  "crm.leads": { permission: "crm.reports.view", route: "/crm/reports", label: "CRM reports" },
  "sales.orders": { permission: "sales.reports.view", route: "/sales/reports", label: "Sales reports" },
  "procurement.orders": { permission: "procurement.reports.view", route: "/procurement/reports", label: "Procurement reports" },
  "accounting.journals": { permission: "accounting.reports.view", route: "/accounting/reports", label: "Accounting reports" },
} as const);

type PlatformReportDatasetKey = keyof typeof PLATFORM_REPORT_DATASETS;

export function assertPlatformReportDataset(datasetKey: string): PlatformReportDatasetKey {
  if (!(datasetKey in PLATFORM_REPORT_DATASETS)) {
    throw new HttpError(400, "The report dataset is not registered for shared reporting.");
  }
  return datasetKey as PlatformReportDatasetKey;
}

function sessionHasPermission(session: WorkspaceSessionContext, permission: string) {
  return session.roleSlugs.includes("organization_owner") || session.permissions.includes(permission);
}

function requireReportDatasetPermission(session: WorkspaceSessionContext, datasetKey: PlatformReportDatasetKey) {
  const dataset = PLATFORM_REPORT_DATASETS[datasetKey];
  if (!sessionHasPermission(session, dataset.permission)) {
    throw new HttpError(403, `You do not have permission to open ${dataset.label}.`);
  }
  return dataset;
}

export function listPlatformReportDatasets(session: WorkspaceSessionContext) {
  return Object.entries(PLATFORM_REPORT_DATASETS)
    .filter(([, value]) => sessionHasPermission(session, value.permission))
    .map(([key, value]) => ({ key, ...value }));
}

export async function createReportDefinition(
  session: WorkspaceSessionContext,
  input: { name?: unknown; datasetKey?: unknown; columns?: unknown; filters?: unknown; schedule?: unknown },
) {
  const name = text(input.name, "Report name", 160);
  const datasetKey = assertPlatformReportDataset(text(input.datasetKey, "Report dataset", 160));
  requireReportDatasetPermission(session, datasetKey);
  if (!Array.isArray(input.columns) || input.columns.length > 100) {
    throw new HttpError(400, "Report columns must be an array of at most 100 entries.");
  }
  if (input.schedule != null) {
    throw new HttpError(409, "Scheduled report delivery is not enabled in T01. Save a manual report definition instead.", "PLATFORM_REPORT_SCHEDULE_UNAVAILABLE");
  }
  const rows = await query<{ id: string }>(
    `INSERT INTO report_definitions(
       organization_id,name,dataset_key,columns,filters,schedule,created_by
     ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,NULL,$6) RETURNING id`,
    [
      session.organizationId,
      name,
      datasetKey,
      JSON.stringify(input.columns),
      JSON.stringify(input.filters ?? {}),
      session.userId,
    ],
  );
  return rows[0];
}

export async function listReportDefinitions(organizationId: string) {
  return query<{
    id: string; name: string; dataset_key: string; columns: unknown; filters: unknown; schedule: unknown; status: string; updated_at: Date;
  }>(
    `SELECT id,name,dataset_key,columns,filters,schedule,status,updated_at
       FROM report_definitions WHERE organization_id=$1
       ORDER BY updated_at DESC,id DESC LIMIT 250`,
    [organizationId],
  );
}

export async function createReportRun(
  session: WorkspaceSessionContext,
  input: { reportDefinitionId?: unknown; datasetKey?: unknown; filters?: unknown },
) {
  const definitionId = input.reportDefinitionId ? text(input.reportDefinitionId, "Report definition id", 80) : null;
  let datasetKey = input.datasetKey ? text(input.datasetKey, "Report dataset", 160) : "";
  if (definitionId) {
    const rows = await query<{ dataset_key: string }>(
      `SELECT dataset_key FROM report_definitions WHERE id=$1 AND organization_id=$2 AND status='active'`,
      [definitionId, session.organizationId],
    );
    if (!rows[0]) throw new HttpError(404, "Active report definition not found.");
    datasetKey = rows[0].dataset_key;
  }
  const registeredKey = assertPlatformReportDataset(datasetKey);
  const dataset = requireReportDatasetPermission(session, registeredKey);
  const rows = await query<{ id: string; status: string; output_reference: string | null }>(
    `INSERT INTO report_runs(
       organization_id,report_definition_id,dataset_key,filters,status,output_reference,requested_by,started_at,completed_at
     ) VALUES($1,$2,$3,$4::jsonb,'succeeded',$5,$6,now(),now())
     RETURNING id,status,output_reference`,
    [session.organizationId,definitionId,registeredKey,JSON.stringify(input.filters ?? {}),dataset.route,session.userId],
  );
  return rows[0];
}

export async function listReportRuns(organizationId: string) {
  return query<{
    id: string; report_definition_id: string | null; dataset_key: string; status: string;
    output_reference: string | null; requested_at: Date; completed_at: Date | null;
  }>(
    `SELECT id,report_definition_id,dataset_key,status,output_reference,requested_at,completed_at
       FROM report_runs WHERE organization_id=$1
      ORDER BY requested_at DESC,id DESC LIMIT 250`,
    [organizationId],
  );
}

export function assertAiActionPolicy(input: {
  enabled: boolean;
  allowRead: boolean;
  allowPropose: boolean;
  allowExecute: boolean;
  requiresApproval: boolean;
  requestType: "read" | "propose" | "execute";
}) {
  if (!input.enabled) throw new HttpError(403, "AI is disabled by organization policy.", "AI_POLICY_DISABLED");
  if (input.requestType === "read" && !input.allowRead) throw new HttpError(403, "AI read access is disabled by policy.");
  if (input.requestType === "propose" && !input.allowPropose) throw new HttpError(403, "AI proposals are disabled by policy.");
  if (input.requestType === "execute") {
    if (!input.allowExecute) throw new HttpError(403, "AI execution is disabled by policy.");
    if (input.requiresApproval) throw new HttpError(409, "AI execution requires a normal approval request before the business command can run.", "AI_APPROVAL_REQUIRED");
  }
}

export async function setAiPolicy(
  session: WorkspaceSessionContext,
  input: {
    policyKey?: unknown; enabled?: unknown; allowRead?: unknown; allowPropose?: unknown;
    allowExecute?: unknown; requiresApproval?: unknown; allowedTools?: unknown; dataClasses?: unknown;
  },
) {
  const policyKey = text(input.policyKey, "AI policy key", 160);
  const allowedTools = scopes(input.allowedTools);
  const dataClasses = scopes(input.dataClasses);
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [session.organizationId, `ai-policy:${policyKey}`]);
    const current = await client.query<{ version: number }>(
      `SELECT version FROM ai_policies WHERE organization_id=$1 AND policy_key=$2 ORDER BY version DESC LIMIT 1`,
      [session.organizationId, policyKey],
    );
    const version = (current.rows[0]?.version || 0) + 1;
    const rows = await client.query<{ id: string; version: number }>(
      `INSERT INTO ai_policies(
         organization_id,policy_key,enabled,allow_read,allow_propose,allow_execute,requires_approval,allowed_tools,data_classes,version,updated_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10,$11) RETURNING id,version`,
      [
        session.organizationId,policyKey,input.enabled !== false,input.allowRead !== false,input.allowPropose !== false,
        input.allowExecute === true,input.requiresApproval !== false,allowedTools,dataClasses,version,session.userId,
      ],
    );
    return rows.rows[0];
  });
}

export async function listAiPolicies(organizationId: string) {
  return query<{
    id: string; policy_key: string; enabled: boolean; allow_read: boolean; allow_propose: boolean; allow_execute: boolean;
    requires_approval: boolean; allowed_tools: string[]; data_classes: string[]; version: number; updated_at: Date;
  }>(
    `SELECT DISTINCT ON (policy_key) id,policy_key,enabled,allow_read,allow_propose,allow_execute,requires_approval,allowed_tools,data_classes,version,updated_at
       FROM ai_policies WHERE organization_id=$1 ORDER BY policy_key,version DESC`,
    [organizationId],
  );
}

export async function recordAiEvaluation(
  session: WorkspaceSessionContext,
  input: { aiRequestId?: unknown; evaluationKey?: unknown; score?: unknown; threshold?: unknown; evidence?: unknown },
) {
  const aiRequestId = text(input.aiRequestId, "AI request id", 80);
  const evaluationKey = text(input.evaluationKey, "AI evaluation key", 160);
  const score = Number(input.score);
  const threshold = input.threshold == null ? null : Number(input.threshold);
  if (!Number.isFinite(score) || (threshold != null && !Number.isFinite(threshold))) {
    throw new HttpError(400, "AI evaluation score/threshold is invalid.");
  }
  const passed = threshold == null ? true : score >= threshold;
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_evaluations(organization_id,ai_request_id,evaluation_key,score,threshold,passed,evidence)
     SELECT $1,request.id,$3,$4,$5,$6,$7::jsonb FROM ai_requests request
      WHERE request.id=$2 AND request.organization_id=$1 RETURNING id`,
    [session.organizationId,aiRequestId,evaluationKey,score,threshold,passed,JSON.stringify(input.evidence ?? {})],
  );
  if (!rows[0]) throw new HttpError(404, "AI request not found.");
  return { id: rows[0].id, passed };
}

export async function recordAiRequest(
  session: WorkspaceSessionContext,
  input: {
    policyKey?: unknown;
    requestType?: unknown;
    prompt?: unknown;
    contextManifest?: unknown;
    provenance?: unknown;
    modelIdentifier?: unknown;
    actionKey?: unknown;
  },
) {
  const policyKey = text(input.policyKey, "AI policy key", 160);
  const requestType = text(input.requestType, "AI request type", 30) as "read" | "propose" | "execute";
  if (!["read", "propose", "execute"].includes(requestType)) throw new HttpError(400, "AI request type is invalid.");
  const policies = await query<{
    enabled: boolean;
    allow_read: boolean;
    allow_propose: boolean;
    allow_execute: boolean;
    requires_approval: boolean;
    allowed_tools: string[];
  }>(
    `SELECT enabled,allow_read,allow_propose,allow_execute,requires_approval,allowed_tools
       FROM ai_policies
      WHERE organization_id=$1 AND policy_key=$2
      ORDER BY version DESC LIMIT 1`,
    [session.organizationId, policyKey],
  );
  const policy = policies[0];
  if (!policy) {
    throw new HttpError(403, "AI is disabled until an organization policy is configured.", "AI_POLICY_MISSING");
  }
  assertAiActionPolicy({
    enabled: policy.enabled,
    allowRead: policy.allow_read,
    allowPropose: policy.allow_propose,
    allowExecute: policy.allow_execute,
    requiresApproval: policy.requires_approval,
    requestType,
  });
  const actionKey = optionalText(input.actionKey, 160);
  const allowedTools = Array.isArray(policy.allowed_tools) ? policy.allowed_tools.map(String) : [];
  if (actionKey && allowedTools.length && !allowedTools.includes(actionKey)) {
    throw new HttpError(403, `AI tool ${actionKey} is not allowed by organization policy.`, "AI_TOOL_DENIED");
  }
  const prompt = text(input.prompt, "AI prompt", 20_000);
  const rows = await query<{ id: string; status: string }>(
    `INSERT INTO ai_requests(
       organization_id,user_id,policy_key,request_type,prompt_hash,context_manifest,provenance,model_identifier,status,action_key
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'received',$9)
     RETURNING id,status`,
    [
      session.organizationId,
      session.userId,
      policyKey,
      requestType,
      hash(prompt),
      JSON.stringify(input.contextManifest ?? {}),
      JSON.stringify(input.provenance ?? []),
      optionalText(input.modelIdentifier, 240),
      actionKey,
    ],
  );
  return rows[0];
}

export async function executeWorkflowRun(
  client: PoolClient,
  session: WorkspaceSessionContext,
  input: { workflowId?: unknown; triggerKey?: unknown; entityType?: unknown; entityId?: unknown; idempotencyKey?: unknown; payload?: unknown },
) {
  const workflowId = text(input.workflowId, "Workflow id", 80);
  const triggerKey = text(input.triggerKey, "Workflow trigger", 120);
  const entityType = text(input.entityType, "Workflow entity type", 120);
  const entityId = text(input.entityId, "Workflow entity id", 240);
  const idempotencyKey = text(input.idempotencyKey, "Workflow idempotency key", 240);

  const definition = await client.query<{ id: string; definition: Record<string, unknown> }>(
    `SELECT id,definition FROM workflow_definitions
      WHERE id=$1 AND organization_id=$2 AND status='active'`,
    [workflowId, session.organizationId],
  );
  if (!definition.rows[0]) throw new HttpError(404, "Active workflow definition not found.");

  const run = await client.query<{ id: string }>(
    `INSERT INTO workflow_runs(
       organization_id,workflow_id,trigger_key,entity_type,entity_id,idempotency_key,status,input_payload,started_at,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,'running',$7::jsonb,now(),$8)
     ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id`,
    [session.organizationId, workflowId, triggerKey, entityType, entityId, idempotencyKey, JSON.stringify(input.payload ?? {}), session.userId],
  );
  if (!run.rows[0]) {
    const existing = await client.query<{ id: string; status: string; output_payload: unknown }>(
      `SELECT id,status,output_payload FROM workflow_runs
        WHERE organization_id=$1 AND idempotency_key=$2`,
      [session.organizationId, idempotencyKey],
    );
    if (!existing.rows[0]) throw new HttpError(409, "Workflow idempotency replay could not be resolved.");
    return { replayed: true, ...existing.rows[0] };
  }

  // T01 deliberately restricts the generic engine to shared-platform side effects.
  // Business state changes must remain normal module commands/approvals.
  const actions = Array.isArray(definition.rows[0].definition?.actions)
    ? definition.rows[0].definition.actions
    : [];
  const output: Array<Record<string, unknown>> = [];
  for (const rawAction of actions) {
    const action = rawAction as Record<string, unknown>;
    const type = String(action.type || "");
    if (type === "notify") {
      const userId = text(action.userId, "Workflow notification user", 80);
      const title = text(action.title, "Workflow notification title", 200);
      const message = text(action.message, "Workflow notification message", 2_000);
      await client.query(
        `INSERT INTO notifications(organization_id,user_id,type,title,message,href)
         SELECT $1,$2,'workflow',$3,$4,$5
         WHERE EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active')
           AND COALESCE((SELECT enabled FROM notification_preferences
             WHERE organization_id=$1 AND user_id=$2 AND channel='in_app' AND category='workflow'),true)`,
        [session.organizationId, userId, title, message, optionalText(action.href, 500)],
      );
      output.push({ type, userId });
      continue;
    }
    if (type === "approval") {
      output.push({ type, status: "requires_normal_approval_command" });
      continue;
    }
    throw new HttpError(409, `Workflow action ${type || "(missing)"} is not allowed by the shared-platform engine.`);
  }
  await client.query(
    `UPDATE workflow_runs SET status='succeeded',output_payload=$3::jsonb,finished_at=now(),updated_at=now()
      WHERE id=$1 AND organization_id=$2`,
    [run.rows[0].id, session.organizationId, JSON.stringify(output)],
  );
  return { replayed: false, id: run.rows[0].id, status: "succeeded", outputPayload: output };
}
