import assert from "node:assert/strict";
import test from "node:test";
import {
  CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS,
  CrmCustomerSuccessError,
  crmCustomerSuccessHash,
  customerSuccessHealthFromSignals,
  normalizeCustomerFeedbackScore,
} from "../src/crm/customer-success.js";

test("CRM-03 exposes exactly five customer-success capabilities", () => {
  assert.deepEqual(CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS, [
    "CRM-031",
    "CRM-032",
    "CRM-033",
    "CRM-034",
    "CRM-047",
  ]);
});

test("feedback normalization enforces NPS and CSAT boundaries", () => {
  assert.equal(normalizeCustomerFeedbackScore("nps", 8), 80);
  assert.equal(normalizeCustomerFeedbackScore("csat", 5), 100);
  assert.equal(normalizeCustomerFeedbackScore("ces", 1), 0);
  assert.throws(
    () => normalizeCustomerFeedbackScore("nps", 11),
    CrmCustomerSuccessError,
  );
  assert.throws(
    () => normalizeCustomerFeedbackScore("csat", 0),
    /between 1 and 5/,
  );
});

test("health scoring is deterministic and penalises operational risk", () => {
  const healthy = customerSuccessHealthFromSignals({
    milestoneCompletion: 100,
    usageScore: 95,
    feedbackScore: 90,
  });
  const risky = customerSuccessHealthFromSignals({
    milestoneCompletion: 25,
    overdueMilestones: 3,
    usageScore: 10,
    feedbackScore: 20,
    openServiceRisks: 2,
    openChurnInterventions: 1,
    renewalDays: 10,
  });
  assert.equal(healthy.status, "healthy");
  assert.ok(healthy.score > risky.score);
  assert.ok(["at_risk", "critical"].includes(risky.status));
  assert.ok(risky.reasons.length >= 4);
});

test("customer-success evidence hashes are stable across key order", () => {
  assert.equal(
    crmCustomerSuccessHash({ b: 2, a: 1 }),
    crmCustomerSuccessHash({ a: 1, b: 2 }),
  );
});
