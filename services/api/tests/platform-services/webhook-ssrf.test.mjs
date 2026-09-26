import assert from "node:assert/strict";
import test from "node:test";

import { isBlockedAddress, validateWebhookUrl, resolveSafeAddress, SsrfError } from "../../src/core/platform/integrations/webhooks/ssrf.js";

// Part 68's required cases: localhost, 127.0.0.1, ::1, link-local, private
// IPv4 ranges, invalid scheme, public safe URL form.

test("blocks 127.0.0.1 (loopback)", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
});

test("blocks ::1 (IPv6 loopback)", () => {
  assert.equal(isBlockedAddress("::1"), true);
});

test("blocks link-local (169.254.x.x, including the cloud metadata address)", () => {
  assert.equal(isBlockedAddress("169.254.169.254"), true);
  assert.equal(isBlockedAddress("169.254.1.1"), true);
});

test("blocks IPv6 link-local (fe80::/10)", () => {
  assert.equal(isBlockedAddress("fe80::1234"), true);
});

test("blocks private IPv4 ranges (10.x, 172.16-31.x, 192.168.x)", () => {
  assert.equal(isBlockedAddress("10.1.2.3"), true);
  assert.equal(isBlockedAddress("172.16.5.5"), true);
  assert.equal(isBlockedAddress("172.31.255.255"), true);
  assert.equal(isBlockedAddress("192.168.100.1"), true);
  assert.equal(isBlockedAddress("172.32.0.1"), false, "172.32.0.0 is outside the 172.16.0.0/12 private range");
});

test("blocks IPv6 unique-local (fc00::/7)", () => {
  assert.equal(isBlockedAddress("fc00::1"), true);
  assert.equal(isBlockedAddress("fd12:3456::1"), true);
});

test("blocks an IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", () => {
  assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
});

test("allows a public address", () => {
  assert.equal(isBlockedAddress("203.0.113.10"), true, "203.0.113.0/24 is TEST-NET-3, also blocked");
  assert.equal(isBlockedAddress("142.250.80.14"), false); // a real public Google IP
});

test("allowPrivate override exists only for controlled test fixtures, never on by default", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("127.0.0.1", { allowPrivate: true }), false);
});

test("validateWebhookUrl: rejects invalid schemes (file:, data:, javascript:)", () => {
  assert.throws(() => validateWebhookUrl("file:///etc/passwd"), SsrfError);
  assert.throws(() => validateWebhookUrl("data:text/plain,hello"), SsrfError);
  assert.throws(() => validateWebhookUrl("javascript:alert(1)"), SsrfError);
});

test("validateWebhookUrl: rejects localhost by hostname string, before any DNS lookup", () => {
  assert.throws(() => validateWebhookUrl("http://localhost/hook"), SsrfError);
  assert.throws(() => validateWebhookUrl("http://localhost.localdomain/hook"), SsrfError);
});

test("validateWebhookUrl: accepts a well-formed public https URL", () => {
  const parsed = validateWebhookUrl("https://example.com/webhooks/inbound");
  assert.equal(parsed.hostname, "example.com");
});

test("validateWebhookUrl: rejects a malformed URL", () => {
  assert.throws(() => validateWebhookUrl("not a url"), SsrfError);
});

test("resolveSafeAddress: an already-blocked literal IP is rejected without a DNS lookup", async () => {
  await assert.rejects(() => resolveSafeAddress("127.0.0.1"), SsrfError);
});

test("resolveSafeAddress: a literal public IP resolves to itself", async () => {
  const result = await resolveSafeAddress("142.250.80.14");
  assert.equal(result.address, "142.250.80.14");
});
