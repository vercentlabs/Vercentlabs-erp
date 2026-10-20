// Support — the ticket desk: support mailboxes and email-to-ticket. A support mailbox is an authorized support address connected to an
// inbound-mail route (Settings › Integrations). An email received on it, in order:
//   1. a blocked sender or domain, or our own mailbox writing to itself  → kept as an event, no ticket (spam and loop protection);
//   2. a delivery failure report about one of our replies                → that reply is marked bounced;
//   3. already received (the same Message-ID)                            → nothing more (providers redeliver);
//   4. a reply on a ticket (In-Reply-To / References, then "[TKT-…]")   → a customer message on it: a pending-customer ticket opens again;
//      a resolved one is reopened when the mailbox's policy allows it within the reopen window; a closed (or too old) one gets a follow-up
//      ticket linked to it;
//   5. otherwise a new ticket: the sender is matched to a contact and its customer — exactly one match links them, several or none leave
//      the ticket "unmatched" for an agent to link (never a guess) — with the mailbox's category, priority and agent; an acknowledgement is
//      emailed unless the message is itself automatic (no mail loops).
// The assigned agent is told of new tickets and customer replies. Attachments are kept on the message.
import { notifyRecordOwner } from "../../../core/platform/notifications/index.js";
import { recordEvent } from "../common.js";
import { P, PRIORITY, email, need, oneOf, sdError, text, textOrNull, uuid, uuidOrNull } from "./sd-rules.js";
import { EVENT, createTicket, loadSettings, moveTicket, reopenTicket } from "./sd-tickets.js";
import { emailOnTicket } from "./sd-messages.js";

const CLOSED = new Set(["closed", "cancelled", "merged"]);
// What an email delivery may do on the company's behalf (recorded as the route's configured member).
export function supportMailAuthority(route) {
  return { organizationId: route.organization_id, userId: route.recorded_as_user_id, roleSlugs: ["inbound_mail_route"],
    permissions: [P.view, P.viewAll, P.create, P.communicate, P.reply] };
}

// ------------------------------------------------------------------ mailboxes
export async function listSupportMailboxes(client, c) {
  need(c, P.view);
  return (await client.query(`SELECT m.*, r.name AS route_name, r.status AS route_status, cat.name AS category_name, u.full_name AS agent_name FROM tenant.support_mailboxes m
      LEFT JOIN public.inbound_mail_routes r ON r.id = m.inbound_route_id LEFT JOIN tenant.support_categories cat ON cat.id = m.default_category_id
      LEFT JOIN public.users u ON u.id = m.default_agent_user_id WHERE m.organization_id = $1 ORDER BY m.name`, [c.organizationId])).rows.map((m) => ({
    id: m.id, name: m.name, address: m.address, displayName: m.display_name, routeId: m.inbound_route_id, route: m.route_name ? { name: m.route_name, status: m.route_status } : null,
    categoryId: m.default_category_id, category: m.category_name, priority: m.default_priority, agentId: m.default_agent_user_id, agent: m.agent_name, autoAcknowledge: m.auto_acknowledge,
    replyReopensResolved: m.reply_reopens_resolved, blockedSenders: m.blocked_senders, blockedDomains: m.blocked_domains, signature: m.signature, status: m.status }));
}
// input: { id?, name, address, displayName?, inboundRouteId?, defaultCategoryId?, defaultPriority?, defaultAgentUserId?, autoAcknowledge?, replyReopensResolved?,
//          blockedSenders?, blockedDomains?, signature?, status? }
export async function saveSupportMailbox(client, c, input = {}) {
  need(c, P.mailbox);
  const name = text(input.name, 120);
  const address = email(input.address);
  if (!name || !address) throw sdError(400, "SUPPORT_MAILBOX_INVALID", "Enter the mailbox name and a valid support address.");
  const routeId = uuidOrNull(input.inboundRouteId, "Inbound route");
  if (routeId && !(await client.query(`SELECT 1 FROM public.inbound_mail_routes WHERE id = $1 AND organization_id = $2 AND target = 'support.email_to_ticket'`, [routeId, c.organizationId])).rows[0])
    throw sdError(400, "SUPPORT_MAILBOX_INVALID", "Choose an inbound-mail route that delivers to Support.");
  const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((x) => text(x, 320).toLowerCase()).filter(Boolean).slice(0, 200);
  const values = [c.organizationId, name, address, textOrNull(input.displayName, 120), routeId, uuidOrNull(input.defaultCategoryId, "Category"),
    input.defaultPriority ? oneOf(input.defaultPriority, PRIORITY, "Priority") : "normal", uuidOrNull(input.defaultAgentUserId, "Agent"), input.autoAcknowledge !== false,
    input.replyReopensResolved !== false, list(input.blockedSenders), list(input.blockedDomains).map((d) => d.replace(/^@/, "")), textOrNull(input.signature, 2000),
    input.status === "disabled" ? "disabled" : "active", c.userId ?? null];
  let row;
  try {
    row = input.id
      ? (await client.query(`UPDATE tenant.support_mailboxes SET name = $2, address = $3, display_name = $4, inbound_route_id = $5, default_category_id = $6, default_priority = $7,
          default_agent_user_id = $8, auto_acknowledge = $9, reply_reopens_resolved = $10, blocked_senders = $11, blocked_domains = $12, signature = $13, status = $14, updated_at = clock_timestamp()
          WHERE organization_id = $1 AND id = $16 RETURNING *`, [...values, uuid(input.id, "Mailbox")])).rows[0]
      : (await client.query(`INSERT INTO tenant.support_mailboxes (organization_id, name, address, display_name, inbound_route_id, default_category_id, default_priority, default_agent_user_id,
          auto_acknowledge, reply_reopens_resolved, blocked_senders, blocked_domains, signature, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, values)).rows[0];
  } catch (error) {
    if (error.code === "23505") throw sdError(409, "SUPPORT_MAILBOX_INVALID", "That address or route is already a support mailbox.");
    throw error;
  }
  if (!row) throw sdError(404, "SUPPORT_MAILBOX_INVALID", "That mailbox was not found.");
  await recordEvent(client, c, null, "mailbox", row.id, input.id ? "support.mailbox.updated" : "support.mailbox.created", { address });
  return { id: row.id };
}

// ------------------------------------------------------------------ matching the sender
// Exactly one active contact with this address and exactly one account: linked. Anything else is left for an agent (the candidates kept).
async function matchSender(client, organizationId, address) {
  if (!address) return { customerId: null, contactId: null, unmatched: true, candidates: [] };
  const rows = (await client.query(`SELECT ct.id AS contact_id, ct.first_name, ct.last_name, link.party_id, p.display_name FROM tenant.contacts ct
      LEFT JOIN tenant.crm_contact_account_relationships link ON link.organization_id = ct.organization_id AND link.contact_id = ct.id AND link.status = 'active'
      LEFT JOIN tenant.business_parties p ON p.id = link.party_id
     WHERE ct.organization_id = $1 AND lower(ct.email) = $2 LIMIT 20`, [organizationId, address])).rows;
  const contacts = [...new Set(rows.map((r) => r.contact_id))];
  const parties = [...new Set(rows.map((r) => r.party_id).filter(Boolean))];
  const candidates = rows.map((r) => ({ contactId: r.contact_id, contact: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), customerId: r.party_id, customer: r.display_name }));
  if (contacts.length === 1 && parties.length === 1) return { customerId: parties[0], contactId: contacts[0], unmatched: false, candidates: [] };
  if (!rows.length) {
    const party = (await client.query(`SELECT id, display_name FROM tenant.business_parties WHERE organization_id = $1 AND lower(email) = $2 LIMIT 3`, [organizationId, address])).rows;
    if (party.length === 1) return { customerId: party[0].id, contactId: null, unmatched: false, candidates: [] };
    return { customerId: null, contactId: null, unmatched: true, candidates: party.map((p) => ({ customerId: p.id, customer: p.display_name })) };
  }
  return { customerId: parties.length === 1 ? parties[0] : null, contactId: null, unmatched: true, candidates };
}

async function threadOf(client, organizationId, message) {
  if (message.references.length) {
    const row = (await client.query(`SELECT t.* FROM tenant.support_communications m JOIN tenant.support_tickets t ON t.id = m.ticket_id
        WHERE m.organization_id = $1 AND m.external_message_id = ANY($2::text[]) ORDER BY m.created_at DESC LIMIT 1`, [organizationId, message.references])).rows[0];
    if (row) return row;
  }
  const token = /\[([A-Z0-9/_-]{1,24}-\d{1,12})\]/.exec(message.subject)?.[1];
  if (token) return (await client.query(`SELECT * FROM tenant.support_tickets WHERE organization_id = $1 AND ticket_number = $2`, [organizationId, token])).rows[0] ?? null;
  return null;
}
const isBounce = (message) => /^(mailer-daemon|postmaster)@/i.test(message.from) || /^(undeliver(able|ed)|delivery status notification|returned mail|mail delivery (failed|subsystem))/i.test(message.subject);

async function customerMessage(client, c, ticket, message, mailbox) {
  return (await client.query(`INSERT INTO tenant.support_communications (organization_id, ticket_id, direction, channel, kind, subject, body, sender_name, sender_address, recipient_address,
      to_addresses, external_message_id, reference_ids, private_note, delivery_status, received_at, mailbox_id, created_by)
    VALUES ($1,$2,'inbound','email','CUSTOMER',$3,$4,$5,$6,$7,$8,$9,$10,false,'RECEIVED',clock_timestamp(),$11,$12) RETURNING *`,
  [c.organizationId, ticket.id, text(message.subject, 300), text(message.text, 20000) || "(This email had no text.)", textOrNull(message.fromName, 200), email(message.from),
    message.to[0] ?? null, message.to.map(email).filter(Boolean), message.messageId, message.references, mailbox?.id ?? null, c.userId ?? null])).rows[0];
}
async function tellAgent(client, c, ticket, title, body) {
  if (!ticket.assigned_user_id) return;
  await notifyRecordOwner(client, c, { userId: ticket.assigned_user_id, category: "support_ticket", title, message: String(body ?? "").slice(0, 300), href: `/support/tickets/${ticket.id}`,
    entityType: "support_ticket", entityId: ticket.id });
}

// The delivery of one email received on a Support route. prepared: attachment uploads already validated and scanned. Returns { outcome,
// ticketId, communicationId }.
export async function deliverEmailToSupport(client, route, message, prepared = [], { storage, env = process.env } = {}) {
  const c = supportMailAuthority(route);
  const mailbox = (await client.query(`SELECT * FROM tenant.support_mailboxes WHERE organization_id = $1 AND inbound_route_id = $2 AND status = 'active'`,
    [route.organization_id, route.id])).rows[0] ?? null;
  const sender = email(message.from);
  const domain = sender?.split("@")[1];
  if (mailbox && sender && (mailbox.blocked_senders.includes(sender) || (domain && mailbox.blocked_domains.includes(domain)))) return { outcome: "blocked", ticketId: null, communicationId: null };
  if (mailbox && sender === mailbox.address) return { outcome: "loop", ticketId: null, communicationId: null };
  if (isBounce(message) && message.references.length) {
    const reply = (await client.query(`UPDATE tenant.support_communications SET delivery_status = 'BOUNCED', delivery_error = $3 WHERE organization_id = $1 AND external_message_id = ANY($2::text[])
        AND kind IN ('REPLY', 'SYSTEM') RETURNING id, ticket_id`, [route.organization_id, message.references, text(message.text, 500) || message.subject])).rows[0];
    if (reply) {
      await EVENT(client, c, reply.ticket_id, "reply_bounced", { messageId: reply.id });
      return { outcome: "bounce", ticketId: reply.ticket_id, communicationId: reply.id };
    }
  }
  const duplicate = (await client.query(`SELECT id, ticket_id FROM tenant.support_communications WHERE organization_id = $1 AND external_message_id = $2`, [route.organization_id, message.messageId])).rows[0];
  if (duplicate) return { outcome: "duplicate", ticketId: duplicate.ticket_id, communicationId: duplicate.id };

  const settings = await loadSettings(client, c);
  let ticket = await threadOf(client, route.organization_id, message);
  let outcome = "reply";
  let followUpOf = null;
  if (ticket && ticket.status === "resolved") {
    const days = (Date.now() - new Date(ticket.resolved_at ?? ticket.updated_at).getTime()) / 86400000;
    const reopen = settings.reopen_on_customer_reply !== false && (mailbox ? mailbox.reply_reopens_resolved : true) && days <= Number(settings.reopen_window_days ?? 7);
    if (reopen) {
      await reopenTicket(client, c, ticket.id, { reason: "The customer replied" }, { byCustomer: true });
      outcome = "reopened";
    } else { followUpOf = ticket; ticket = null; }
  } else if (ticket && CLOSED.has(ticket.status)) { followUpOf = ticket; ticket = null; }

  if (!ticket) {
    const match = followUpOf ? { customerId: followUpOf.customer_id, contactId: followUpOf.contact_id, unmatched: followUpOf.sender_unmatched, candidates: [] }
      : await matchSender(client, route.organization_id, sender);
    ticket = await createTicket(client, c, { subject: message.subject, description: message.text || message.subject, source: "EMAIL", sourceMessageId: message.messageId,
      mailboxId: mailbox?.id, customerId: match.customerId, contactId: match.contactId, customerName: message.fromName || null, customerEmail: sender, categoryId: mailbox?.default_category_id,
      priority: mailbox?.default_priority, assignedUserId: mailbox?.default_agent_user_id, senderUnmatched: match.unmatched, senderCandidates: match.candidates.length ? match.candidates : null,
      followUpOfTicketId: followUpOf?.id, sourceReference: `email:${message.messageId}`.slice(0, 300) });
    outcome = followUpOf ? "follow_up" : "new_ticket";
  }
  const communication = await customerMessage(client, c, ticket, message, mailbox);
  for (const file of prepared) {
    const { addTicketAttachment } = await import("./sd-messages.js");
    await addTicketAttachment(client, c, ticket.id, { prepared: file, messageId: communication.id }, { storage });
  }
  await client.query(`UPDATE tenant.support_tickets SET last_customer_message_at = clock_timestamp(), updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [ticket.id]);
  const fresh = (await client.query(`SELECT * FROM tenant.support_tickets WHERE id = $1 FOR UPDATE`, [ticket.id])).rows[0];
  if (fresh.status === "pending_customer") await moveTicket(client, c, fresh, "open", "The customer replied");
  await EVENT(client, c, ticket.id, outcome === "reply" || outcome === "reopened" ? "customer_replied" : "email_received", { messageId: communication.id, outcome });
  if (outcome === "reply" || outcome === "reopened") await tellAgent(client, c, fresh, `${fresh.ticket_number}: the customer replied`, message.subject);
  else await tellAgent(client, c, fresh, `New ticket ${fresh.ticket_number}`, message.subject);
  // The acknowledgement: only to a person (never to an automatic message), and only for a new ticket.
  if ((outcome === "new_ticket" || outcome === "follow_up") && mailbox?.auto_acknowledge && !message.autoSubmitted && sender) {
    await emailOnTicket(client, c, fresh, { mailbox, kind: "SYSTEM", env,
      body: `Thank you for contacting ${mailbox.display_name || mailbox.name}. We have received your message and opened ticket ${fresh.ticket_number}.\n\nReply to this email to add to the same ticket.` });
  }
  return { outcome, ticketId: ticket.id, communicationId: communication.id };
}

// ------------------------------------------------------------------ categories (configurable issue categories)
export async function listSupportCategories(client, c, { includeInactive = false } = {}) {
  need(c, P.view);
  return (await client.query(`SELECT id, code, name, description, default_priority, active FROM tenant.support_categories WHERE organization_id = $1 ${includeInactive ? "" : "AND active"} ORDER BY name`,
    [c.organizationId])).rows.map((x) => ({ id: x.id, code: x.code, name: x.name, description: x.description, defaultPriority: x.default_priority, active: x.active }));
}
// input: { id?, code, name, description?, defaultPriority?, active? }
export async function saveSupportCategory(client, c, input = {}) {
  need(c, P.settings, P.manage);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw sdError(400, "SUPPORT_TICKET_INVALID", "A category needs a code (2–30 letters, digits, - or _) and a name.");
  const priority = input.defaultPriority ? oneOf(input.defaultPriority, PRIORITY, "Default priority") : "normal";
  try {
    const row = input.id
      ? (await client.query(`UPDATE tenant.support_categories SET name = $3, description = $4, default_priority = $5, active = $6, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
        [c.organizationId, uuid(input.id, "Category"), name, textOrNull(input.description, 500), priority, input.active !== false])).rows[0]
      : (await client.query(`INSERT INTO tenant.support_categories (organization_id, code, name, description, default_priority, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [c.organizationId, code, name, textOrNull(input.description, 500), priority, c.userId ?? null])).rows[0];
    if (!row) throw sdError(404, "SUPPORT_TICKET_INVALID", "That category was not found.");
    return { id: row.id };
  } catch (error) {
    if (error.code === "23505") throw sdError(409, "SUPPORT_TICKET_INVALID", `Category ${code} already exists.`);
    throw error;
  }
}
