import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDbSsl } from "./db-ssl.ts";

test("no TLS unless DATABASE_SSL=true", () => {
  assert.equal(resolveDbSsl({}), undefined);
});

test("TLS verifies certificates by default and uses the supplied CA", () => {
  const ssl = resolveDbSsl({ DATABASE_SSL: "true", DATABASE_SSL_CA: "line1\\nline2", NODE_ENV: "production" });
  assert.equal(ssl?.rejectUnauthorized, true);
  assert.equal(ssl?.ca, "line1\nline2");
});

test("insecure flag is refused in production", () => {
  assert.throws(() => resolveDbSsl({ DATABASE_SSL: "true", DATABASE_SSL_INSECURE: "true", NODE_ENV: "production" }), /not allowed in production/);
});

test("insecure flag relaxes verification outside production only", () => {
  assert.equal(resolveDbSsl({ DATABASE_SSL: "true", DATABASE_SSL_INSECURE: "true", NODE_ENV: "development" })?.rejectUnauthorized, false);
});
