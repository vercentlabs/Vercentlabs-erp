import assert from "node:assert/strict";
import test from "node:test";

import { createCrmRecord, CrmError } from "../src/modules/crm/index.js";
import { evaluateLeadReadiness } from "../src/modules/crm/lead-operations.js";
import { validateLeadRecord } from "../src/modules/crm/features/leads/record-validation.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["crm.records.view_all", "crm.leads.manage"],
  roleSlugs: ["organization_owner"],
};

test("F001 hardening: qualification does not deadlock a tenant with no scoring configuration", () => {
  const lead = {
    first_name: "Asha",
    email: "asha@example.com",
    company_name: "Example Manufacturing",
    product_interest: "ERP",
    score: 0,
  };

  const freshTenant = evaluateLeadReadiness(lead, new Date(), {
    scoringConfigured: false,
  });
  assert.equal(freshTenant.ready, true);
  assert.equal(freshTenant.scoringConfigured, false);
  assert.equal(
    freshTenant.reasons.includes("Lead score is below the conversion threshold."),
    false,
  );

  const configuredTenant = evaluateLeadReadiness(lead, new Date(), {
    scoringConfigured: true,
  });
  assert.equal(configuredTenant.ready, false);
  assert.equal(configuredTenant.scoringConfigured, true);
  assert.equal(
    configuredTenant.reasons.includes("Lead score is below the conversion threshold."),
    true,
  );
});

test("F001 hardening: UTC and offset follow-up timestamps are valid at the domain boundary", () => {
  for (const nextFollowUpAt of [
    "2026-08-25T10:30:00Z",
    "2026-08-25T16:00:00+05:30",
    "2026-08-25T10:30",
  ]) {
    const errors = validateLeadRecord({
      firstName: "Timestamp",
      email: "timestamp@example.com",
      nextFollowUpAt,
    });
    assert.equal(
      errors.some((error) => error.code === "CRM_LEAD_FOLLOW_UP_INVALID"),
      false,
      nextFollowUpAt,
    );
  }

  const invalid = validateLeadRecord({
    firstName: "Timestamp",
    email: "timestamp@example.com",
    nextFollowUpAt: "not-a-date",
  });
  assert.equal(
    invalid.some((error) => error.code === "CRM_LEAD_FOLLOW_UP_INVALID"),
    true,
  );
});

test("F001 hardening: scoring-rule text comparison values are encoded safely for jsonb storage", async () => {
  let insertValues;
  const client = {
    async query(sql, values = []) {
      if (sql.startsWith("INSERT INTO tenant.crm_scoring_rules")) {
        insertValues = values;
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              organization_id: context.organizationId,
              name: "Industry match",
              field_name: "industry",
              operator: "equals",
              comparison_value: "Manufacturing",
              points: 25,
              status: "active",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await createCrmRecord(client, context, "scoring-rules", {
    name: "Industry match",
    fieldName: "industry",
    operator: "equals",
    comparisonValue: "Manufacturing",
    points: 25,
    status: "active",
  });

  assert.ok(insertValues, "scoring-rule INSERT should run");
  assert.equal(
    insertValues.includes(JSON.stringify("Manufacturing")),
    true,
    "text comparison must be sent as valid JSON text instead of a raw postgres jsonb token",
  );
});

test("F001 hardening: domain validation errors retain machine code and field-error details", async () => {
  await assert.rejects(
    createCrmRecord({ query: async () => { throw new Error("DB must not be reached"); } }, context, "leads", {
      firstName: "Asha",
    }),
    (error) => {
      assert.ok(error instanceof CrmError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "CRM_LEAD_CONTACT_REQUIRED");
      assert.deepEqual(error.details?.errors?.email, [
        "Provide at least one contact method: email, mobile number or alternate number.",
      ]);
      return true;
    },
  );
});
