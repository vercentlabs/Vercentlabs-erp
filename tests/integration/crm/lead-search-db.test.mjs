// F001 index-backed lead search (migrations 190/191) on the runtime role:
// tenant isolation, sensitive-content restriction, owner scope and literal
// wildcards are unchanged by the SECURITY DEFINER id lookup.
import assert from "node:assert/strict";
import test from "node:test";

import { listCrmRecords } from "../../../services/api/src/modules/crm/data-management/resource-query-service.js";
import { createRuntimeKit } from "../shared-runtime/runtime-kit.mjs";

test("F001 lead search", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice", "bob"]);
    const other = await kit.organization(["mallory"]);
    const mine = await kit.crmLead(org, org.ids.alice, "Zanzibar", "Traders");
    const theirs = await kit.crmLead(org, org.ids.bob, "Zanzibar", "Hidden");
    await kit.crmLead(other, other.ids.mallory, "Zanzibar", "Foreign");
    await kit.owner.query(`UPDATE tenant.crm_leads SET email='findme@secret.test', company_name='50% Off Ltd' WHERE id=$1`, [mine]);
    const sensitive = org.session("alice", ["crm.view", "crm.leads.manage", "crm.leads.view_sensitive"]);
    const restricted = org.session("alice", ["crm.view", "crm.leads.manage"]);
    const viewAll = org.session("alice", ["crm.view", "crm.records.view_all", "crm.leads.view_sensitive"]);
    const search = (session, term) => kit.tenant(org.organizationId, (client) => listCrmRecords(client, session, "leads", { search: term, limit: 50 })).then((page) => page.rows.map((row) => row.id));

    await t.test("finds by name within the organisation and the caller's scope only", async () => {
      assert.deepEqual(await search(sensitive, "zanzib"), [mine], "Bob's lead is outside Alice's owner scope; the other organisation's never appears");
      assert.deepEqual((await search(viewAll, "Zanzibar")).sort(), [mine, theirs].sort());
    });

    await t.test("contact details are searchable only by viewers of sensitive lead content", async () => {
      assert.deepEqual(await search(sensitive, "findme@secret"), [mine]);
      assert.deepEqual(await search(restricted, "findme@secret"), [], "a restricted viewer cannot find a lead by a value they cannot see");
    });

    await t.test("wildcards in the term are literal", async () => {
      assert.deepEqual(await search(viewAll, "50% off"), [mine]);
      assert.deepEqual(await search(viewAll, "%"), [mine], "only the lead whose text contains a literal %");
      assert.deepEqual(await search(viewAll, "_"), [], "an underscore is not a single-character wildcard");
    });

    await t.test("the id lookup returns nothing without an organisation context", async () => {
      const rows = await kit.runtime((client) => client.query(`SELECT * FROM tenant.crm_lead_search_ids('%zanzibar%', true)`));
      assert.equal(rows.rows.length, 0);
    });
  } finally {
    await kit.close();
  }
});
