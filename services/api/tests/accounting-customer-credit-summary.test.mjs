import assert from "node:assert/strict";
import test from "node:test";

import { getCustomerCreditSummary } from "../src/modules/accounting/reports.js";

const org = "11111111-1111-4111-8111-111111111111";
const partyId = "22222222-2222-4222-8222-222222222222";

const context = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["accounting.reports.view"],
  roleSlugs: [],
};

function client(row) {
  return { async query() { return { rows: [row] }; } };
}

test("F031: getCustomerCreditSummary flags overLimit once net AR exposure exceeds the credit limit", async () => {
  const summary = await getCustomerCreditSummary(
    client({ ar_outstanding: "5000", unapplied_advances: "0", credit_limit: "1000", currency_code: "INR" }),
    context,
    partyId,
  );
  assert.equal(summary.overLimit, true);
  assert.equal(summary.netExposure, 5000);
  assert.equal(summary.availableCredit, -4000);
});

test("F031: getCustomerCreditSummary nets unapplied advance receipts against AR outstanding", async () => {
  const summary = await getCustomerCreditSummary(
    client({ ar_outstanding: "5000", unapplied_advances: "5000", credit_limit: "1000", currency_code: "INR" }),
    context,
    partyId,
  );
  assert.equal(summary.netExposure, 0);
  assert.equal(summary.overLimit, false);
  assert.equal(summary.availableCredit, 1000);
});

test("F031: getCustomerCreditSummary reports no limit (null availableCredit) when credit_limit is zero", async () => {
  const summary = await getCustomerCreditSummary(
    client({ ar_outstanding: "500", unapplied_advances: "0", credit_limit: "0", currency_code: "INR" }),
    context,
    partyId,
  );
  assert.equal(summary.availableCredit, null);
  assert.equal(summary.overLimit, false);
});
