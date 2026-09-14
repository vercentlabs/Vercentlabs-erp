import assert from "node:assert/strict";
import test from "node:test";

import { createTenantApiKeyMaterial, apiKeyHash, authenticateTenantApiKey, requireTenantApiScope, ApiKeyError } from "../src/core/api-keys.js";

test("createTenantApiKeyMaterial never returns the plaintext token as its own hash and prefix reveals only a bounded slice", () => {
  const key = createTenantApiKeyMaterial();
  assert.ok(key.token.startsWith("vlk_live_"));
  assert.notEqual(key.hash, key.token);
  assert.ok(key.prefix.length < key.token.length);
  assert.equal(apiKeyHash(key.token), key.hash);
});

test("apiKeyHash rejects a token without the required prefix (never hashes an arbitrary attacker-supplied string as valid)", () => {
  assert.throws(() => apiKeyHash("not-a-real-key"), (error) => error instanceof ApiKeyError && error.status === 401);
});

test("authenticateTenantApiKey rejects an unknown or expired key (fail-closed)", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    authenticateTenantApiKey(client, createTenantApiKeyMaterial().token),
    (error) => error instanceof ApiKeyError && error.status === 401 && error.code === "PLATFORM_API_KEY_INVALID",
  );
});

test("requireTenantApiScope denies a key that lacks the required scope even when authenticated", async () => {
  const client = {
    query: async () => ({
      rows: [{ id: "key-1", organization_id: "org-1", developer_app_id: "app-1", scopes: ["platform.context.read"] }],
    }),
  };
  const request = new Request("https://api.example.com/v1/x", {
    headers: { authorization: `Bearer ${createTenantApiKeyMaterial().token}` },
  });
  await assert.rejects(
    requireTenantApiScope(client, request, "integrations.manage"),
    (error) => error instanceof ApiKeyError && error.status === 403 && error.code === "PLATFORM_API_SCOPE_DENIED",
  );
});

test("requireTenantApiScope grants a wildcard-scoped key any requested scope", async () => {
  const client = {
    query: async () => ({
      rows: [{ id: "key-1", organization_id: "org-1", developer_app_id: "app-1", scopes: ["*"] }],
    }),
  };
  const request = new Request("https://api.example.com/v1/x", {
    headers: { authorization: `Bearer ${createTenantApiKeyMaterial().token}` },
  });
  const principal = await requireTenantApiScope(client, request, "anything.at.all");
  assert.equal(principal.organization_id, "org-1");
});

test("requireTenantApiScope requires a Bearer authorization header", async () => {
  const client = { query: async () => ({ rows: [] }) };
  const request = new Request("https://api.example.com/v1/x");
  await assert.rejects(
    requireTenantApiScope(client, request, "platform.context.read"),
    (error) => error instanceof ApiKeyError && error.code === "PLATFORM_API_KEY_REQUIRED",
  );
});
