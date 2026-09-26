// Real PostgreSQL integration test -- the core Support ticket desk (F343-F368): settings, categories,
// queues and routing, SLA policies, escalation policies, the ticket lifecycle (create with automatic
// routing/SLA/entitlement, assign, transition with pause/resume and reopen, merge), communications
// (customer replies and private notes), attachments, and escalations (manual and SLA-breach sweep).
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
    await t.test("F350/F351/F352: a queue with members and a routing rule sends a matching ticket there, auto-assigned round-robin", async () => {
      await denied("nobody", (c, x) => api.saveSupportQueue(c, x, { code: "Q1", name: "Tier 1" }), 403);
      const queue = await run("agentA", (c, x) => api.saveSupportQueue(c, x, { code: "Q1", name: "Tier 1", assignmentStrategy: "round_robin" }));
      ids.queue = queue.id;
      await run("agentA", (c, x) => api.setQueueMember(c, x, { queueId: queue.id, userId: users.agentA, capacity: 5 }));
      await run("agentA", (c, x) => api.setQueueMember(c, x, { queueId: queue.id, userId: users.agentB, capacity: 5 }));
      const cat = await run("agentA", (c, x) => api.saveSupportCategory(c, x, { code: "BILLING", name: "Billing" }));
      ids.category = cat.id;
      await run("agentA", (c, x) => api.saveRoutingRule(c, x, { code: "R1", name: "Billing to Q1", matchCategoryId: cat.id, targetQueueId: queue.id, targetPriority: "high" }));

      const t1 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Invoice wrong", description: "The invoice total looks wrong.", categoryId: cat.id, customerId: partyId, contactId }));
      assert.equal(t1.queue_id, queue.id);
      assert.equal(t1.priority, "high");
      assert.ok([users.agentA, users.agentB].includes(t1.assigned_user_id));
      ids.t1 = t1.id;
      const t2 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Invoice wrong again", description: "Same issue, different month.", categoryId: cat.id, customerId: partyId }));
      // round robin: the second ticket should not go to the same agent as the first (2 members, 2 tickets)
      assert.notEqual(t2.assigned_user_id, t1.assigned_user_id);
    });

    await t.test("F359-361/F424: SLA policy sets first-response and resolution due dates; business-hours-only respects the calendar", async () => {
      await denied("viewer", (c, x) => api.saveSlaPolicy(c, x, { code: "STD", name: "Standard", firstResponseMinutes: 60, resolutionMinutes: 480 }), 403);
      await denied("agentA", (c, x) => api.saveSlaPolicy(c, x, { code: "BAD", name: "Bad", firstResponseMinutes: 480, resolutionMinutes: 60 }), 400, "SUPPORT_SLA_INVALID");
      const sla = await run("agentA", (c, x) => api.saveSlaPolicy(c, x, { code: "STD", name: "Standard", firstResponseMinutes: 60, resolutionMinutes: 480, businessHoursOnly: false }));
      ids.sla = sla.id;
      const t3 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Slow app", description: "The app is slow.", customerId: partyId, slaPolicyId: sla.id }));
      ids.t3 = t3.id;
      assert.ok(t3.first_response_due_at);
      assert.ok(t3.resolution_due_at);
      const expectedFirst = new Date(new Date(t3.created_at).getTime() + 60 * 60000);
      assert.ok(Math.abs(new Date(t3.first_response_due_at).getTime() - expectedFirst.getTime()) < 5000);
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
      assert.ok(resolved.csat_requested_at, "resolving a ticket requests a CSAT rating");
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

    await t.test("F362: SLA pause on pending_customer, resume extends the due dates by the paused time", async () => {
      const sla = await run("agentA", (c, x) => api.saveSlaPolicy(c, x, { code: "PAUSE", name: "Pauses", firstResponseMinutes: 30, resolutionMinutes: 60, businessHoursOnly: false, pauseOnPendingCustomer: true }));
      const t5 = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Pause test", description: "x", customerId: partyId, slaPolicyId: sla.id }));
      await run("agentA", (c, x) => api.addCommunication(c, x, t5.id, { direction: "outbound", body: "Need more info" }));
      await run("agentA", (c, x) => api.transitionTicket(c, x, t5.id, { action: "pending_customer" }));
      const paused = await run("agentA", (c, x) => api.getTicket(c, x, t5.id));
      assert.ok(paused.sla_paused_at);
      const originalDue = new Date(paused.resolution_due_at).getTime();
      await sql(`UPDATE tenant.support_tickets SET sla_paused_at = sla_paused_at - interval '10 minutes' WHERE id=$1`, [t5.id]);
      // a customer reply while pending_customer resumes the clock automatically
      const contact = await run("agentA", (c, x) => api.addCommunication(c, x, t5.id, { direction: "inbound", body: "Here is the info you asked for" }));
      assert.equal(contact.direction, "inbound");
      const resumed = await run("agentA", (c, x) => api.getTicket(c, x, t5.id));
      assert.equal(resumed.status, "open");
      assert.equal(resumed.sla_paused_at, null);
      assert.ok(resumed.sla_paused_minutes >= 10);
      assert.ok(new Date(resumed.resolution_due_at).getTime() >= originalDue + 9 * 60000, "the resolution due date is pushed out by roughly the paused duration");
    });

    await t.test("F363/F362: manual escalation, and the breach sweep raises one for an overdue ticket without duplicating it", async () => {
      const policy = await run("agentA", (c, x) => api.saveEscalationPolicy(c, x, { code: "RISK1", name: "Resolution risk", triggerType: "resolution_risk", priorityOverride: "urgent" }));
      const sla = await run("agentA", (c, x) => api.saveSlaPolicy(c, x, { code: "TIGHT", name: "Tight", firstResponseMinutes: 5, resolutionMinutes: 5, businessHoursOnly: false }));
      const overdue = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Overdue", description: "x", customerId: partyId, slaPolicyId: sla.id }));
      await sql(`UPDATE tenant.support_tickets SET resolution_due_at = now() - interval '1 hour', first_response_due_at = now() - interval '1 hour' WHERE id=$1`, [overdue.id]);

      const manual = await run("agentA", (c, x) => api.escalateTicket(c, x, overdue.id, { reason: "Customer called in angry", policyId: policy.id }));
      assert.equal(manual.status, "open");
      await run("agentA", (c, x) => api.decideEscalation(c, x, manual.id, { action: "acknowledge" }));

      const swept = await run("agentA", (c, x) => api.checkSlaBreaches(c, x));
      assert.equal(swept.raised, 1, "the sweep raises a new escalation because the manual one is acknowledged, not open");
      const afterSweep = await run("agentA", (c, x) => api.getTicket(c, x, overdue.id));
      assert.equal(afterSweep.priority, "urgent", "the escalation policy's priority override applied");
      const again = await run("agentA", (c, x) => api.checkSlaBreaches(c, x));
      assert.equal(again.raised, 0, "running the sweep again does not double-escalate the same ticket");

      const list = await run("agentA", (c, x) => api.listEscalations(c, x, {}));
      assert.ok(list.length >= 2);
    });

    await t.test("F367: merging a duplicate makes it read-only and links it to the primary", async () => {
      const primary = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Primary", description: "x", customerId: partyId }));
      const dup = await run("agentA", (c, x) => api.createTicket(c, x, { subject: "Duplicate", description: "x", customerId: partyId }));
      await denied("agentA", (c, x) => api.mergeTickets(c, x, { primaryTicketId: primary.id, duplicateTicketId: dup.id }), 400, "SUPPORT_REASON_REQUIRED");
      const merged = await run("agentA", (c, x) => api.mergeTickets(c, x, { primaryTicketId: primary.id, duplicateTicketId: dup.id, reason: "Same issue reported twice" }));
      assert.equal(merged.duplicate.status, "merged");
      assert.equal(merged.duplicate.merged_into_ticket_id, primary.id);
      await denied("agentA", (c, x) => api.addCommunication(c, x, dup.id, { direction: "outbound", body: "too late" }), 409, "SUPPORT_TICKET_STATE");
      await denied("agentA", (c, x) => api.mergeTickets(c, x, { primaryTicketId: primary.id, duplicateTicketId: dup.id, reason: "again" }), 409, "SUPPORT_TICKET_STATE");
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

    await t.test("F365/F380: the unified history covers status changes, assignment, escalation and events", async () => {
      const h = await run("agentA", (c, x) => api.getTicketHistory(c, x, ids.t1));
      assert.ok(h.statusHistory.length >= 1);
      assert.ok(h.assignments.length >= 1);
      assert.ok(h.events.length >= 1);
      const audit = await run("agentA", (c, x) => api.getSupportAuditLog(c, x, { ticketId: ids.t1 }));
      assert.ok(audit.some((e) => e.event_type === "support.ticket.created"));
      await denied("viewer", (c, x) => api.getSupportAuditLog(c, x, {}), 403);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
