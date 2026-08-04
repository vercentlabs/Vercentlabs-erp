import test from "node:test";
import assert from "node:assert/strict";
import {
  validateJourneyBranchGraph,
  validateFieldVisit,
  buildCrossChannelCampaignPlan,
  routeInboundEmail,
  evaluatePartnerDealConflict,
  calculatePartnerIncentive,
  calculateConversationScore,
  calculateGamificationAwards,
  CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS,
} from "../src/crm/partner-engagement.js";
test("CRM-10 declares ten exact capabilities", () =>
  assert.deepEqual(CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS, [
    "CRM-037",
    "CRM-044",
    "CRM-048",
    "CRM-050",
    "CRM-055",
    "CRM-078",
    "CRM-079",
    "CRM-080",
    "CRM-082",
    "CRM-083",
  ]));
test("journey branching rejects cycles", () =>
  assert.throws(
    () =>
      validateJourneyBranchGraph([
        { key: "a", next: ["b"] },
        { key: "b", next: ["a"] },
      ]),
    /cycles/,
  ));
test("field visits validate coordinates", () =>
  assert.equal(
    validateFieldVisit({ latitude: 18.52, longitude: 73.85 }).latitude,
    18.52,
  ));
test("cross-channel plans enforce supported channels", () =>
  assert.equal(
    buildCrossChannelCampaignPlan({
      channels: ["email", "sms"],
      audienceSize: 10,
    }).estimatedMessages,
    20,
  ));
test("inbound email routing finds opportunities", () =>
  assert.equal(
    routeInboundEmail({ from: "a@example.com", subject: "Re OPP-ABC-123" })
      .route,
    "opportunity",
  ));
test("partner conflict matching is deterministic", () =>
  assert.equal(
    evaluatePartnerDealConflict(
      [{ status: "approved", account_domain: "example.com" }],
      { accountDomain: "example.com" },
    ).conflict,
    true,
  ));
test("partner incentive respects caps", () =>
  assert.equal(
    calculatePartnerIncentive({
      basisAmount: 1000,
      ratePercent: 20,
      capAmount: 150,
    }).incentiveAmount,
    150,
  ));
test("coaching and gamification are deterministic", () => {
  assert.equal(
    calculateConversationScore([{ key: "discovery", weight: 1, maxScore: 5 }], {
      discovery: 4,
    }).score,
    80,
  );
  assert.equal(
    calculateGamificationAwards(
      [{ eventType: "meeting" }],
      [{ eventType: "meeting", points: 10 }],
    ).totalPoints,
    10,
  );
});
