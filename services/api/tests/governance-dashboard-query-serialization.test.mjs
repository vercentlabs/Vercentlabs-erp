import assert from "node:assert/strict";
import test from "node:test";

import { getBankingGovernanceDashboard } from "../src/modules/accounting/banking-governance.js";
import { getPayablesGovernanceDashboard } from "../src/modules/accounting/payables-governance.js";
import { getReceivablesGovernanceDashboard } from "../src/modules/accounting/receivables-governance.js";
import { getProcurementGovernanceDashboard } from "../src/modules/procurement/governance.js";

const context = Object.freeze({
  organizationId: "018f1ec7-49c3-4a52-8c4e-52e164537b21",
  userId: "018f1ec7-49c3-4a52-8c4e-52e164537b22",
  roleSlugs: ["organization_owner"],
  permissions: [],
  allowAllCompanies: true,
  activeCompanyId: null,
});

function overlapDetectingClient() {
  let active = false;
  let queryCount = 0;

  return {
    get queryCount() {
      return queryCount;
    },
    async query() {
      assert.equal(
        active,
        false,
        "a governance dashboard started client.query() while the same client was busy",
      );
      active = true;
      queryCount += 1;
      await new Promise((resolve) => setImmediate(resolve));
      active = false;
      return { rows: [], rowCount: 0 };
    },
  };
}

for (const [name, loadDashboard] of [
  ["receivables", getReceivablesGovernanceDashboard],
  ["payables", getPayablesGovernanceDashboard],
  ["banking", getBankingGovernanceDashboard],
  ["procurement", getProcurementGovernanceDashboard],
]) {
  test(`${name} governance dashboard serializes queries on one client`, async () => {
    const client = overlapDetectingClient();
    await loadDashboard(client, context);
    assert.ok(client.queryCount > 1, "the test must exercise multiple queries");
  });
}
