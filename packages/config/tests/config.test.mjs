import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, databaseConfig, originList } from "../src/index.js";

test("database configuration validates and bounds pool controls", () => {
  const config = databaseConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/vercent", DATABASE_POOL_MAX: "24" });
  assert.equal(config.poolMaximum, 24);
  assert.throws(() => databaseConfig({ DATABASE_URL: "https://example.com" }), ConfigurationError);
});

test("production origins are canonical HTTPS origins", () => {
  assert.deepEqual(originList({ ORIGINS: "https://app.example.com,https://app.example.com" }, "ORIGINS", { httpsOnly: true }), ["https://app.example.com"]);
  assert.throws(() => originList({ ORIGINS: "http://app.example.com/path" }, "ORIGINS", { httpsOnly: true }), ConfigurationError);
});
