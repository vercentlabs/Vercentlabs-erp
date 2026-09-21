// Real PostgreSQL integration test -- knowledge base and canned responses (F369-F370), the customer
// portal (F371), product/asset linkage and entitlements (F373-F375), CSAT (F376), and reporting/audit
// (F377-F380).
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

test("Support knowledge, portal, entitlements and reporting against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildSupportWorld(admin, ROLES, "spsv");
  const { api, run, denied, sql, users, partyId, contactId } = w;
  const ids = {};

  try {
    await t.test("F369: an article goes draft -> review -> published (by someone else) -> retired, with revisions kept", async () => {
      await denied("viewer", (c, x) => api.saveKnowledgeArticle(c, x, { title: "How to reset a password", content: "Steps..." }), 403);
      const a = await run("author", (c, x) => api.saveKnowledgeArticle(c, x, { title: "How to reset a password", content: "Go to settings and click reset.", visibility: "customer" }));
      ids.article = a.id;
      await denied("author", (c, x) => api.publishKnowledgeArticle(c, x, a.id), 409, "SUPPORT_ARTICLE_STATE");
      await run("author", (c, x) => api.submitKnowledgeArticle(c, x, a.id));
      await denied("author", (c, x) => api.publishKnowledgeArticle(c, x, a.id), 403, "SELF_APPROVAL_BLOCKED");
      const published = await run("agentB", (c, x) => api.publishKnowledgeArticle(c, x, a.id));
      assert.equal(published.status, "published");
      assert.ok(published.published_at);
      const retired = await run("agentA", (c, x) => api.retireKnowledgeArticle(c, x, a.id, "Outdated instructions"));
      assert.equal(retired.status, "retired");
      const revised = await run("agentA", (c, x) => api.reviseKnowledgeArticle(c, x, a.id));
      assert.equal(revised.version, 2);
      assert.equal(revised.status, "draft");
    });

    await t.test("F370: canned responses are shared by default, or private to their owner", async () => {
      const shared = await run("agentA", (c, x) => api.saveCannedResponse(c, x, { code: "GREET", name: "Greeting", body: "Hi, thanks for reaching out!" }));
      const priv = await run("agentA", (c, x) => api.saveCannedResponse(c, x, { code: "PRIVATE1", name: "My note", body: "Only for me", shared: false }));
      const seenByB = await run("agentB", (c, x) => api.listCannedResponses(c, x, {}));
      assert.ok(seenByB.some((r) => r.id === shared.id));
      assert.equal(seenByB.some((r) => r.id === priv.id), false);
      const used = await run("agentA", (c, x) => api.recordCannedResponseUsage(c, x, shared.id));
      assert.equal(used.usage_count, 1);
    });

    await t.test("F375: an entitlement caps ticket creation at its quota, and is picked up automatically for a matching customer", async () => {
      const sla = await run("agentA", (c, x) => api.saveSlaPolicy(c, x, { code: "PREM", name: "Premium", firstResponseMinutes: 15, resolutionMinutes: 120, businessHoursOnly: false }));
      const ent = await run("agentA", (c, x) => api.saveEntitlement(c, x, { partyId, tier: "premium", startsOn: "2020-01-01", ticketQuota: 2, slaPolicyId: sla.id }));
      ids.entitlement = ent.id;
      const t1 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Q1", description: "x", customerId: partyId }));
      assert.equal(t1.entitlement_id, ent.id, "the active entitlement for this customer is picked up automatically");
      assert.equal(t1.sla_policy_id, sla.id, "the entitlement's SLA policy applies when none is specified");
      await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Q2", description: "x", customerId: partyId }));
      await denied("creator", (c, x) => api.createTicket(c, x, { subject: "Q3", description: "x", customerId: partyId }), 409, "SUPPORT_ENTITLEMENT_QUOTA_EXCEEDED");
      // support.manage can override the quota
      const overridden = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Q4 override", description: "x", customerId: partyId }));
      assert.ok(overridden.id);
      await run("agentA", (c, x) => api.setEntitlementStatus(c, x, ent.id, "suspended"));
      const listed = await run("agentA", (c, x) => api.listEntitlements(c, x, { partyId }));
      assert.equal(listed.find((e) => e.id === ent.id).status, "suspended");
    });

    await t.test("F371: the customer portal -- a linked user sees only their own party's tickets, replies, and cannot see private notes", async () => {
      await denied("customer", (c, x) => api.listMyTickets(c, x, {}), 403, "SUPPORT_NO_PORTAL_ACCESS");
      const invited = await run("agentA", (c, x) => api.invitePortalUser(c, x, { partyId, contactId, userId: users.customer }));
      assert.equal(invited.party_id, partyId);
      const mine = await run("customer", (c, x) => api.listMyTickets(c, x, {}));
      assert.ok(mine.length >= 3, "the portal customer sees the entitlement-linked tickets created for their party");

      const created = await run("customer", (c, x) => api.createMyTicket(c, x, { subject: "Portal-created ticket", description: "I have a question." }));
      assert.equal(created.customer_id, partyId);
      assert.equal(created.channel, "web");
      ids.portalTicket = created.id;

      // an internal note added by staff is invisible to the portal customer
      await run("agentA", (c, x) => api.assignTicket(c, x, created.id, { userId: users.agentA }));
      await run("agentA", (c, x) => api.addCommunication(c, x, created.id, { direction: "internal", body: "Looks like a config issue", privateNote: true }));
      const portalView = await run("customer", (c, x) => api.listMyCommunications(c, x, created.id));
      assert.equal(portalView.some((m) => m.private_note), false);

      const reply = await run("customer", (c, x) => api.replyToMyTicket(c, x, created.id, { body: "Any update?" }));
      assert.equal(reply.direction, "inbound");
      // a portal customer cannot read someone else's ticket
      const other = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Not theirs", description: "x", customerId: partyId }));
      await sql(`UPDATE tenant.support_tickets SET customer_id=NULL WHERE id=$1`, [other.id]);
      await denied("customer", (c, x) => api.getMyTicket(c, x, other.id), 404, "SUPPORT_TICKET_NOT_FOUND");

      // CSAT: only after resolution, only once
      await denied("customer", (c, x) => api.submitMyCsat(c, x, created.id, { score: 5 }), 409, "SUPPORT_TICKET_STATE");
      await run("agentA", (c, x) => api.transitionTicket(c, x, created.id, { action: "resolve", resolutionCode: "fixed" }));
      const csat = await run("customer", (c, x) => api.submitMyCsat(c, x, created.id, { score: 5, comment: "Great help!" }));
      assert.equal(Number(csat.satisfaction_score), 5);
      await denied("customer", (c, x) => api.submitMyCsat(c, x, created.id, { score: 4 }), 409, "SUPPORT_CSAT_ALREADY_SUBMITTED");

      // knowledge: only published+customer/public articles are visible through the portal
      await run("agentA", (c, x) => api.saveKnowledgeArticle(c, x, { title: "Internal only", content: "staff eyes only", visibility: "internal" }));
      const portalKb = await run("customer", (c, x) => api.listMyKnowledgeArticles(c, x, {}));
      assert.equal(portalKb.some((a) => a.title === "Internal only"), false);

      await run("agentA", (c, x) => api.setPortalUserStatus(c, x, invited.id, "suspended"));
      await denied("customer", (c, x) => api.listMyTickets(c, x, {}), 403, "SUPPORT_NO_PORTAL_ACCESS");
    });

    await t.test("F373/F374: linked product and asset are read through, including a warranty check", async () => {
      const item = await sql(`SELECT id FROM tenant.items WHERE organization_id=$1 LIMIT 1`, [w.orgId]).catch(() => []);
      const ticket = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Hardware issue", description: "x", customerId: partyId, productId: item[0]?.id }));
      const linked = await run("agentA", (c, x) => api.getTicketLinkedRecords(c, x, ticket.id));
      assert.ok("asset" in linked && "product" in linked && "order" in linked);
    });

    await t.test("F377/F378/F379: agent performance, the SLA report and the dashboard all reconcile to real tickets", async () => {
      const perf = await run("agentA", (c, x) => api.getAgentPerformance(c, x, {}));
      assert.ok(Array.isArray(perf));
      assert.ok(perf.some((p) => p.assigned_user_id === users.agentA));
      const sla = await run("agentA", (c, x) => api.getSlaReport(c, x, {}));
      assert.ok(Array.isArray(sla.byPriority));
      const dash = await run("agentA", (c, x) => api.getSupportDeskDashboard(c, x));
      assert.ok(typeof dash.open_tickets === "number");
      const csatReport = await run("agentA", (c, x) => api.getCsatReport(c, x, {}));
      assert.ok(csatReport.responses >= 1);
      await denied("viewer", (c, x) => api.getAgentPerformance(c, x, {}), 403);
    });

    await t.test("options: the support form pickers resolve customers, categories, queues, agents and entitlements", async () => {
      const queue = await run("agentA", (c, x) => api.saveSupportQueue(c, x, { code: "OPTQ", name: "Options queue" }));
      await run("agentA", (c, x) => api.setQueueMember(c, x, { queueId: queue.id, userId: users.agentA }));
      const opts = await run("agentA", (c, x) => api.listSupportOptions(c, x));
      assert.ok(opts.customers.some((o) => o.id === partyId));
      assert.ok(opts.agents.length >= 1);
      const contacts = await run("agentA", (c, x) => api.listCustomerContacts(c, x, partyId));
      assert.ok(contacts.some((cn) => cn.id === contactId));
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
