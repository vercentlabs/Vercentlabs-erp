import assert from "node:assert/strict";
import test from "node:test";

import { calculateLeadScore, isCrmResource } from "../src/modules/crm/index.js";

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

test("lead scoring applies deterministic active rules", async () => {
  const client = {
    async query() {
      return {
        rows: [
          {
            field_name: "industry",
            operator: "equals",
            comparison_value: "manufacturing",
            points: 20,
          },
          {
            field_name: "email",
            operator: "not_empty",
            comparison_value: null,
            points: 5,
          },
        ],
      };
    },
  };
  assert.equal(
    await calculateLeadScore(client, "org", {
      industry: "manufacturing",
      email: "a@example.com",
    }),
    25,
  );
  assert.equal(
    await calculateLeadScore(client, "org", {
      industry: "retail",
      email: "",
    }),
    0,
  );
});
