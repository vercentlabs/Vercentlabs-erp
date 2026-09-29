// Owner pickers (lead assignment, coverage reassignment, record owners) are
// built from getCrmOptions().users. They must list every eligible person, not
// the first 50 names: an organization with more sellers than that could not
// pick the rest. People without CRM access stay out.
import assert from "node:assert/strict";
import test from "node:test";

import { getCrmOptions } from "../../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-options.js";
import { createRuntimeKit } from "../shared-runtime/runtime-kit.mjs";
import { ADMIN, crmFixtures } from "./crm-fixtures.mjs";

test("owner pickers list every eligible assignee beyond the first 50", async () => {
  const kit = await createRuntimeKit();
  try {
    const sellers = Array.from({ length: 60 }, (_, index) => `seller${String(index).padStart(2, "0")}`);
    const org = await kit.organization(["admin", ...sellers, "outsider"]);
    const fx = crmFixtures(kit, org);
    await fx.crmRole([org.ids.admin, ...sellers.map((label) => org.ids[label])]);
    const admin = org.session("admin", ADMIN);
    const options = await kit.tenant(org.organizationId, (client) => getCrmOptions(client, admin));
    const listed = new Set(options.users.map((user) => String(user.id)));
    for (const label of sellers) assert.ok(listed.has(String(org.ids[label])), `${label} is missing from the owner picker`);
    assert.equal(listed.has(String(org.ids.outsider)), false, "a member without CRM access is not an eligible owner");
    assert.equal(options.usersTruncated, false);
  } finally {
    await kit.close();
  }
});
