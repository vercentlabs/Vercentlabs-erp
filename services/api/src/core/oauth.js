// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/shared-platform.ts (OAuth slice). Highest security-sensitivity
// module in the platform port; re-reviewed line-by-line, not weakened:
//   - the one-time state token is consumed inside its own transaction
//     BEFORE any network call, so no DB lock is held across the provider
//     fetch and a failed exchange cannot leave a reusable state behind.
//   - the OAuth redirect URI must be HTTPS in production.
//   - integration credentials are encrypted at rest with AES-256-GCM using
//     a mandatory, exactly-32-byte key.
//   - the state token has a 10 minute TTL.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SCOPES = 32;
const MAX_SCOPE_LENGTH = 120;

export class OAuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "OAuthError";
    this.status = status;
    this.code = code;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new OAuthError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new OAuthError(400, `${name} is too long.`);
  return normalized;
}

function scopes(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((scope) => String(scope).trim())
    .filter(Boolean)
    .map((scope) => {
      if (scope.length > MAX_SCOPE_LENGTH || !/^[A-Za-z0-9._:/-]+$/.test(scope)) {
        throw new OAuthError(400, "An integration scope is invalid.");
      }
      return scope;
    });
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_SCOPES) throw new OAuthError(400, "Too many integration scopes were requested.");
  return unique;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function oauthConfig(provider, env) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = String(env[`${prefix}_OAUTH_CLIENT_ID`] || "").trim();
  const clientSecret = String(env[`${prefix}_OAUTH_CLIENT_SECRET`] || "").trim();
  if (!clientId || !clientSecret) {
    throw new OAuthError(
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

function encryptionKey(env) {
  const raw = String(env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new OAuthError(503, "Integration token encryption is not configured.", "PLATFORM_TOKEN_ENCRYPTION_NOT_CONFIGURED");
  const candidate = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (candidate.length !== 32) throw new OAuthError(503, "Integration token encryption key must be exactly 32 bytes.");
  return candidate;
}

export function encryptIntegrationCredentials(value, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptIntegrationCredentials(payload, env = process.env) {
  if (payload?.algorithm !== "A256GCM" || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new OAuthError(500, "Stored integration credentials are invalid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted);
}

export async function beginOAuthConnection(client, session, provider, input, env = process.env) {
  const config = oauthConfig(provider, env);
  const redirectUri = text(input.redirectUri, "OAuth redirect URI", 1_000);
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new OAuthError(400, "OAuth redirect URI is invalid.");
  }
  if (env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new OAuthError(400, "OAuth redirect URI must use HTTPS in production.");
  }
  const requestedScopes = scopes(input.scopes);
  const state = randomBytes(32).toString("base64url");
  await client.query(
    `INSERT INTO oauth_states(
       organization_id,user_id,provider,state_hash,redirect_uri,requested_scopes,expires_at
     ) VALUES($1,$2,$3,$4,$5,$6::text[],$7)`,
    [session.organizationId, session.userId, provider, hash(state), parsed.toString(), requestedScopes, new Date(Date.now() + OAUTH_STATE_TTL_MS)],
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

export async function completeOAuthConnection(client, session, provider, input, env = process.env) {
  const config = oauthConfig(provider, env);
  const state = text(input.state, "OAuth state", 500);
  const code = text(input.code, "OAuth authorization code", 2_000);

  // The one-time state is consumed in its own statement before any network
  // I/O so a provider-call failure never leaves a reusable state token.
  const stateResult = await client.query(
    `UPDATE oauth_states
        SET consumed_at=now()
      WHERE organization_id=$1 AND user_id=$2 AND provider=$3
        AND state_hash=$4 AND consumed_at IS NULL AND expires_at>now()
      RETURNING id,redirect_uri,requested_scopes`,
    [session.organizationId, session.userId, provider, hash(state)],
  );
  const claimed = stateResult.rows[0];
  if (!claimed) throw new OAuthError(409, "OAuth state is invalid, expired, or already used.");

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: claimed.redirect_uri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new OAuthError(502, "OAuth provider token exchange failed. Start a new connection attempt.", "PLATFORM_OAUTH_EXCHANGE_FAILED");
  }
  const expiresIn = Number(payload.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
  const encrypted = encryptIntegrationCredentials(
    {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      tokenType: payload.token_type || null,
      scope: payload.scope || claimed.requested_scopes.join(" "),
      receivedAt: new Date().toISOString(),
    },
    env,
  );
  const result = await client.query(
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
    [session.organizationId, session.userId, provider, claimed.requested_scopes, JSON.stringify(encrypted), expiresAt],
  );
  return { id: result.rows[0].id, expiresAt };
}

export async function listOAuthConnections(client, organizationId) {
  const result = await client.query(
    `SELECT id,user_id,provider,provider_account_label,scopes,status,expires_at,updated_at
       FROM oauth_connections WHERE organization_id=$1
       ORDER BY updated_at DESC,id DESC`,
    [organizationId],
  );
  return result.rows;
}

export async function revokeOAuthConnection(client, session, idValue) {
  const id = text(idValue, "OAuth connection id", 80);
  const result = await client.query(
    `UPDATE oauth_connections
        SET status='revoked',revoked_at=COALESCE(revoked_at,now()),updated_at=now()
      WHERE id=$1 AND organization_id=$2 AND status<>'revoked'
      RETURNING id`,
    [id, session.organizationId],
  );
  if (!result.rows[0]) throw new OAuthError(404, "OAuth connection not found.");
}
