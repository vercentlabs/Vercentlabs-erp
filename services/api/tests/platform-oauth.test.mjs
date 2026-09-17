import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { beginOAuthConnection, completeOAuthConnection, encryptIntegrationCredentials, decryptIntegrationCredentials, OAuthError } from "../src/core/oauth.js";

const ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  INTEGRATION_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  NODE_ENV: "test",
};

test("beginOAuthConnection throws 503 when the provider is not configured by the operator", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    beginOAuthConnection(client, { organizationId: "org-1", userId: "user-1" }, "google", { redirectUri: "https://app.example.com/callback" }, {}),
    (error) => error instanceof OAuthError && error.status === 503 && error.code === "PLATFORM_OAUTH_NOT_CONFIGURED",
  );
});

test("beginOAuthConnection requires HTTPS redirect URIs in production", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    beginOAuthConnection(
      client,
      { organizationId: "org-1", userId: "user-1" },
      "google",
      { redirectUri: "http://app.example.com/callback" },
      { ...ENV, NODE_ENV: "production" },
    ),
    (error) => error instanceof OAuthError && error.status === 400,
  );
});

test("completeOAuthConnection rejects when the state token was never issued, already consumed, or expired (fail-closed, single-use)", async () => {
  const client = { query: async () => ({ rows: [] }) }; // UPDATE ... RETURNING finds no row
  await assert.rejects(
    completeOAuthConnection(client, { organizationId: "org-1", userId: "user-1" }, "google", { state: "unknown-state", code: "auth-code" }, ENV),
    (error) => error instanceof OAuthError && error.status === 409,
  );
});

test("completeOAuthConnection consumes the state in a single UPDATE before any network call — the query never leaves the state re-claimable", async () => {
  let consumeQuerySeen = false;
  const client = {
    query: async (sql) => {
      if (/UPDATE oauth_states/.test(sql)) {
        consumeQuerySeen = true;
        assert.match(sql, /consumed_at IS NULL/);
        assert.match(sql, /expires_at>now\(\)/);
        return { rows: [] }; // simulate already consumed / not found
      }
      return { rows: [] };
    },
  };
  await assert.rejects(
    completeOAuthConnection(client, { organizationId: "org-1", userId: "user-1" }, "google", { state: "replayed-state", code: "auth-code" }, ENV),
  );
  assert.equal(consumeQuerySeen, true);
});

test("encryptIntegrationCredentials/decryptIntegrationCredentials round-trip with AES-256-GCM and a mandatory 32-byte key", () => {
  const secret = { accessToken: "at-1", refreshToken: "rt-1" };
  const encrypted = encryptIntegrationCredentials(secret, ENV);
  assert.equal(encrypted.algorithm, "A256GCM");
  const decrypted = decryptIntegrationCredentials(encrypted, ENV);
  assert.deepEqual(decrypted, secret);
});

test("encryptIntegrationCredentials throws when no encryption key is configured (fail-closed, never stores plaintext)", () => {
  assert.throws(() => encryptIntegrationCredentials({ accessToken: "x" }, { NODE_ENV: "test" }), OAuthError);
});
