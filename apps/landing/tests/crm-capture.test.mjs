import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deliverDemoRequest } from "../lib/crm-capture.ts";

const VALID_PAYLOAD = {
  firstName: "Asha",
  email: "asha@example.com",
  phone: "+91 98765 43210",
  consentEmail: true,
  websiteUrl: "",
  companyWebsiteHidden: "",
};

test("throws a clear error instead of silently dropping the lead when unconfigured", async () => {
  const originalKey = process.env.CRM_CAPTURE_FORM_KEY;
  const originalSecret = process.env.CRM_CAPTURE_PROXY_SECRET;
  delete process.env.CRM_CAPTURE_FORM_KEY;
  delete process.env.CRM_CAPTURE_PROXY_SECRET;
  try {
    await assert.rejects(() => deliverDemoRequest(VALID_PAYLOAD, "127.0.0.1", "test-agent"), /not configured/i);
  } finally {
    if (originalKey !== undefined) process.env.CRM_CAPTURE_FORM_KEY = originalKey;
    if (originalSecret !== undefined) process.env.CRM_CAPTURE_PROXY_SECRET = originalSecret;
  }
});

// Independent re-implementation of apps/web's verifiedProxyFingerprint (see
// apps/web/src/app/api/crm/public/capture/[key]/route.ts), so this test
// actually proves interoperability rather than just re-checking crm-capture.ts
// against itself.
function verifyAgainstRealRouteContract({ headers, rawBody, secret, clientIp, userAgent }) {
  const timestamp = headers.get("x-vercentlabs-capture-timestamp");
  const fingerprint = headers.get("x-vercentlabs-capture-fingerprint");
  const signature = headers.get("x-vercentlabs-capture-signature");
  assert.match(timestamp, /^\d{13}$/, "timestamp header must be a 13-digit millisecond epoch");
  assert.match(fingerprint, /^[0-9a-f]{64}$/i, "fingerprint header must be a sha256 hex digest");
  assert.match(signature, /^[0-9a-f]{64}$/i, "signature header must be a sha256 hex digest");

  const expectedFingerprint = createHash("sha256").update(`${clientIp}|${userAgent}`).digest("hex");
  assert.equal(fingerprint, expectedFingerprint, "fingerprint must be sha256(`${clientIp}|${userAgent}`)");

  const expectedSignature = createHmac("sha256", secret).update(`${timestamp}.${fingerprint}.${rawBody}`).digest("hex");
  assert.ok(
    timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex")),
    "signature must be hmac_sha256(secret, `${timestamp}.${fingerprint}.${rawBody}`), matching apps/web's verifiedProxyFingerprint",
  );
}

test("sends a request apps/web's real capture route would accept: correct URL, header names, and signature", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.CRM_CAPTURE_FORM_KEY;
  const originalSecret = process.env.CRM_CAPTURE_PROXY_SECRET;
  const formKey = "38a0441d8e70cd1b8d1e7248c26ffdcfbf1a";
  const secret = "test-secret-at-least-32-characters-long-000";
  process.env.CRM_CAPTURE_FORM_KEY = formKey;
  process.env.CRM_CAPTURE_PROXY_SECRET = secret;

  let capturedRequest = null;
  global.fetch = async (url, init) => {
    capturedRequest = { url: String(url), rawBody: init.body, headers: new Headers(init.headers) };
    return new Response(JSON.stringify({ ok: true, leadId: "test" }), { status: 201 });
  };

  try {
    const result = await deliverDemoRequest(VALID_PAYLOAD, "203.0.113.4", "playwright-test-agent");
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);

    assert.ok(capturedRequest, "deliverDemoRequest must call fetch()");
    assert.equal(capturedRequest.url, `http://localhost:3001/api/crm/public/capture/${formKey}`);
    assert.equal(capturedRequest.headers.get("content-type"), "application/json");

    verifyAgainstRealRouteContract({
      headers: capturedRequest.headers,
      rawBody: capturedRequest.rawBody,
      secret,
      clientIp: "203.0.113.4",
      userAgent: "playwright-test-agent",
    });

    // Round-trips through the wire format apps/web's publicCaptureSchema expects.
    const sentPayload = JSON.parse(capturedRequest.rawBody);
    assert.equal(sentPayload.firstName, VALID_PAYLOAD.firstName);
    assert.equal(sentPayload.phone, VALID_PAYLOAD.phone);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.CRM_CAPTURE_FORM_KEY = originalKey;
    else delete process.env.CRM_CAPTURE_FORM_KEY;
    if (originalSecret !== undefined) process.env.CRM_CAPTURE_PROXY_SECRET = originalSecret;
    else delete process.env.CRM_CAPTURE_PROXY_SECRET;
  }
});
