import test from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessMinutes,
  calculateLeadScoreBreakdown,
  evaluateLeadSlaStatus,
  evaluateNurtureEligibility,
  rankNurtureCandidate,
  crmLeadIntelligenceHash,
} from "../src/crm/lead-intelligence.js";
test("behavioural scoring is explainable and decays old events", () => {
  const now = new Date("2026-08-03T10:00:00Z");
  const result = calculateLeadScoreBreakdown({
    now,
    lead: { email: "lead@example.com", company_name: "Acme" },
    model: {
      base_score: 0,
      score_floor: -100,
      score_ceiling: 100,
      decay_half_life_days: 10,
      qualification_thresholds: { warm: 20, hot: 50, qualified: 75 },
    },
    rules: [
      {
        id: "email",
        name: "Email",
        signal_type: "demographic",
        predicate: { field: "email", operator: "not_empty" },
        points: 10,
        status: "active",
      },
      {
        id: "click",
        name: "Click",
        signal_type: "behavioral",
        predicate: { eventType: "email_clicked", withinDays: 60 },
        points: 20,
        maximum_occurrences: 2,
        decay_enabled: true,
        status: "active",
      },
    ],
    events: [
      { event_type: "email_clicked", occurred_at: "2026-08-03T09:00:00Z" },
      { event_type: "email_clicked", occurred_at: "2026-07-24T10:00:00Z" },
    ],
  });
  assert.equal(result.score, 40);
  assert.equal(result.grade, "warm");
  assert.equal(result.contributions.length, 2);
});
test("business minutes skip weekends and closed hours", () => {
  const due = addBusinessMinutes(new Date("2026-08-07T17:30:00Z"), 120, {
    weekdays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "18:00",
  });
  assert.equal(due.toISOString(), "2026-08-10T10:30:00.000Z");
});
test("SLA status fails closed after the due time", () => {
  const result = evaluateLeadSlaStatus(
    { status: "open", response_due_at: "2026-08-03T09:00:00Z" },
    new Date("2026-08-03T10:00:00Z"),
  );
  assert.equal(result.status, "breached");
  assert.equal(result.breached, true);
});
test("nurture eligibility blocks do-not-contact and missing consent", () => {
  const blocked = evaluateNurtureEligibility(
    {
      score: 30,
      status: "working",
      do_not_contact: true,
      created_at: "2026-07-01T00:00:00Z",
    },
    {
      minimum_score: 0,
      maximum_score: 70,
      inactivity_days: 3,
      consent_channel: "email",
    },
    new Date("2026-08-03T00:00:00Z"),
  );
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.reasons.includes("do_not_contact"));
});
test("nurture ranking prioritizes breaches and overdue follow-ups", () => {
  const score = rankNurtureCandidate(
    {
      lead: {
        score: 20,
        priority: "high",
        created_at: "2026-07-01T00:00:00Z",
        next_follow_up_at: "2026-08-01T00:00:00Z",
      },
      sla: { status: "breached" },
    },
    new Date("2026-08-03T00:00:00Z"),
  );
  assert.ok(score > 100);
});
test("evidence hashes are deterministic", () => {
  assert.equal(
    crmLeadIntelligenceHash({ b: 2, a: 1 }),
    crmLeadIntelligenceHash({ a: 1, b: 2 }),
  );
});
