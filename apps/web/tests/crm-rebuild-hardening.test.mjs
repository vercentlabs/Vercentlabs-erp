import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("public meeting booking uses distributed rate limiting and bounded JSON", () => {
  const source = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/route-handlers/public-meeting-bookings.ts");
  assert.doesNotMatch(source, /new Map</);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /readRequestBytes/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});

test("public chat validates generated token shape, throttles, and bounds request bodies", () => {
  const source = read("apps/web/src/modules/crm/prospect-and-relationship-master-data/route-handlers/public-lead-chat.ts");
  assert.match(source, /\^\[0-9a-f\]\{48\}\$/);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /readRequestBytes/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});

test("inbound email fails closed on missing production authentication", () => {
  const source = read("apps/web/src/modules/crm/prospect-and-relationship-master-data/route-handlers/public-inbound-email.ts");
  assert.match(source, /NODE_ENV === "production"/);
  assert.match(source, /requiredSecret\.length < 32/);
  assert.match(source, /Inbound email authentication is not configured/);
});
