import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const primaryRoute = "src/app/api/crm/public/capture/[key]/route.ts";
const secondaryRoute =
  "src/app/api/crm/lead-acquisition/public/forms/[key]/route.ts";

test("both public CRM lead-capture routes cap request body size", () => {
  for (const route of [primaryRoute, secondaryRoute]) {
    const source = read(route);
    assert.match(source, /readRequestBytes\(request, 50_000\)/, `${route} must bound request body size`);
  }
});

test("both public CRM lead-capture routes derive their rate-limit fingerprint from the shared, header-spoof-resistant helpers", () => {
  for (const route of [primaryRoute, secondaryRoute]) {
    const source = read(route);
    assert.match(source, /verifiedCaptureProxyFingerprint/, `${route} must use the shared trusted-proxy fingerprint helper`);
    assert.match(source, /directCaptureFingerprint/, `${route} must use the shared direct-fallback fingerprint helper`);
    // Regression guard: a raw, client-suppliable X-Forwarded-For header must
    // never be read directly by either route — that was the confirmed
    // bypass in the lead-acquisition route before this hardening pass (see
    // docs/implementation/ERP_SECURITY_HARDENING_003.md, Part 3). This
    // checks the actual header-read call site, not prose (both routes'
    // comments legitimately mention the header name when explaining why
    // it's avoided).
    assert.doesNotMatch(
      source,
      /headers\.get\(\s*["']x-forwarded-for["']/i,
      `${route} must not read X-Forwarded-For directly`,
    );
  }
});

test("the trusted-proxy fingerprint helper verifies an HMAC signature rather than trusting client-supplied headers", () => {
  const source = read("src/lib/security.ts");
  assert.match(source, /export function verifiedCaptureProxyFingerprint/);
  assert.match(source, /CRM_CAPTURE_PROXY_SECRET/);
  assert.match(source, /createHmac\("sha256", secret\)/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /export function directCaptureFingerprint/);
  assert.match(source, /clientIp\(request\)/);
});

test("the lead-acquisition public form route no longer bypasses its origin allowlist on a missing Origin header", () => {
  const source = read(secondaryRoute);
  // The historical bug gated the whole allowlist check on `origin &&`, so an
  // omitted Origin header bypassed it entirely. This checks the actual
  // conditional code (not prose — the surrounding comment legitimately
  // quotes the old pattern to explain the fix).
  assert.doesNotMatch(source, /if\s*\(\s*origin\s*&&\s*allowed\.length\s*&&\s*!allowed\.includes/);
  assert.match(source, /if \(allowed\.length && !allowed\.includes\(origin\)\)/);
});

test("the public capture schema rejects unknown fields and bounds custom-data payload size", () => {
  const source = read("src/lib/crm-validation.ts");
  const schemaStart = source.indexOf("export const publicCaptureSchema");
  assert.ok(schemaStart !== -1, "publicCaptureSchema must exist");
  const schemaSource = source.slice(schemaStart, schemaStart + 2000);
  assert.match(schemaSource, /\.strict\(\)/, "unknown/privileged fields (owner, status, stage, score, tenant, createdBy) must be rejected, not silently accepted");
  assert.match(schemaSource, /Object\.keys\(value\)\.length <= 40/, "customData must have a bounded key count");
  assert.match(schemaSource, /JSON\.stringify\(value\)\.length <= 20_000/, "customData must have a bounded serialized size");
  for (const privilegedField of ["owner", "stage", "score", "status", "tenant", "createdBy", "permissions", "approvalState"]) {
    assert.doesNotMatch(
      schemaSource,
      new RegExp(`\\b${privilegedField}:\\s*z\\.`),
      `publicCaptureSchema must not accept a client-supplied "${privilegedField}" field`,
    );
  }
});

test("the primary capture route resolves the tenant only from the form key, never from a client-supplied identifier", () => {
  const source = read(primaryRoute);
  assert.doesNotMatch(source, /organizationId:\s*input\./);
  assert.match(source, /crm_public_capture_form\(\$1\)/);
});

test("the lead-acquisition form route resolves the tenant only from the resolved form record, never from the request body", () => {
  const source = read(secondaryRoute);
  assert.doesNotMatch(source, /organizationId:\s*(String\()?input\./);
  assert.match(source, /organizationId:\s*String\(form\.organization_id\)/);
});
