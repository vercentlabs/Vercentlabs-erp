import test from "node:test";
import assert from "node:assert/strict";
import {
  CRM_AI_INTELLIGENCE_CAPABILITY_IDS,
  rankNextBestActions,
  calculateRelationshipIntelligence,
  redactAssistantContext,
  buildGenerativeAssistantDraft,
  calculateDealRisk,
  validateAiFeedback,
} from "../src/crm/ai-intelligence.js";
test("CRM-11 declares four exact AI capabilities", () =>
  assert.deepEqual(CRM_AI_INTELLIGENCE_CAPABILITY_IDS, [
    "CRM-007",
    "CRM-008",
    "CRM-009",
    "CRM-043",
  ]));
test("next best actions are ranked and blockers fail closed", () => {
  const r = rankNextBestActions({
    signals: { overdue: true },
    actions: [
      { key: "call", baseScore: 70, blockers: [{ key: "overdue" }] },
      { key: "email", baseScore: 50 },
    ],
  });
  assert.equal(r.top.key, "email");
});
test("relationship intelligence combines coverage and activity", () =>
  assert.equal(
    calculateRelationshipIntelligence({
      contacts: [{ role: "buyer" }],
      interactions: [
        { at: new Date().toISOString(), sentiment: "positive" },
        { at: new Date().toISOString(), sentiment: "positive" },
        { at: new Date().toISOString(), sentiment: "positive" },
      ],
    }).grade,
    "healthy",
  ));
test("assistant context redacts secrets and PII", () => {
  const r = redactAssistantContext({ token: "abc", email: "a@example.com" });
  assert.equal(r.token, "[REDACTED]");
  assert.equal(r.email, "[EMAIL]");
});
test("assistant draft is grounded and review required", () =>
  assert.equal(
    buildGenerativeAssistantDraft({ facts: ["Proposal shared"] })
      .requiresHumanApproval,
    true,
  ));
test("deal risk is explainable", () =>
  assert.equal(
    calculateDealRisk({
      probability: 20,
      daysWithoutActivity: 30,
      closeOverdue: true,
    }).riskBand,
    "critical",
  ));
test("feedback outcomes are validated", () =>
  assert.equal(validateAiFeedback({ outcome: "edited" }).learnable, true));
