// Real PostgreSQL integration test -- the core Support ticket desk (F343-F368): settings, categories, the
// ticket lifecycle (manual creation, agent assignment, transitions and reopen), communications (customer
// replies and private notes), attachments and the ticket history.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_SUPPORT, buildSupportWorld, connectAdmin } from "./support-test-kit.mjs";

const ROLES = {
  agentA: ALL_SUPPORT,
  agentB: ALL_SUPPORT,
  viewer: ["support.view"],
  nobody: [],
};

test("Support ticket desk against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildSupportWorld(admin, ROLES, "sptk");
  const { api, run, denied, sql, users, partyId, contactId } = w;
  const ids = {};

  try {
    await t.test("F343-F348/F351: a ticket gets a number, a customer, a contact, a category and a priority; an agent is assigned manually", async () => {
      await denied("viewer", (c, x) => api.createTicket(c, x, { subject: "x", description: "x" }), 403);
      await denied("agentA", (c, x) => api.createTicket(c, x, { subject: "", description: "x" }), 400, "SUPPORT_TICKET_INVALID");
      const category = await run("agentA", (c, x) => api.saveSupportCategory(c, x, { code: "BILL", name: "Billing" }));
      const t1 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Invoice is wrong", description: "The total does not match.", customerId: partyId, contactId, categoryId: category.id, priority: "high", assignedUserId: users.agentB }));
      assert.match(t1.ticket_number, /^TKT/);
      assert.equal(t1.status, "new");
      assert.equal(t1.priority, "high");
      assert.equal(t1.assigned_user_id, users.agentB);
      ids.t1 = t1.id;
      const t3 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Login is slow", description: "Takes a minute to sign in.", customerId: partyId }));
      assert.equal(t3.assigned_user_id, null);
      ids.t3 = t3.id;
      const mine = await run("agentB", (c, x) => api.listTickets(c, x, { scope: "mine" }));
      assert.ok(mine.some((r) => r.id === t1.id));
    });

    await t.test("F349/F356/F357: the lifecycle -- open, a private note, a customer reply, resolve (needs a code), close", async () => {
      const t3 = await run("agentA", (c, x) => api.getTicket(c, x, ids.t3));
      assert.equal(t3.status, "new");
      await run("agentA", (c, x) => api.assignTicket(c, x, ids.t3, { userId: users.agentA }));
      const afterAssign = await run("agentA", (c, x) => api.getTicket(c, x, ids.t3));
      assert.equal(afterAssign.status, "open");

      await denied("nobody", (c, x) => api.addCommunication(c, x, ids.t3, { direction: "internal", body: "internal note", privateNote: true }), 403);
      const note = await run("agentA", (c, x) => api.addCommunication(c, x, ids.t3, { direction: "internal", body: "Checked the logs, looks like a cache issue.", privateNote: true }));
      assert.equal(note.private_note, true);
      const seenByViewer = await run("viewer", (c, x) => api.listCommunications(c, x, ids.t3));
      assert.equal(seenByViewer.some((m) => m.id === note.id), false, "a private note is hidden without support.sensitive.view");
      const seenBySensitive = await run("agentA", (c, x) => api.listCommunications(c, x, ids.t3));
      assert.equal(seenBySensitive.some((m) => m.id === note.id), true, "the author always sees their own note");

      const reply = await run("agentA", (c, x) => api.addCommunication(c, x, ids.t3, { direction: "outbound", body: "We are looking into it." }));
      assert.equal(reply.direction, "outbound");
      const afterReply = await run("agentA", (c, x) => api.getTicket(c, x, ids.t3));
      assert.ok(afterReply.first_responded_at);

      await denied("agentA", (c, x) => api.transitionTicket(c, x, ids.t3, { action: "resolve" }), 400, "SUPPORT_RESOLUTION_CODE_REQUIRED");
      const resolved = await run("agentA", (c, x) => api.transitionTicket(c, x, ids.t3, { action: "resolve", resolutionCode: "fixed", resolutionSummary: "Cleared the cache." }));
      assert.equal(resolved.status, "resolved");
      const closed = await run("agentB", (c, x) => api.transitionTicket(c, x, ids.t3, { action: "close" }));
      assert.equal(closed.status, "closed");
    });

    await t.test("F366: reopening works within the settings' window and needs a reason", async () => {
      await run("agentA", (c, x) => api.saveSupportSettings(c, x, { reopenWindowDays: 7 }));
      const t4 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Reopen me", description: "Testing reopen.", customerId: partyId }));
      await run("agentA", (c, x) => api.transitionTicket(c, x, t4.id, { action: "open" }));
      await run("agentA", (c, x) => api.transitionTicket(c, x, t4.id, { action: "resolve", resolutionCode: "fixed" }));
      await denied("agentA", (c, x) => api.transitionTicket(c, x, t4.id, { action: "reopen" }), 400, "SUPPORT_REASON_REQUIRED");
      const reopened = await run("agentA", (c, x) => api.transitionTicket(c, x, t4.id, { action: "reopen", reason: "Issue came back" }));
      assert.equal(reopened.status, "open");
      assert.equal(reopened.reopened_count, 1);
      // outside the window: backdate resolved_at past the window and try again
      await run("agentA", (c, x) => api.transitionTicket(c, x, t4.id, { action: "resolve", resolutionCode: "fixed" }));
      await sql(`UPDATE tenant.support_tickets SET resolved_at=now() - interval '10 days' WHERE id=$1`, [t4.id]);
      await denied("agentA", (c, x) => api.transitionTicket(c, x, t4.id, { action: "reopen", reason: "Too late" }), 409, "SUPPORT_REOPEN_WINDOW_EXPIRED");
    });

    await t.test("F358: attachments are size-limited and a private one is hidden without sensitive access", async () => {
      const ticket = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "With attachment", description: "x", customerId: partyId }));
      // Shared Files: an attachment is the uploaded bytes (validated and
      // scanned by prepareFileUpload), never a caller-supplied reference.
      await denied("agentA", (c, x) => api.addAttachment(c, x, ticket.id, { fileName: "notes.txt", sizeBytes: 2048 }), 400, "SUPPORT_ATTACHMENT_UPLOAD_REQUIRED");
      await denied("agentA", (c, x) => api.addAttachment(c, x, ticket.id, { prepared: { fileName: "huge.zip", sizeBytes: 30 * 1024 * 1024 } }), 400, "SUPPORT_ATTACHMENT_TOO_LARGE");
      const prepared = await api.prepareFileUpload({ fileName: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("customer notes"), maximumBytes: 25 * 1024 * 1024 }, { ...process.env, ATTACHMENT_SCAN_MODE: "local" });
      const att = await run("agentA", (c, x) => api.addAttachment(c, x, ticket.id, { prepared, privateNote: true }));
      const seenByViewer = await run("viewer", (c, x) => api.listAttachments(c, x, ticket.id));
      assert.equal(seenByViewer.some((a) => a.id === att.id), false);
      await run("agentA", (c, x) => api.removeAttachment(c, x, att.id));
      const after = await run("agentA", (c, x) => api.listAttachments(c, x, ticket.id));
      assert.equal(after.length, 0);
    });

    await t.test("F365: the unified history covers status changes, assignment and events", async () => {
      const h = await run("agentA", (c, x) => api.getTicketHistory(c, x, ids.t1));
      assert.ok(h.statusHistory.length >= 1);
      assert.ok(h.assignments.length >= 1);
      assert.ok(h.events.length >= 1);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
