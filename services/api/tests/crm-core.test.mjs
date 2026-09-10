import assert from "node:assert/strict";
import test from "node:test";

import { isCrmResource } from "../src/modules/crm/index.js";

test("CRM rejects unknown resources", () =>
  assert.equal(isCrmResource("anything"), false));

test("CRM exposes core governed resources", () => {
  for (const key of [
    "leads",
    "opportunities",
    "activities",
    "campaigns",
    "communications",
    "pipelines",
    "stages",
    "sources",
    "scoring-rules",
    "assignment-rules",
    "saved-views",
    "sales-teams",
    "territories",
    "quota-plans",
    "forecast-periods",
    "forecast-submissions",
    "account-plans",
    "playbooks",
    "consent-events",
    "privacy-requests",
  ])
    assert.equal(isCrmResource(key), true, key);
});

// F027 Prompt 4: the legacy static-predicate scoring engine this test used
// to cover (calculateLeadScore, tenant.crm_scoring_rules) was retired —
// see crm-lead-scoring-f027.test.mjs for coverage of the real deterministic
// engine (calculateLeadScoreBreakdown) that is now the sole writer of
// crm_leads.score.
