// OAuth connected accounts: Authorization Code + PKCE (S256) for registered
// profiles, with a server-owned callback URI.
//
// Security properties (kept from T01, extended):
//   - one-time state, stored as a SHA-256 hash, 10-minute TTL, consumed in
//     its own short transaction BEFORE any provider call;
//   - the PKCE verifier is AES-256-GCM encrypted at rest and cleared on use;
//   - redirect_uri = APP_URL + fixed callback path (never browser-supplied);
//     the post-connect landing page is an allow-listed internal path;
//   - provider calls happen outside any database transaction, with timeouts;
//   - tokens are AES-256-GCM encrypted at rest and never returned to a client;
//   - refresh only when a caller needs a token, rotation preserved, a revoked
//     or invalid grant becomes "reconnect_required".
// Connections are owned by the user who connected them.
import { createHash, randomBytes } from "node:crypto";

import { audit, canonicalAppOrigin } from "../../../security.js";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "../secrets.js";
import { getOAuthProfile, OAUTH_PROFILES, OAUTH_RETURN_PREFIXES } from "./profiles.js";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 15_000;
const REFRESH_MARGIN_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OAuthError extends Error {
  constructor(status, message, code = "PLATFORM_OAUTH_ERROR") {
    super(message);
    this.name = "OAuthError";
    this.status = status;
    this.code = code;
  }
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

// Provider endpoints. OAUTH_STANDIN_URL points both providers at the local
// deterministic stand-in (tests/support/oauth-standin.mjs) and is refused in
// production.
function providerConfig(provider, env) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = String(env[`${prefix}_OAUTH_CLIENT_ID`] || "").trim();
  const clientSecret = String(env[`${prefix}_OAUTH_CLIENT_SECRET`] || "").trim();
  if (!clientId || !clientSecret) {
    throw new OAuthError(503, `${provider === "google" ? "Google" : "Microsoft"} sign-in is not configured by the operator.`, "PLATFORM_OAUTH_NOT_CONFIGURED");
  }
  const standin = String(env.OAUTH_STANDIN_URL || "").trim().replace(/\/+$/, "");
  if (standin) {
    if (env.NODE_ENV === "production") throw new OAuthError(503, "The OAuth stand-in cannot be used in production.", "PLATFORM_OAUTH_NOT_CONFIGURED");
    return { authorizeUrl: `${standin}/${provider}/authorize`, tokenUrl: `${standin}/${provider}/token`, clientId, clientSecret };
  }
  return provider === "google"
    ? { authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", clientId, clientSecret }
    : { authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token", clientId, clientSecret };
}

export function oauthCallbackUri(provider, env = process.env) {
  return `${canonicalAppOrigin(env)}/api/settings/integrations/oauth/callback/${provider}`;
}

export function safeReturnPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) return OAUTH_RETURN_PREFIXES[0];
  return OAUTH_RETURN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`)) ? path : OAUTH_RETURN_PREFIXES[0];
}

export function oauthProfilesStatus(env = process.env) {
  return OAUTH_PROFILES.map((profile) => {
    let configured = true;
    try {
      providerConfig(profile.provider, env);
    } catch {
      configured = false;
    }
    return { key: profile.key, provider: profile.provider, label: profile.label, description: profile.description, scopes: [...profile.scopes], configured };
  });
}

/** Starts an attempt; the browser is sent to `authorizeUrl`. */
export async function beginOAuthConnection(client, session, input, env = process.env) {
  const profile = getOAuthProfile(input?.profile);
  if (!profile) throw new OAuthError(400, "Choose a supported connection.", "PLATFORM_OAUTH_PROFILE_UNKNOWN");
  const config = providerConfig(profile.provider, env);
  const redirectUri = oauthCallbackUri(profile.provider, env);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  await client.query(
    `INSERT INTO oauth_states (organization_id, user_id, provider, state_hash, redirect_uri, requested_scopes, expires_at, profile_key, encrypted_code_verifier, return_path)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9::jsonb,$10)`,
    [session.organizationId, session.userId, profile.provider, hash(state), redirectUri, [...profile.scopes], new Date(Date.now() + OAUTH_STATE_TTL_MS), profile.key,
      JSON.stringify(encryptIntegrationCredentials({ verifier }, env)), safeReturnPath(input?.returnPath)],
  );
  const authorize = new URL(config.authorizeUrl);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", profile.scopes.join(" "));
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  if (profile.provider === "google") {
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
  }
  return { authorizeUrl: authorize.toString(), expiresInSeconds: OAUTH_STATE_TTL_MS / 1000 };
}

/**
 * Step 1 of the callback (its own short transaction): consume the one-time
 * state for this user and provider. Returns what the token exchange needs.
 */
export async function consumeOAuthState(client, session, provider, stateValue, env = process.env) {
  const state = String(stateValue || "").trim();
  if (!state || state.length > 500) throw new OAuthError(400, "The connection attempt is invalid.", "PLATFORM_OAUTH_STATE_INVALID");
  const { rows } = await client.query(
    `WITH claimed AS (
       SELECT id, encrypted_code_verifier FROM oauth_states
        WHERE organization_id=$1 AND user_id=$2 AND provider=$3 AND state_hash=$4 AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE
     )
     UPDATE oauth_states state SET consumed_at=now(), encrypted_code_verifier=NULL
       FROM claimed WHERE state.id = claimed.id
     RETURNING state.redirect_uri, state.profile_key, state.return_path, claimed.encrypted_code_verifier AS verifier`,
    [session.organizationId, session.userId, String(provider), hash(state)],
  );
  const row = rows[0];
  if (!row || !row.verifier || !getOAuthProfile(row.profile_key)) {
    throw new OAuthError(409, "This connection attempt is invalid, expired or already used. Start again.", "PLATFORM_OAUTH_STATE_INVALID");
  }
  return {
    profileKey: row.profile_key,
    redirectUri: row.redirect_uri,
    returnPath: safeReturnPath(row.return_path),
    codeVerifier: decryptIntegrationCredentials(row.verifier, env).verifier,
  };
}

function decodeIdTokenClaims(idToken) {
  // The id_token comes straight from the provider's token endpoint over TLS,
  // so its claims are trusted for labelling the account (OIDC Core 3.1.3.7).
  try {
    const [, payload] = String(idToken || "").split(".");
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : {};
  } catch {
    return {};
  }
}

function validateTokenResponse(payload) {
  if (!payload || typeof payload.access_token !== "string" || !payload.access_token || payload.access_token.length > 8000) return false;
  if (payload.token_type && String(payload.token_type).toLowerCase() !== "bearer") return false;
  if (payload.refresh_token !== undefined && typeof payload.refresh_token !== "string") return false;
  if (payload.expires_in !== undefined && !Number.isFinite(Number(payload.expires_in))) return false;
  return true;
}

async function tokenRequest(config, parameters) {
  let response;
  try {
    response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return { ok: false, transient: true, error: "provider_unreachable" };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = typeof payload?.error === "string" ? payload.error.slice(0, 80) : `http_${response.status}`;
    return { ok: false, transient: response.status >= 500 || response.status === 429, error };
  }
  if (!validateTokenResponse(payload)) return { ok: false, transient: false, error: "invalid_token_response" };
  return { ok: true, payload };
}

/** Step 2 of the callback: redeem the code with the PKCE verifier. No DB. */
export async function exchangeOAuthCode(profileKey, { code, redirectUri, codeVerifier }, env = process.env) {
  const profile = getOAuthProfile(profileKey);
  if (!profile) throw new OAuthError(400, "Unsupported connection.", "PLATFORM_OAUTH_PROFILE_UNKNOWN");
  const authorizationCode = String(code || "").trim();
  if (!authorizationCode || authorizationCode.length > 4000) throw new OAuthError(400, "The provider did not return an authorization code.", "PLATFORM_OAUTH_CODE_MISSING");
  const result = await tokenRequest(providerConfig(profile.provider, env), { grant_type: "authorization_code", code: authorizationCode, redirect_uri: redirectUri, code_verifier: codeVerifier });
  if (!result.ok) throw new OAuthError(502, "The provider refused the connection. Start again.", "PLATFORM_OAUTH_EXCHANGE_FAILED");
  const claims = decodeIdTokenClaims(result.payload.id_token);
  return {
    profileKey: profile.key,
    provider: profile.provider,
    accountId: typeof claims.sub === "string" ? claims.sub.slice(0, 200) : null,
    accountLabel: typeof claims.email === "string" ? claims.email.slice(0, 320) : typeof claims.name === "string" ? claims.name.slice(0, 200) : null,
    grantedScopes: String(result.payload.scope || profile.scopes.join(" ")).split(/\s+/).filter(Boolean).slice(0, 32),
    tokens: {
      accessToken: result.payload.access_token,
      refreshToken: result.payload.refresh_token || null,
      tokenType: "Bearer",
      receivedAt: new Date().toISOString(),
    },
    expiresAt: Number(result.payload.expires_in) > 0 ? new Date(Date.now() + Number(result.payload.expires_in) * 1000) : null,
  };
}

/** Step 3 of the callback (its own short transaction): store the connection. */
export async function saveOAuthConnection(client, session, exchanged, env = process.env) {
  const encrypted = encryptIntegrationCredentials(exchanged.tokens, env);
  const { rows } = await client.query(
    `INSERT INTO oauth_connections (organization_id, user_id, provider, profile_key, provider_account_id, provider_account_label, scopes, encrypted_credentials, expires_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8::jsonb,$9,'active')
     ON CONFLICT (organization_id, user_id, provider) DO UPDATE SET
       profile_key=EXCLUDED.profile_key, provider_account_id=EXCLUDED.provider_account_id, provider_account_label=EXCLUDED.provider_account_label,
       scopes=EXCLUDED.scopes, encrypted_credentials=EXCLUDED.encrypted_credentials, credential_version=oauth_connections.credential_version+1,
       expires_at=EXCLUDED.expires_at, status='active', last_error=NULL, last_error_at=NULL, revoked_at=NULL, updated_at=now()
     RETURNING id`,
    [session.organizationId, session.userId, exchanged.provider, exchanged.profileKey, exchanged.accountId, exchanged.accountLabel, exchanged.grantedScopes, JSON.stringify(encrypted), exchanged.expiresAt],
  );
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "integration.oauth_connected",
    entityType: "oauth_connection",
    entityId: rows[0].id,
    metadata: { provider: exchanged.provider, profile: exchanged.profileKey, account: exchanged.accountLabel },
  });
  return { id: rows[0].id };
}

function connectionDto(row) {
  const profile = getOAuthProfile(row.profile_key);
  return {
    id: row.id,
    provider: row.provider,
    profileKey: row.profile_key,
    profileLabel: profile?.label ?? "Connected before connection profiles",
    accountLabel: row.provider_account_label,
    connectedByUserId: row.user_id,
    connectedByName: row.user_name ?? null,
    scopes: row.scopes || [],
    status: row.profile_key === "legacy" && row.status === "active" ? "reconnect_required" : row.status,
    expiresAt: row.expires_at,
    lastRefreshedAt: row.last_refreshed_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

// Integration administrators see the organisation's inventory; anyone else
// sees only connections they made themselves. Never includes credentials.
export async function listOAuthConnections(client, organizationId, { userId = null } = {}) {
  const { rows } = await client.query(
    `SELECT connection.id, connection.user_id, connection.provider, connection.profile_key, connection.provider_account_label, connection.scopes,
            connection.status, connection.expires_at, connection.last_refreshed_at, connection.last_error, connection.updated_at,
            member.full_name AS user_name
       FROM oauth_connections connection LEFT JOIN users member ON member.id = connection.user_id
      WHERE connection.organization_id=$1 AND ($2::uuid IS NULL OR connection.user_id=$2::uuid)
      ORDER BY connection.updated_at DESC, connection.id DESC`,
    [organizationId, userId],
  );
  return rows.map(connectionDto);
}

// Revokes and wipes the stored credentials (nothing left to leak).
export async function revokeOAuthConnection(client, session, idValue, { administrator = false } = {}) {
  if (!UUID.test(String(idValue || ""))) throw new OAuthError(404, "Connection not found.", "PLATFORM_OAUTH_CONNECTION_NOT_FOUND");
  const { rows } = await client.query(
    `UPDATE oauth_connections SET status='revoked', revoked_at=COALESCE(revoked_at, now()), encrypted_credentials='{}'::jsonb, updated_at=now()
      WHERE id=$1 AND organization_id=$2 AND status<>'revoked' AND ($3::boolean OR user_id=$4)
      RETURNING id, provider, profile_key, user_id`,
    [idValue, session.organizationId, Boolean(administrator), session.userId],
  );
  if (!rows[0]) throw new OAuthError(404, "Connection not found.", "PLATFORM_OAUTH_CONNECTION_NOT_FOUND");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.oauth_revoked", entityType: "oauth_connection", entityId: rows[0].id, metadata: { provider: rows[0].provider, profile: rows[0].profile_key, connectedBy: rows[0].user_id } });
  return { id: rows[0].id, status: "revoked" };
}

/**
 * An access token for a server-side consumer, refreshed only when it is
 * about to expire. `withClient(work)` runs `work` in its own short
 * transaction; the provider call happens between two of them.
 */
export async function getOAuthAccessToken(withClient, { organizationId, connectionId }, env = process.env) {
  const read = await withClient((client) =>
    client.query(`SELECT * FROM oauth_connections WHERE organization_id=$1 AND id=$2`, [organizationId, connectionId]).then((result) => result.rows[0]),
  );
  if (!read || read.status === "revoked") throw new OAuthError(404, "Connection not found.", "PLATFORM_OAUTH_CONNECTION_NOT_FOUND");
  if (read.status === "reconnect_required" || read.profile_key === "legacy") throw new OAuthError(409, "Reconnect this account.", "PLATFORM_OAUTH_RECONNECT_REQUIRED");
  const credentials = decryptIntegrationCredentials(read.encrypted_credentials, env);
  if (!read.expires_at || new Date(read.expires_at).getTime() - REFRESH_MARGIN_MS > Date.now()) return credentials.accessToken;
  if (!credentials.refreshToken) {
    await withClient((client) => client.query(`UPDATE oauth_connections SET status='reconnect_required', last_error='No refresh token', last_error_at=now(), updated_at=now() WHERE id=$1`, [read.id]));
    throw new OAuthError(409, "Reconnect this account.", "PLATFORM_OAUTH_RECONNECT_REQUIRED");
  }

  const result = await tokenRequest(providerConfig(read.provider, env), { grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  if (!result.ok) {
    const reconnect = !result.transient;
    await withClient((client) =>
      client.query(
        `UPDATE oauth_connections SET status=CASE WHEN $2 THEN 'reconnect_required' ELSE status END, last_error=$3, last_error_at=now(), updated_at=now()
          WHERE id=$1 AND credential_version=$4`,
        [read.id, reconnect, `Refresh failed: ${result.error}`, read.credential_version],
      ),
    );
    throw reconnect
      ? new OAuthError(409, "The provider no longer accepts this connection. Reconnect the account.", "PLATFORM_OAUTH_RECONNECT_REQUIRED")
      : new OAuthError(502, "The provider is unavailable. Try again later.", "PLATFORM_OAUTH_REFRESH_FAILED");
  }
  const tokens = {
    accessToken: result.payload.access_token,
    // Providers may rotate the refresh token; keep the old one when they do not.
    refreshToken: result.payload.refresh_token || credentials.refreshToken,
    tokenType: "Bearer",
    receivedAt: new Date().toISOString(),
  };
  const expiresAt = Number(result.payload.expires_in) > 0 ? new Date(Date.now() + Number(result.payload.expires_in) * 1000) : null;
  const stored = await withClient((client) =>
    client.query(
      `UPDATE oauth_connections SET encrypted_credentials=$2::jsonb, credential_version=credential_version+1, expires_at=$3, last_refreshed_at=now(),
              status='active', last_error=NULL, last_error_at=NULL, updated_at=now()
        WHERE id=$1 AND credential_version=$4 AND status<>'revoked' RETURNING id`,
      [read.id, JSON.stringify(encryptIntegrationCredentials(tokens, env)), expiresAt, read.credential_version],
    ),
  );
  if (!stored.rows[0]) throw new OAuthError(409, "The connection changed while refreshing. Try again.", "PLATFORM_OAUTH_REFRESH_CONFLICT");
  return tokens.accessToken;
}
