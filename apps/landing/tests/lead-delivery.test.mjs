import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("landing delivery maps its form to the strict CRM capture contract", () => {
  const source = read("src/lib/lead-delivery.ts");
  for (const marker of [
    "CRM_CAPTURE_URL",
    "CRM_CAPTURE_PROXY_SECRET",
    "firstName",
    "lastName",
    "companyName",
    "productInterest",
    "customData",
  ]) assert.match(source, new RegExp(marker));
});

test("landing capture preserves a visitor fingerprint with a signed request", () => {
  const delivery = read("src/lib/lead-delivery.ts");
  const security = read("src/lib/lead-security.ts");
  assert.match(delivery, /X-Vercentlabs-Capture-Fingerprint/);
  assert.match(delivery, /X-Vercentlabs-Capture-Signature/);
  assert.match(delivery, /createHmac/);
  assert.match(security, /TRUSTED_PROXY_IP_HEADER/);
  assert.match(security, /leadFingerprint/);
  assert.doesNotMatch(security, /get\("x-forwarded-for"\)/);
});

test("CRM verifies trusted proxy signatures before using forwarded identity", () => {
  const route = read(
    "../web/src/app/api/crm/public/capture/[key]/route.ts",
  );
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /SIGNATURE_MAX_AGE_MS/);
  assert.match(route, /readRequestBytes/);
  assert.match(route, /proxy:\$\{fingerprint\}/);
});
