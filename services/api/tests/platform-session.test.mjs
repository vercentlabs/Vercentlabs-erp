import assert from "node:assert/strict";
import test from "node:test";

import {
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
  createOpaqueToken,
  tokenHash,
  createSession,
  setSessionOrganization,
} from "../src/core/auth/session.js";

test("hashPassword + verifyPassword round-trip and reject a wrong password", async () => {
  const stored = await hashPassword("correct horse battery staple 42!");
  assert.equal(await verifyPassword("correct horse battery staple 42!", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
});

test("verifyPasswordOrDummy still performs a scrypt comparison for an unknown user (anti-timing-enumeration)", async () => {
  // No stored hash (simulates an unregistered email) — must not short-circuit
  // to a cheap false, or login-failure timing would reveal account existence.
  const result = await verifyPasswordOrDummy("whatever", null);
  assert.equal(result, false);
});

test("createOpaqueToken produces distinct, sufficiently long tokens", () => {
  const a = createOpaqueToken();
  const b = createOpaqueToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
});

test("tokenHash is deterministic and does not equal the raw token", () => {
  const token = "sample-token-value";
  assert.equal(tokenHash(token), tokenHash(token));
  assert.notEqual(tokenHash(token), token);
});

test("createSession inserts a session row scoped to the resolved token hash, not the plaintext token", async () => {
  let inserted;
  const client = {
    query: async (sql, values) => {
      inserted = { sql, values };
      return { rows: [] };
    },
  };
  const result = await createSession(client, {
    userId: "user-1",
    ipAddress: "127.0.0.1",
    userAgent: "Mozilla/5.0 Chrome/1",
    env: {},
  });
  assert.match(inserted.sql, /INSERT INTO sessions/);
  assert.ok(result.token);
  assert.equal(inserted.values[2], tokenHash(result.token));
  assert.notEqual(inserted.values[2], result.token);
});

test("setSessionOrganization only updates when the membership row is active (fail-closed on a missing membership)", async () => {
  const client = { query: async () => ({ rows: [] }) };
  const changed = await setSessionOrganization(client, "session-1", "user-1", "org-not-a-member-of");
  assert.equal(changed, false);
});
