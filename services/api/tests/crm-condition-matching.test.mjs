// The criteria matcher used by CRM automation rules (runCrmAutomation) and by
// record-policy's change detection. Pins its exact semantics so a later
// consolidation with the other CRM matchers cannot silently change them.
import assert from "node:assert/strict";
import test from "node:test";

import { comparable, criteriaMatches } from "../src/modules/crm/data-management/condition-matching.js";

test("comparable trims and lower-cases strings and turns null/undefined into an empty string", () => {
  assert.equal(comparable("  Website "), "website");
  assert.equal(comparable(null), "");
  assert.equal(comparable(undefined), "");
  assert.equal(comparable(42), 42);
  assert.equal(comparable(false), false);
});

test("missing or non-object criteria match everything", () => {
  assert.equal(criteriaMatches({ status: "new" }, null), true);
  assert.equal(criteriaMatches({ status: "new" }, undefined), true);
  assert.equal(criteriaMatches({ status: "new" }, "status=new"), true);
  assert.equal(criteriaMatches({ status: "new" }, {}), true);
});

test("scalar criteria compare case-insensitively after trimming; every key must match", () => {
  assert.equal(criteriaMatches({ rating: "Hot", city: "Pune" }, { rating: " hot " }), true);
  assert.equal(criteriaMatches({ rating: "Hot", city: "Pune" }, { rating: "hot", city: "Mumbai" }), false);
  assert.equal(criteriaMatches({ amount: 100 }, { amount: 100 }), true);
  assert.equal(criteriaMatches({ amount: 100 }, { amount: "100" }), false);
});

test("array criteria match when the record value is one of the listed values", () => {
  assert.equal(criteriaMatches({ sourceCode: "WEB" }, { sourceCode: ["web", "event"] }), true);
  assert.equal(criteriaMatches({ sourceCode: "partner" }, { sourceCode: ["web", "event"] }), false);
});

test("a missing record value matches an empty-string criterion and nothing else", () => {
  assert.equal(criteriaMatches({}, { campaignId: "" }), true);
  assert.equal(criteriaMatches({ campaignId: null }, { campaignId: ["", "c-1"] }), true);
  assert.equal(criteriaMatches({}, { campaignId: "c-1" }), false);
});

test("keys are matched exactly (no snake_case fallback)", () => {
  assert.equal(criteriaMatches({ lead_source: "web" }, { leadSource: "web" }), false);
});
