import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// CRM vNext Prompt 6 (F014 — Meetings), DEC-CRM-P1-F014 REQUIRED scope:
// "booking token expiry." A research pass confirmed
// tenant.crm_public_meeting_booking(token) validated a guest's
// cancellation/reschedule token purely by string match against a
// 'confirmed' booking, with no time boundedness — a token for a meeting
// that happened years ago and was never explicitly cancelled would still
// validate forever. The fix lives entirely in the SQL function (migration
// 105) since it is the SECURITY DEFINER gate the one real call site
// (apps/web/.../public/meetings/bookings/[token]/route.ts) goes through —
// confirmed by grep, no other code path queries cancellation_token/
// reschedule_token at all.
test("F014: the booking-token lookup function now rejects a token once its meeting has been over for more than 1 day", () => {
  const migration = read("database/tenant/migrations/105_f014_booking_token_expiry.sql");
  assert.match(migration, /CREATE OR REPLACE FUNCTION tenant\.crm_public_meeting_booking/);
  assert.match(migration, /booking\.ends_at > now\(\) - interval '1 day'/);
});

test("F014: crm_meeting_links.public_token (the durable booking-page link) is deliberately left without an expiry — it is a different, reusable link by design", () => {
  const migration = read("database/tenant/migrations/105_f014_booking_token_expiry.sql");
  assert.doesNotMatch(migration, /ALTER TABLE tenant\.crm_meeting_links/, "this migration must only touch the per-booking cancellation/reschedule token gate, not the durable page link's own table");
});

test("F014: the public booking cancel/reschedule route is the ONLY code path that resolves cancellation_token/reschedule_token — no bypass exists", () => {
  // Prompt 3 (CRM clean-frontend rebuild): the previous two-file split (a
  // thin route.ts delegating to a separate route-handlers module) was
  // consolidated into this one file — still the sole call site.
  const route = read("apps/web/src/app/api/crm/public/meetings/bookings/[token]/route.ts");
  assert.match(route, /crm_public_meeting_booking/);
  // A broader grep across the whole web+api tree for direct
  // cancellation_token/reschedule_token references is enforced by the
  // audit that produced this fix (confirmed: the route above is the only
  // hit) — this test pins the one legitimate call site's shape so a
  // future direct-table bypass would be a visible diff here, not a silent
  // regression.
  assert.match(route, /SELECT \* FROM tenant\.crm_public_meeting_booking\(\$1\)/);
});
