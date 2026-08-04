import assert from "node:assert/strict";
import test from "node:test";
import {
  CRM_MARKETING_CAPABILITY_IDS,
  assignMarketingExperimentVariant,
  buildMarketingDeliveryCommand,
  calculateMarketingAttributionWeights,
  compileMarketingSegmentFilter,
  crmMarketingHash,
  evaluateMarketingFrequencyPolicy,
  normalizeJourneyDefinition,
  normalizeMarketingSegmentDefinition,
  validateMarketingSurveyDefinition,
} from "../src/crm/marketing-execution.js";

test("CRM-07 exposes eight benchmarked marketing capabilities", () => {
  assert.deepEqual(CRM_MARKETING_CAPABILITY_IDS, [
    "CRM-064",
    "CRM-065",
    "CRM-066",
    "CRM-067",
    "CRM-068",
    "CRM-069",
    "CRM-070",
    "CRM-071",
  ]);
});

test("dynamic segment filters are allowlisted and parameterized", () => {
  const definition = normalizeMarketingSegmentDefinition({
    name: "High intent",
    subjectType: "lead",
    filters: { status: "working", scoreMin: 40, consentEmail: true },
  });
  assert.equal(definition.subjectType, "lead");
  const compiled = compileMarketingSegmentFilter("lead", definition.filters, 2);
  assert.match(compiled.clause, /subject\.status = \$2/);
  assert.match(compiled.clause, /subject\.score >= \$3/);
  assert.deepEqual(compiled.values, ["working", 40, true]);
  assert.throws(
    () =>
      normalizeMarketingSegmentDefinition({
        name: "Unsafe",
        subjectType: "lead",
        filters: { rawSql: "1=1" },
      }),
    /Unsupported lead segment filter/,
  );
});

test("journeys enforce unique keys and valid branches", () => {
  const journey = normalizeJourneyDefinition({
    name: "Nurture",
    steps: [
      { key: "welcome", type: "email", nextStepKey: "wait" },
      { key: "wait", type: "wait", nextStepKey: "decision" },
      {
        key: "decision",
        type: "condition",
        trueStepKey: "exit",
        falseStepKey: "exit",
      },
      { key: "exit", type: "exit" },
    ],
  });
  assert.equal(journey.steps.length, 4);
  assert.throws(
    () =>
      normalizeJourneyDefinition({
        name: "Broken",
        steps: [{ key: "one", type: "email", nextStepKey: "missing" }],
      }),
    /missing step/,
  );
});

test("experiment assignment is deterministic and weighted", () => {
  const variants = [
    { key: "A", weight: 50 },
    { key: "B", weight: 50 },
  ];
  assert.equal(
    assignMarketingExperimentVariant("lead-1", variants),
    assignMarketingExperimentVariant("lead-1", variants),
  );
  assert.ok(
    ["A", "B"].includes(assignMarketingExperimentVariant("lead-2", variants)),
  );
});

test("attribution models allocate exactly one unit", () => {
  const points = [{ id: "a" }, { id: "b" }, { id: "c" }];
  for (const model of [
    "first_touch",
    "last_touch",
    "linear",
    "position_based",
    "time_decay",
  ]) {
    const weighted = calculateMarketingAttributionWeights(points, model);
    assert.ok(
      Math.abs(weighted.reduce((sum, point) => sum + point.weight, 0) - 1) <
        1e-9,
    );
  }
});

test("frequency policy fails closed for consent, suppressions and caps", () => {
  assert.deepEqual(
    evaluateMarketingFrequencyPolicy({
      channel: "email",
      destination: "a@example.com",
      consentEmail: false,
    }),
    { eligible: false, reason: "email_consent_required" },
  );
  assert.equal(
    evaluateMarketingFrequencyPolicy({
      channel: "sms",
      destination: "+919999999999",
      consentSms: true,
      messagesInWindow: 5,
      maximumMessages: 5,
    }).reason,
    "frequency_cap",
  );
  assert.equal(
    evaluateMarketingFrequencyPolicy({
      channel: "email",
      destination: "a@example.com",
      consentEmail: true,
      suppressed: false,
      messagesInWindow: 0,
      maximumMessages: 5,
    }).eligible,
    true,
  );
});

test("survey builder validates choices and required schema", () => {
  const survey = validateMarketingSurveyDefinition({
    questions: [
      { key: "nps", type: "nps", required: true },
      { key: "reason", type: "single_choice", options: ["Price", "Product"] },
    ],
  });
  assert.equal(survey.questions.length, 2);
  assert.throws(
    () =>
      validateMarketingSurveyDefinition({
        questions: [{ key: "bad", type: "single_choice", options: ["Only"] }],
      }),
    /at least two options/,
  );
});

test("delivery commands are idempotent and hashes are stable", () => {
  const command = buildMarketingDeliveryCommand({
    campaignRunId: "run-1",
    subjectType: "lead",
    subjectId: "lead-1",
    channel: "email",
    destination: "a@example.com",
    subject: "Hello",
    body: "Welcome",
  });
  assert.equal(command.channel, "email");
  assert.equal(
    crmMarketingHash({ b: 2, a: 1 }),
    crmMarketingHash({ a: 1, b: 2 }),
  );
});
