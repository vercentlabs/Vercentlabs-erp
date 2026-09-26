import assert from "node:assert/strict";
import test from "node:test";

import { assertSameOrigin, assertSameOriginOrMobile, clientIp, enforceRateLimit, SecurityError } from "../src/core/security.js";

const ENV = { APP_URL: "https://app.example.com", NODE_ENV: "production" };

test("assertSameOrigin allows a configured origin and rejects everything else", () => {
  const allowed = new Request("https://app.example.com/api/x", { headers: { origin: "https://app.example.com" } });
  assert.doesNotThrow(() => assertSameOrigin(allowed, ENV));
  const attacker = new Request("https://app.example.com/api/x", { headers: { origin: "https://evil.example.com" } });
  assert.throws(() => assertSameOrigin(attacker, ENV), SecurityError);
});

test("assertSameOriginOrMobile requires BOTH a Bearer-shaped token AND the mobile client header, not either alone", () => {
  const bearerOnly = new Request("https://app.example.com/api/x", {
    headers: { authorization: "Bearer " + "a".repeat(48) },
  });
  assert.throws(() => assertSameOriginOrMobile(bearerOnly, ENV), SecurityError);

  const mobileHeaderOnly = new Request("https://app.example.com/api/x", {
    headers: { "x-vercentlabs-client": "mobile/1.0.0" },
  });
  assert.throws(() => assertSameOriginOrMobile(mobileHeaderOnly, ENV), SecurityError);

  const both = new Request("https://app.example.com/api/x", {
    headers: { authorization: "Bearer " + "a".repeat(48), "x-vercentlabs-client": "mobile/1.0.0" },
  });
  assert.doesNotThrow(() => assertSameOriginOrMobile(both, ENV));
});

test("clientIp never trusts X-Forwarded-For unless an operator-configured trusted-proxy header name matches", () => {
  const request = new Request("https://app.example.com/api/x", {
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
  assert.equal(clientIp(request, { NODE_ENV: "production" }), "unavailable");
  assert.equal(
    clientIp(request, { NODE_ENV: "production", TRUSTED_PROXY_IP_HEADER: "x-forwarded-for" }),
    "1.2.3.4",
  );
});

test("clientIp behind the Google load balancer takes the hop it observed, not a client-supplied one", () => {
  // "<spoofed>, <real client>, <load balancer>"
  const request = new Request("https://app.example.com/api/x", { headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4, 35.191.0.1" } });
  const env = { NODE_ENV: "production", TRUSTED_PROXY_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_CLIENT_INDEX: "-2" };
  assert.equal(clientIp(request, env), "1.2.3.4");
  assert.equal(clientIp(new Request("https://app.example.com/api/x", { headers: { "x-forwarded-for": "1.2.3.4" } }), env), "unavailable", "too few hops is not trusted");
});

test("enforceRateLimit throws 429 once the attempt count exceeds the maximum", async () => {
  const client = { query: async () => ({ rows: [{ attempts: 11 }] }) };
  await assert.rejects(
    enforceRateLimit(client, "login:user@example.com", 10, 60),
    (error) => error instanceof SecurityError && error.status === 429,
  );
});

test("enforceRateLimit allows the request when under the maximum", async () => {
  const client = { query: async () => ({ rows: [{ attempts: 3 }] }) };
  await assert.doesNotThrow(() => enforceRateLimit(client, "login:user@example.com", 10, 60));
});
