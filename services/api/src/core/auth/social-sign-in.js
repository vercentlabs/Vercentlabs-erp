// Sign in with Google or Microsoft (Shared Platform plan 6). OpenID Connect Authorization Code + PKCE (S256), with:
//   - a one-time state (stored as a SHA-256 hash, 10 minutes) and a nonce bound to the id_token;
//   - the id_token taken straight from the provider's token endpoint over TLS, its audience, issuer, expiry and nonce checked;
//   - an account is found only through an identity already linked to it, or — Google only — a verified email that is already a
//     user's own (the identity is then linked). Microsoft accounts are linked from the person's profile first;
//   - the same session start as a password sign-in, so two-step verification, new-device email and the login log all apply.
// Nobody is signed up this way; there is no account to create from a provider.
import { createHash, randomBytes } from "node:crypto";

import { canonicalAppOrigin } from "../security/request-security.js";
import { decryptSecret, encryptSecret } from "../platform/secrets/index.js";
import { decodeOAuthIdTokenClaims, oauthProviderConfig, oauthTokenRequest } from "../platform/integrations/oauth/index.js";

export const SIGN_IN_PROVIDERS = Object.freeze(["google", "microsoft"]);
const STATE_TTL_MS = 10 * 60 * 1000;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

export class SocialSignInError extends Error {
  constructor(status, message, code = "AUTH_SOCIAL_SIGN_IN_FAILED") {
    super(message);
    this.name = "SocialSignInError";
    this.status = status;
    this.code = code;
  }
}

const providerOf = (value) => {
  if (!SIGN_IN_PROVIDERS.includes(value)) throw new SocialSignInError(404, "Unknown sign-in provider.", "AUTH_SOCIAL_PROVIDER_UNKNOWN");
  return value;
};
export const socialSignInCallbackUri = (provider, env = process.env) => `${canonicalAppOrigin(env)}/api/auth/oauth/${provider}/callback`;
// Where the browser may land afterwards: an internal path only.
const safeReturn = (value) => (typeof value === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(value) ? value.slice(0, 300) : null);

// Which buttons the sign-in page shows: a provider the operator configured.
export function socialSignInProviders(env = process.env) {
  return SIGN_IN_PROVIDERS.filter((provider) => {
    try { oauthProviderConfig(provider, env); return true; } catch { return false; }
  });
}

// Step 1 (ingress client): remember the round trip and send the browser to the provider. purpose "link" needs the signed-in user.
export async function beginSocialSignIn(client, { provider, purpose = "sign_in", userId = null, returnTo = null }, env = process.env) {
  const name = providerOf(provider);
  if (!["sign_in", "link"].includes(purpose)) throw new SocialSignInError(400, "Unsupported request.", "AUTH_SOCIAL_SIGN_IN_FAILED");
  if (purpose === "link" && !userId) throw new SocialSignInError(401, "Sign in first.", "AUTH_REQUIRED");
  const config = oauthProviderConfig(name, env);
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));
  const nonce = base64url(randomBytes(24));
  await client.query(
    `INSERT INTO public.auth_sign_in_states (state_hash, provider, purpose, user_id, encrypted_verifier, nonce_hash, return_to, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [hash(state), name, purpose, purpose === "link" ? userId : null, JSON.stringify(await encryptSecret({ verifier }, env)), hash(nonce), safeReturn(returnTo),
      new Date(Date.now() + STATE_TTL_MS)]);
  const url = new URL(config.authorizeUrl);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: config.clientId, redirect_uri: socialSignInCallbackUri(name, env), scope: "openid email profile", state,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", nonce, prompt: "select_account",
  })) url.searchParams.set(key, value);
  return { url: url.toString() };
}

// Step 2 (ingress client, its own transaction): the state is used once, before any provider call.
export async function consumeSocialSignInState(client, provider, stateValue, env = process.env) {
  const name = providerOf(provider);
  const row = (await client.query(
    `UPDATE public.auth_sign_in_states SET used_at = now() WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now() RETURNING *`,
    [hash(stateValue ?? ""), name])).rows[0];
  if (!row) throw new SocialSignInError(400, "This sign-in link has expired. Start again.", "AUTH_SOCIAL_STATE_INVALID");
  const { verifier } = await decryptSecret(row.encrypted_verifier, env);
  return { provider: name, purpose: row.purpose, userId: row.user_id, verifier, nonceHash: row.nonce_hash, returnTo: row.return_to };
}

const ISSUER = { google: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com", microsoft: (iss) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(String(iss ?? "")) };

// Step 3 (no database): the code for the id_token, checked.
export async function exchangeSocialSignInCode(state, code, env = process.env) {
  const config = oauthProviderConfig(state.provider, env);
  const authorizationCode = String(code ?? "").trim();
  if (!authorizationCode || authorizationCode.length > 4000) throw new SocialSignInError(400, "The provider did not return a code. Start again.", "AUTH_SOCIAL_CODE_MISSING");
  const result = await oauthTokenRequest(config, { grant_type: "authorization_code", code: authorizationCode, redirect_uri: socialSignInCallbackUri(state.provider, env), code_verifier: state.verifier });
  if (!result.ok) throw new SocialSignInError(502, "The provider refused the sign-in. Start again.", "AUTH_SOCIAL_EXCHANGE_FAILED");
  const claims = decodeOAuthIdTokenClaims(result.payload.id_token);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const standin = Boolean(String(env.OAUTH_STANDIN_URL || "").trim());
  if (!audience.includes(config.clientId) || (!standin && !ISSUER[state.provider](claims.iss)) || !(Number(claims.exp) * 1000 > Date.now()) || hash(claims.nonce ?? "") !== state.nonceHash || !claims.sub)
    throw new SocialSignInError(401, "The sign-in could not be verified. Start again.", "AUTH_SOCIAL_TOKEN_INVALID");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase().slice(0, 320) : typeof claims.preferred_username === "string" && claims.preferred_username.includes("@") ? claims.preferred_username.trim().toLowerCase() : null;
  return { provider: state.provider, subject: String(claims.sub).slice(0, 200), email, emailVerified: state.provider === "google" && claims.email_verified === true };
}

// Step 4 (platform client): link (purpose "link") or find the account to sign in. Returns the user id.
export async function resolveSocialSignIn(client, state, identity) {
  const linked = (await client.query(`SELECT user_id FROM public.user_external_identities WHERE provider = $1 AND subject = $2`, [identity.provider, identity.subject])).rows[0];
  if (state.purpose === "link") {
    if (linked && linked.user_id !== state.userId) throw new SocialSignInError(409, "This account is already linked to another user.", "AUTH_SOCIAL_ALREADY_LINKED");
    await client.query(
      `INSERT INTO public.user_external_identities (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, subject) DO UPDATE SET email = EXCLUDED.email`, [state.userId, identity.provider, identity.subject, identity.email]);
    return state.userId;
  }
  let userId = linked?.user_id ?? null;
  if (!userId && identity.emailVerified && identity.email) {
    const user = (await client.query(`SELECT id FROM public.users WHERE lower(email) = $1 AND email_verified_at IS NOT NULL LIMIT 1`, [identity.email])).rows[0];
    if (user) {
      await client.query(`INSERT INTO public.user_external_identities (user_id, provider, subject, email) VALUES ($1, $2, $3, $4) ON CONFLICT (provider, subject) DO NOTHING`,
        [user.id, identity.provider, identity.subject, identity.email]);
      userId = user.id;
    }
  }
  if (!userId) throw new SocialSignInError(404, `No account is linked to this ${identity.provider === "google" ? "Google" : "Microsoft"} account. Sign in with your password, then connect it in your profile.`, "AUTH_SOCIAL_NOT_LINKED");
  const user = (await client.query(`SELECT status FROM public.users WHERE id = $1`, [userId])).rows[0];
  if (user?.status !== "active") throw new SocialSignInError(403, "This account is not active.", "AUTH_ACCOUNT_INACTIVE");
  await client.query(`UPDATE public.user_external_identities SET last_used_at = now() WHERE provider = $1 AND subject = $2`, [identity.provider, identity.subject]);
  return userId;
}

// Profile › Sign-in accounts: what the person linked, and unlinking one.
export async function listSocialIdentities(client, userId) {
  return (await client.query(`SELECT id, provider, email, created_at, last_used_at FROM public.user_external_identities WHERE user_id = $1 ORDER BY created_at`, [userId])).rows
    .map((row) => ({ id: row.id, provider: row.provider, email: row.email, linkedAt: row.created_at, lastUsedAt: row.last_used_at }));
}
export async function unlinkSocialIdentity(client, userId, identityId) {
  const removed = await client.query(`DELETE FROM public.user_external_identities WHERE id = $1 AND user_id = $2`, [String(identityId ?? ""), userId]).catch(() => ({ rowCount: 0 }));
  if (!removed.rowCount) throw new SocialSignInError(404, "Not found.", "AUTH_SOCIAL_IDENTITY_NOT_FOUND");
  return { unlinked: true };
}
