import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLeadReadiness,
  buildLeadAgingBuckets,
} from "../src/crm/lead-operations.js";
test("conversion readiness requires identity contact company product and score", () => {
  const r = evaluateLeadReadiness({
    full_name: "A",
    email: "a@b.com",
    company_name: "C",
    product_interest: "ERP",
    score: 25,
  });
  assert.equal(r.ready, true);
});
test("conversion readiness explains missing data", () => {
  const r = evaluateLeadReadiness({ score: 0 });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.length >= 4);
});
test("lead aging is deterministic", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const b = buildLeadAgingBuckets(
    [
      { updated_at: "2026-07-31T00:00:00Z" },
      { updated_at: "2026-07-15T00:00:00Z" },
      { updated_at: "2026-06-01T00:00:00Z" },
      {
        updated_at: "2026-07-31T00:00:00Z",
        next_follow_up_at: "2026-07-30T00:00:00Z",
      },
    ],
    now,
  );
  assert.deepEqual(b, { fresh: 1, aging: 1, stale: 1, overdue: 1 });
});
