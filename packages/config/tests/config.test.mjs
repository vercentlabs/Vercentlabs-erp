import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, WORKSPACE_EMAILS, databaseConfig, originList } from "../src/index.js";

test("company email identities use role-based Workspace addresses", () => {
  assert.equal(WORKSPACE_EMAILS.primary, WORKSPACE_EMAILS.sales);
  assert.equal(WORKSPACE_EMAILS.primary, "sales@vercentlabs.com");
  assert.equal(WORKSPACE_EMAILS.authentication, "auth@vercentlabs.com");

  for (const email of Object.values(WORKSPACE_EMAILS)) {
    assert.match(email, /^[a-z]+@vercentlabs\.com$/);
  }
});

test("database configuration validates and bounds pool controls", () => {
  const config = databaseConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/vercentlabs", DATABASE_POOL_MAX: "24" });
  assert.equal(config.poolMaximum, 24);
  assert.throws(() => databaseConfig({ DATABASE_URL: "https://example.com" }), ConfigurationError);
});

test("production origins are canonical HTTPS origins", () => {
  assert.deepEqual(originList({ ORIGINS: "https://app.example.com,https://app.example.com" }, "ORIGINS", { httpsOnly: true }), ["https://app.example.com"]);
  assert.throws(() => originList({ ORIGINS: "http://app.example.com/path" }, "ORIGINS", { httpsOnly: true }), ConfigurationError);
});
