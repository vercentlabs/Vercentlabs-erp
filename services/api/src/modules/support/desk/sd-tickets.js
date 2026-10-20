// Support — the ticket desk: tickets and their lifecycle. Each command checks its permission, the state and the row version, writes the
// status / assignment history and an event, and keeps the response and resolution deadlines (from an active SLA policy for the priority,
// else the company's targets; the clock pauses while the ticket waits for the customer).
//
//   createTicket        by hand (subject and description required; customer and contact from the Customer Master) or from email.
//   updateTicket        subject, description, category, priority (deadlines follow the priority), tags.
//   assignTicket        an active member who may work tickets; new → open.
//   setTicketStatus     open ⇄ pending_customer / pending_internal.
//   resolveTicket       the resolution summary is required.
//   closeTicket         resolved → closed.
//   reopenTicket        resolved / closed → open, with a reason (an event; the count and time are kept).
//   cancelTicket        a new ticket raised in error, with a reason.
//   linkTicketCustomer  an unmatched sender's ticket linked to the right customer (and contact).
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { notifyRecordOwner } from "../../../core/platform/notifications/index.js";
import { recordEvent } from "../common.js";
import { ACTIVE, P, PRIORITY, STATUS, email, expectVersion, has, need, oneOf, sdError, text, textOrNull, uuid, uuidOrNull } from "./sd-rules.js";

export const EVENT = (client, c, ticketId, type, payload = {}) => recordEvent(client, c, ticketId, "ticket", ticketId, `support.ticket.${type}`, payload);
export async function loadTicket(client, c, idValue, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.support_tickets WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(idValue, "Ticket")])).rows[0];
  if (!row) throw sdError(404, "SUPPORT_TICKET_NOT_FOUND");
  if (!has(c, P.viewAll) && !has(c, P.manage) && row.assigned_user_id && row.assigned_user_id !== c.userId && !c.roleSlugs?.includes("inbound_mail_route"))
    throw sdError(404, "SUPPORT_TICKET_NOT_FOUND");
  return row;
}
export async function loadSettings(client, c) {
  return (await client.query(`SELECT * FROM tenant.support_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]
    ?? { default_priority: "normal", reopen_window_days: 7, reopen_on_customer_reply: true,
      response_targets: { low: { response: 1440, resolution: 7200 }, normal: { response: 480, resolution: 2880 }, high: { response: 120, resolution: 1440 }, urgent: { response: 30, resolution: 480 } } };
}
// Minutes allowed for the first response and the resolution of a priority.
async function targetsFor(client, c, priority) {
  const policy = (await client.query(`SELECT id, first_response_minutes, resolution_minutes FROM tenant.support_sla_policies WHERE organization_id = $1 AND priority = $2 AND active
      ORDER BY created_at DESC LIMIT 1`, [c.organizationId, priority])).rows[0];
  if (policy) return { policyId: policy.id, response: Number(policy.first_response_minutes), resolution: Number(policy.resolution_minutes) };
  const t = (await loadSettings(client, c)).response_targets?.[priority] ?? { response: 480, resolution: 2880 };
  return { policyId: null, response: Number(t.response), resolution: Number(t.resolution) };
}
const bump = (client, id, sets, values = []) =>
  client.query(`UPDATE tenant.support_tickets SET ${sets}, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1 RETURNING *`, [id, ...values]).then((r) => r.rows[0]);
async function statusHistory(client, c, ticket, from, to, reason = null) {
  await client.query(`INSERT INTO tenant.support_ticket_status_history (organization_id, ticket_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.organizationId, ticket.id, from, to, textOrNull(reason, 500), c.userId ?? null]);
}
export async function isAgent(client, c, userId) {
  return Boolean((await client.query(`SELECT 1 FROM organization_memberships m
      JOIN user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN roles r ON r.id = a.role_id AND r.status = 'active' LEFT JOIN role_permissions p ON p.role_id = r.id AND p.permission_key IN ('support.ticket.reply', 'support.manage')
     WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active' AND (p.permission_key IS NOT NULL OR r.slug = 'organization_owner') LIMIT 1`, [c.organizationId, userId])).rows[0]);
}
async function notifyAgent(client, c, ticket, userId, title, message) {
  if (!userId || userId === c.userId) return;
  await notifyRecordOwner(client, c, { userId, category: "support_ticket", title, message: String(message ?? "").slice(0, 300), href: `/support/tickets/${ticket.id}`,
    entityType: "support_ticket", entityId: ticket.id });
}

// ------------------------------------------------------------------ create
// input: { subject, description, customerId?, contactId?, customerName?, customerEmail?, customerPhone?, categoryId?, priority?, assignedUserId?, tags?,
//          source? (MANUAL | EMAIL), sourceMessageId?, mailboxId?, senderUnmatched?, senderCandidates?, followUpOfTicketId?, idempotencyKey? }
export async function createTicket(client, c, input = {}) {
  need(c, P.create);
  const subject = text(input.subject, 200);
  if (!subject) throw sdError(400, "SUPPORT_TICKET_INVALID", "A ticket needs a subject.");
  const description = text(input.description, 8000);
  const source = input.source === "EMAIL" ? "EMAIL" : "MANUAL";
  if (!description && source === "MANUAL") throw sdError(400, "SUPPORT_TICKET_INVALID", "Describe the issue.");
  const customerId = uuidOrNull(input.customerId, "Customer");
  if (customerId && !(await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [c.organizationId, customerId])).rows[0])
    throw sdError(400, "SUPPORT_TICKET_INVALID", "That customer was not found.");
  const contactId = uuidOrNull(input.contactId, "Contact");
  let contact = null;
  if (contactId) {
    contact = (await client.query(`SELECT ct.id, ct.email, ct.first_name, ct.last_name FROM tenant.contacts ct WHERE ct.organization_id = $1 AND ct.id = $2 AND ($3::uuid IS NULL OR EXISTS (
        SELECT 1 FROM tenant.crm_contact_account_relationships link WHERE link.organization_id = ct.organization_id AND link.contact_id = ct.id AND link.party_id = $3 AND link.status = 'active'))`,
    [c.organizationId, contactId, customerId])).rows[0];
    if (!contact) throw sdError(400, "SUPPORT_CONTACT_INVALID");
  }
  const settings = await loadSettings(client, c);
  const category = uuidOrNull(input.categoryId, "Category");
  const categoryRow = category ? (await client.query(`SELECT id, default_priority FROM tenant.support_categories WHERE organization_id = $1 AND id = $2 AND active`, [c.organizationId, category])).rows[0] : null;
  if (category && !categoryRow) throw sdError(400, "SUPPORT_TICKET_INVALID", "That category is not active.");
  const priority = input.priority ? oneOf(input.priority, PRIORITY, "Priority") : (PRIORITY[categoryRow?.default_priority] ? categoryRow.default_priority : PRIORITY[settings.default_priority] ? settings.default_priority : "normal");
  const agent = uuidOrNull(input.assignedUserId, "Agent");
  if (agent && !(await isAgent(client, c, agent))) throw sdError(400, "SUPPORT_AGENT_INVALID");
  const targets = await targetsFor(client, c, priority);
  const number = await nextDocumentNumber(client, c, { documentType: "support_ticket", prefix: "TKT" });
  const customerEmail = email(input.customerEmail) ?? email(contact?.email);
  const ticket = (await client.query(`INSERT INTO tenant.support_tickets (organization_id, ticket_number, subject, description, channel, source, source_message_id, mailbox_id, category_id,
      assigned_user_id, customer_id, contact_id, customer_name, customer_email, customer_phone, tags, priority, status, sla_policy_id, first_response_due_at, resolution_due_at,
      sender_unmatched, sender_candidates, follow_up_of_ticket_id, source_reference, created_by, updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19, now() + make_interval(mins => $20), now() + make_interval(mins => $21),$22,$23::jsonb,$24,$25,$26,$26)
    RETURNING *`,
  [c.organizationId, number, subject, description || subject, source === "EMAIL" ? "email" : "web", source, textOrNull(input.sourceMessageId, 300), uuidOrNull(input.mailboxId, "Mailbox"), category,
    agent, customerId, contact?.id ?? null, textOrNull(input.customerName, 200) ?? (contact ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || null : null), customerEmail,
    textOrNull(input.customerPhone, 40), JSON.stringify(Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean) : []), priority, agent ? "open" : "new",
    targets.policyId, targets.response, targets.resolution, Boolean(input.senderUnmatched), input.senderCandidates ? JSON.stringify(input.senderCandidates) : null,
    uuidOrNull(input.followUpOfTicketId, "Ticket"), textOrNull(input.sourceReference, 300), c.userId ?? null])).rows[0];
  await statusHistory(client, c, ticket, null, ticket.status, source === "EMAIL" ? "Created from an email" : "Ticket created");
  if (agent) await client.query(`INSERT INTO tenant.support_ticket_assignments (organization_id, ticket_id, from_user_id, to_user_id, reason, assigned_by) VALUES ($1,$2,NULL,$3,'Assigned on creation',$4)`,
    [c.organizationId, ticket.id, agent, c.userId ?? null]);
  await EVENT(client, c, ticket.id, "created", { source, priority, number });
  await notifyAgent(client, c, ticket, agent, `Ticket ${number} is yours`, subject);
  return ticket;
}

// ------------------------------------------------------------------ edit and assign
// input: { subject?, description?, categoryId?, priority?, tags?, version? }
export async function updateTicket(client, c, id, input = {}) {
  need(c, P.assign, P.communicate, P.manage);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  if (!ACTIVE.includes(t.status)) throw sdError(409, "SUPPORT_TICKET_STATE", "A resolved or closed ticket is not edited: reopen it first.");
  const priority = input.priority === undefined ? t.priority : oneOf(input.priority, PRIORITY, "Priority");
  const subject = input.subject === undefined ? t.subject : text(input.subject, 200);
  if (!subject) throw sdError(400, "SUPPORT_TICKET_INVALID", "A ticket needs a subject.");
  const category = input.categoryId === undefined ? t.category_id : uuidOrNull(input.categoryId, "Category");
  let due = "";
  const values = [subject, input.description === undefined ? t.description : text(input.description, 8000) || t.description, category, priority,
    input.tags === undefined ? JSON.stringify(t.tags ?? []) : JSON.stringify(Array.isArray(input.tags) ? input.tags.map((x) => text(x, 40)).filter(Boolean) : []), c.userId ?? null];
  if (priority !== t.priority) {
    const targets = await targetsFor(client, c, priority);
    values.push(targets.response, targets.resolution, targets.policyId);
    due = `, first_response_due_at = CASE WHEN first_responded_at IS NULL THEN created_at + make_interval(mins => $8) + make_interval(mins => sla_paused_minutes) ELSE first_response_due_at END,
      resolution_due_at = created_at + make_interval(mins => $9) + make_interval(mins => sla_paused_minutes), sla_policy_id = $10`;
  }
  await bump(client, t.id, `subject = $2, description = $3, category_id = $4, priority = $5, tags = $6::jsonb, updated_by = $7${due}`, values);
  await EVENT(client, c, t.id, "updated", { priority: priority !== t.priority ? { from: t.priority, to: priority } : undefined });
  return { id: t.id };
}
// input: { userId (null to unassign), reason?, version? }
export async function assignTicket(client, c, id, input = {}) {
  need(c, P.assign);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  if (!ACTIVE.includes(t.status)) throw sdError(409, "SUPPORT_TICKET_STATE", "A resolved or closed ticket is not reassigned.");
  const agent = input.userId === undefined ? c.userId : uuidOrNull(input.userId, "Agent");
  if (agent && !(await isAgent(client, c, agent))) throw sdError(400, "SUPPORT_AGENT_INVALID");
  if (agent === t.assigned_user_id) return { id: t.id, changed: false };
  const next = agent && t.status === "new" ? "open" : t.status;
  await bump(client, t.id, "assigned_user_id = $2, status = $3, updated_by = $4", [agent, next, c.userId ?? null]);
  await client.query(`INSERT INTO tenant.support_ticket_assignments (organization_id, ticket_id, from_user_id, to_user_id, reason, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.organizationId, t.id, t.assigned_user_id, agent, textOrNull(input.reason, 300), c.userId ?? null]);
  if (next !== t.status) await statusHistory(client, c, t, t.status, next, "Assigned");
  await EVENT(client, c, t.id, "assigned", { from: t.assigned_user_id, to: agent });
  await notifyAgent(client, c, t, agent, `Ticket ${t.ticket_number} is yours`, t.subject);
  return { id: t.id, changed: true };
}

// ------------------------------------------------------------------ status
// Pausing the clock while waiting for the customer; resuming pushes the deadlines by the time waited.
export async function moveTicket(client, c, t, to, reason = null) {
  const from = t.status;
  if (from === to) return t;
  let sets = "status = $2, updated_by = $3";
  if (to === "pending_customer") sets += ", sla_paused_at = clock_timestamp()";
  if (from === "pending_customer" && t.sla_paused_at) sets += `, sla_paused_minutes = sla_paused_minutes + GREATEST(0, floor(EXTRACT(EPOCH FROM clock_timestamp() - sla_paused_at) / 60))::int,
    first_response_due_at = CASE WHEN first_responded_at IS NULL THEN first_response_due_at + (clock_timestamp() - sla_paused_at) ELSE first_response_due_at END,
    resolution_due_at = resolution_due_at + (clock_timestamp() - sla_paused_at), sla_paused_at = NULL`;
  const row = await bump(client, t.id, sets, [to, c.userId ?? null]);
  await statusHistory(client, c, t, from, to, reason);
  return row;
}
// input: { status: open | pending_customer | pending_internal, reason?, version? }
export async function setTicketStatus(client, c, id, input = {}) {
  need(c, P.assign, P.reply);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  const to = String(input.status ?? "");
  if (!["open", "pending_customer", "pending_internal"].includes(to)) throw sdError(400, "SUPPORT_TICKET_INVALID", "Choose open, pending customer or pending internal.");
  if (!ACTIVE.includes(t.status)) throw sdError(409, "SUPPORT_TICKET_STATE", "Reopen a resolved or closed ticket first.");
  if (to !== "open" && !t.assigned_user_id) throw sdError(409, "SUPPORT_TICKET_STATE", "Assign the ticket before it waits on someone.");
  await moveTicket(client, c, t, to, input.reason);
  await EVENT(client, c, t.id, "status", { from: t.status, to, reason: textOrNull(input.reason, 500) ?? undefined });
  return { id: t.id, status: to };
}
// input: { resolutionSummary, resolutionCode?, version? }
export async function resolveTicket(client, c, id, input = {}) {
  need(c, P.resolve);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  if (!["open", "pending_customer", "pending_internal"].includes(t.status)) throw sdError(409, "SUPPORT_TICKET_STATE", t.status === "new" ? "Assign the ticket first." : "Only an active ticket is resolved.");
  const summary = text(input.resolutionSummary, 4000);
  if (!summary) throw sdError(400, "SUPPORT_RESOLUTION_REQUIRED");
  const moved = await moveTicket(client, c, t, "resolved", "Resolved");
  await bump(client, moved.id, "resolved_at = clock_timestamp(), resolution_summary = $2, resolution_code = $3", [summary, textOrNull(input.resolutionCode, 60)]);
  await EVENT(client, c, t.id, "resolved", { note: summary });
  return { id: t.id, status: "resolved" };
}
// input: { reason?, version? }
export async function closeTicket(client, c, id, input = {}) {
  need(c, P.close);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  if (t.status !== "resolved") throw sdError(409, "SUPPORT_TICKET_STATE", "Resolve the ticket before closing it.");
  const moved = await moveTicket(client, c, t, "closed", input.reason ?? "Closed");
  await bump(client, moved.id, "closed_at = clock_timestamp()");
  await EVENT(client, c, t.id, "closed", { reason: textOrNull(input.reason, 500) ?? undefined });
  return { id: t.id, status: "closed" };
}
// input: { reason, version? } — opts.byCustomer: the customer's own reply reopened it (no permission needed, the mailbox policy allowed it).
export async function reopenTicket(client, c, id, input = {}, opts = {}) {
  if (!opts.byCustomer) need(c, P.reopen);
  const t = await loadTicket(client, c, id, { lock: true });
  if (!opts.byCustomer) expectVersion(t, input);
  if (!["resolved", "closed"].includes(t.status)) throw sdError(409, "SUPPORT_TICKET_STATE", "Only a resolved or closed ticket is reopened.");
  const reason = text(input.reason, 1000);
  if (!reason) throw sdError(400, "SUPPORT_REASON_REQUIRED");
  const moved = await moveTicket(client, c, t, "open", `Reopened: ${reason}`);
  await bump(client, moved.id, "reopened_count = reopened_count + 1, reopened_at = clock_timestamp(), resolved_at = NULL, closed_at = NULL");
  await EVENT(client, c, t.id, "reopened", { reason, from: t.status, byCustomer: Boolean(opts.byCustomer) });
  await notifyAgent(client, c, t, t.assigned_user_id, `Ticket ${t.ticket_number} was reopened`, reason);
  return { id: t.id, status: "open" };
}
// input: { reason, version? }
export async function cancelTicket(client, c, id, input = {}) {
  need(c, P.assign, P.manage);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  if (t.status !== "new") throw sdError(409, "SUPPORT_TICKET_STATE", "Only a new ticket raised in error is cancelled; resolve the others.");
  const reason = text(input.reason, 1000);
  if (!reason) throw sdError(400, "SUPPORT_REASON_REQUIRED");
  await moveTicket(client, c, t, "cancelled", reason);
  await EVENT(client, c, t.id, "cancelled", { reason });
  return { id: t.id, status: "cancelled" };
}
// input: { customerId, contactId?, version? }
export async function linkTicketCustomer(client, c, id, input = {}) {
  need(c, P.assign, P.communicate);
  const t = await loadTicket(client, c, id, { lock: true });
  expectVersion(t, input);
  const customerId = uuid(input.customerId, "Customer");
  if (!(await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [c.organizationId, customerId])).rows[0])
    throw sdError(400, "SUPPORT_TICKET_INVALID", "That customer was not found.");
  const contactId = uuidOrNull(input.contactId, "Contact");
  if (contactId && !(await client.query(`SELECT 1 FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND party_id = $3 AND status = 'active'`,
    [c.organizationId, contactId, customerId])).rows[0]) throw sdError(400, "SUPPORT_CONTACT_INVALID");
  await bump(client, t.id, "customer_id = $2, contact_id = $3, sender_unmatched = false, updated_by = $4", [customerId, contactId, c.userId ?? null]);
  await EVENT(client, c, t.id, "customer_linked", { customerId, contactId });
  return { id: t.id };
}
export { STATUS };
