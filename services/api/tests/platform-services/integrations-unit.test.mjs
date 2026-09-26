// Developer API keys, OAuth and webhook signing: pure rules and fail-closed
// behaviour (the database flows are in tests/integration/platform-services/).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  API_SCOPES,
  ApiKeyError,
  apiKeyHash,
  authenticateApiKey,
  createTenantApiKeyMaterial,
  normalizeApiScopes,
  requireApiScope,
} from "../../src/core/platform/integrations/api-keys/index.js";
import { beginOAuthConnection, consumeOAuthState, OAUTH_PROFILES, oauthCallbackUri, safeReturnPath } from "../../src/core/platform/integrations/oauth/index.js";
import { createWebhookSecret, signWebhookPayload, verifyOutboundWebhookSignature } from "../../src/core/platform/integrations/webhooks/index.js";

const ENV = {
  APP_URL: "https://erp.example.com",
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  INTEGRATION_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  NODE_ENV: "test",
};
const SESSION = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222" };
const rejectsWith = (code) => (error) => error.code === code;

test("API key material: random, hashed, prefix-only reveal", () => {
  const key = createTenantApiKeyMaterial();
  assert.ok(key.token.startsWith("vlk_live_"));
  assert.notEqual(key.hash, key.token);
  assert.ok(key.prefix.length < key.token.length);
  assert.equal(apiKeyHash(key.token), key.hash);
  assert.notEqual(createTenantApiKeyMaterial().token, key.token);
  assert.throws(() => apiKeyHash("not-a-real-key"), (error) => error instanceof ApiKeyError && error.status === 401);
});

test("API scopes: only registered scopes can be issued; '*' and unknown strings are refused", () => {
  assert.deepEqual(normalizeApiScopes(["platform.context.read", "platform.context.read"]), ["platform.context.read"]);
  assert.throws(() => normalizeApiScopes(["*"]), rejectsWith("PLATFORM_API_SCOPE_UNKNOWN"));
  assert.throws(() => normalizeApiScopes(["crm.leads.write"]), rejectsWith("PLATFORM_API_SCOPE_UNKNOWN"));
  assert.throws(() => normalizeApiScopes([]), rejectsWith("PLATFORM_API_SCOPE_REQUIRED"));
  for (const scope of API_SCOPES) {
    assert.ok(scope.key && scope.displayName && scope.description && scope.risk && scope.consumedBy.length, `${scope.key} is fully described`);
  }
});

test("API authentication fails closed and a wildcard or unregistered stored scope grants nothing", async () => {
  await assert.rejects(authenticateApiKey({ query: async () => ({ rows: [] }) }, createTenantApiKeyMaterial().token), rejectsWith("PLATFORM_API_KEY_INVALID"));
  const principal = await authenticateApiKey(
    { query: async (sql) => (sql.startsWith("SELECT") ? { rows: [{ id: "k", organization_id: "o", developer_app_id: "a", app_name: "App", scopes: ["*", "made.up", "platform.context.read"], last_used_at: new Date() }] } : { rows: [] }) },
    createTenantApiKeyMaterial().token,
  );
  assert.deepEqual([...principal.scopes], ["platform.context.read"]);
  assert.equal(principal.kind, "api_key");
  assert.equal("permissions" in principal, false, "a machine principal carries no human permissions");
  assert.throws(() => requireApiScope({ ...principal, scopes: [] }, "platform.context.read"), rejectsWith("PLATFORM_API_SCOPE_DENIED"));
  assert.throws(() => requireApiScope(principal, "anything.at.all"), rejectsWith("PLATFORM_API_SCOPE_UNREGISTERED"));
});

test("last_used_at is refreshed coarsely, not on every request", async () => {
  const writes = [];
  const client = (lastUsedAt) => ({
    query: async (sql) => {
      if (sql.startsWith("UPDATE")) writes.push(sql);
      return sql.startsWith("SELECT") ? { rows: [{ id: "k", organization_id: "o", developer_app_id: "a", app_name: "App", scopes: [], last_used_at: lastUsedAt }] } : { rows: [] };
    },
  });
  await authenticateApiKey(client(new Date()), createTenantApiKeyMaterial().token);
  assert.equal(writes.length, 0);
  await authenticateApiKey(client(new Date(Date.now() - 10 * 60 * 1000)), createTenantApiKeyMaterial().token);
  assert.equal(writes.length, 1);
});

test("OAuth: fixed server callback, registered profiles only, PKCE S256, no browser redirect URI", async () => {
  const calls = [];
  const client = { query: async (sql, values) => (calls.push({ sql, values }), { rows: [] }) };
  const started = await beginOAuthConnection(client, SESSION, { profile: "google.identity", redirectUri: "https://evil.example/steal" }, ENV);
  const url = new URL(started.authorizeUrl);
  assert.equal(url.searchParams.get("redirect_uri"), "https://erp.example.com/api/settings/integrations/oauth/callback/google");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  const insert = calls[0];
  assert.equal(insert.values[4], oauthCallbackUri("google", ENV));
  assert.ok(!JSON.stringify(insert.values).includes(url.searchParams.get("state")), "only the state hash is stored");
  const sealedVerifier = JSON.parse(insert.values[8]);
  assert.equal(sealedVerifier.v, 1, "the PKCE verifier is stored as an encryption envelope");
  assert.ok(sealedVerifier.kek && sealedVerifier.dek && sealedVerifier.ciphertext);
  await assert.rejects(beginOAuthConnection(client, SESSION, { profile: "google.mail.readwrite" }, ENV), rejectsWith("PLATFORM_OAUTH_PROFILE_UNKNOWN"));
  await assert.rejects(beginOAuthConnection(client, SESSION, { profile: "google.identity" }, { ...ENV, GOOGLE_OAUTH_CLIENT_ID: "" }), rejectsWith("PLATFORM_OAUTH_NOT_CONFIGURED"));
  await assert.rejects(beginOAuthConnection(client, SESSION, { profile: "google.identity" }, { ...ENV, NODE_ENV: "production", OAUTH_STANDIN_URL: "http://127.0.0.1:1" }), rejectsWith("PLATFORM_OAUTH_NOT_CONFIGURED"));
  for (const profile of OAUTH_PROFILES) {
    assert.ok(profile.scopes.every((scope) => ["openid", "email", "profile", "offline_access"].includes(scope)), `${profile.key} is identity-only`);
  }
});

test("OAuth: return paths are internal and allow-listed", () => {
  assert.equal(safeReturnPath("/settings/integrations?tab=connected-accounts"), "/settings/integrations?tab=connected-accounts");
  for (const hostile of ["https://evil.example", "//evil.example", "/\\evil.example", "/crm/leads", "javascript:alert(1)", "/settings/integrations\r\nX: y"]) {
    assert.equal(safeReturnPath(hostile), "/settings/integrations", hostile);
  }
});

test("OAuth: an unknown, used or expired state is refused before any provider call", async () => {
  await assert.rejects(consumeOAuthState({ query: async () => ({ rows: [] }) }, SESSION, "google", "some-state", ENV), rejectsWith("PLATFORM_OAUTH_STATE_INVALID"));
  await assert.rejects(consumeOAuthState({ query: async () => ({ rows: [] }) }, SESSION, "google", "", ENV), rejectsWith("PLATFORM_OAUTH_STATE_INVALID"));
});

test("webhook signatures: deterministic v1 HMAC over delivery id, timestamp and raw body", () => {
  const secret = createWebhookSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  const input = { deliveryId: "d-1", timestamp: "1767225600", body: '{"id":"e-1"}' };
  const signature = signWebhookPayload(secret, input);
  assert.equal(signature, signWebhookPayload(secret, input));
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.ok(verifyOutboundWebhookSignature(secret, { ...input, signatureHeader: `v1=${signature}` }));
  assert.equal(verifyOutboundWebhookSignature(secret, { ...input, body: '{"id":"e-2"}', signatureHeader: `v1=${signature}` }), false);
  assert.equal(verifyOutboundWebhookSignature("whsec_other", { ...input, signatureHeader: `v1=${signature}` }), false);
});
