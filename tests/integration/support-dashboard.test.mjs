// Real PostgreSQL integration test -- the Support home dashboard (F379) and the form pickers.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_SUPPORT, buildSupportWorld, connectAdmin } from "./support-test-kit.mjs";

const ROLES = {
  agentA: ALL_SUPPORT,
  agentB: ALL_SUPPORT,
  creator: ["support.ticket.create", "support.view"], // can create tickets, but not override a quota (no support.manage)
  author: ["support.knowledge.manage", "support.view"], // can write and submit an article, but not fast-track their own publish (no support.manage)
  customer: [], // an ordinary user with no support permission at all -- portal access only
  viewer: ["support.view"],
};

test("Support dashboard and options against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildSupportWorld(admin, ROLES, "spsv");
  const { api, run, users, partyId, contactId } = w;

  try {

    await t.test("F379: the dashboard reconciles to real tickets", async () => {
      await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Dashboard", description: "Counted.", customerId: partyId, assignedUserId: users.agentA }));
      const dash = await run("agentA", (c, x) => api.getSupportDeskDashboard(c, x));
      assert.ok(dash.open_tickets >= 1);
      assert.ok(dash.my_open >= 1);
    });

    await t.test("options: the support form pickers resolve customers, categories and agents", async () => {
      const opts = await run("agentA", (c, x) => api.listSupportOptions(c, x));
      assert.ok(opts.customers.some((o) => o.id === partyId));
      assert.ok(opts.agents.some((a) => a.id === users.agentA));
      const contacts = await run("agentA", (c, x) => api.listCustomerContacts(c, x, partyId));
      assert.ok(contacts.some((cn) => cn.id === contactId));
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
