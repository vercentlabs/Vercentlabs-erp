// F371: the customer portal -- inviting a customer's user to act for their own party (mirroring HR's
// employee self-service pattern), and portal-scoped wrappers around the ticket/knowledge functions
// that force every read/write to that party's own records.
import { SupportError, need, needAny, ownPortalAccess, qx, requirePortalAccess, resolveParty, text, uuid, uuidOrNull } from "./common.js";
import { addAttachment, addCommunication, createTicket, getTicket, listAttachments, listCommunications, listTickets } from "./tickets.js";
import { getKnowledgeArticle, listKnowledgeArticles } from "./knowledge.js";

const MANAGE = "support.manage";

export async function listPortalUsers(client, c, partyId) {
  needAny(c, ["support.view", MANAGE]);
  const { rows } = await qx(client, `SELECT * FROM tenant.support_portal_users WHERE organization_id=$1 AND company_id=$2 AND ($3::uuid IS NULL OR party_id=$3) ORDER BY created_at`, [c.organizationId, c.companyId, uuidOrNull(partyId, "Customer")]);
  return rows;
}
export async function invitePortalUser(client, c, input) {
  need(c, MANAGE);
  const partyId = uuid(input.partyId, "Customer");
  await resolveParty(client, c, partyId);
  const contactId = uuidOrNull(input.contactId, "Contact");
  if (contactId) {
    const cx = await qx(client, `SELECT id FROM tenant.contacts WHERE organization_id=$1 AND id=$2 AND party_id=$3`, [c.organizationId, contactId, partyId]);
    if (!cx.rows[0]) throw new SupportError(400, "Contact was not found for this customer.", "SUPPORT_CONTACT_INVALID");
  }
  const userId = uuid(input.userId, "User");
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_portal_users(organization_id,company_id,user_id,party_id,contact_id,invited_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, c.companyId, userId, partyId, contactId, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, "That user already has portal access.", "SUPPORT_PORTAL_ALREADY_LINKED");
    throw e;
  }
}
export async function setPortalUserStatus(client, c, id, status) {
  need(c, MANAGE);
  const target = status === "suspended" ? "suspended" : "active";
  const { rows } = await qx(client, `UPDATE tenant.support_portal_users SET status=$4 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Portal user"), target]);
  if (!rows[0]) throw new SupportError(404, "Portal user was not found.", "SUPPORT_PORTAL_NOT_FOUND");
  return rows[0];
}

// Every portal function below forces customerId to the caller's own linked party -- there is no path
// for a portal customer to pass a different party id and see someone else's tickets.
export async function getMyPortalAccess(client, c) {
  return ownPortalAccess(client, c);
}
export async function listMyTickets(client, c, filters = {}) {
  const p = await requirePortalAccess(client, c);
  return listTickets(client, c, { ...filters, forceCustomerId: p.party_id });
}
export async function getMyTicket(client, c, id) {
  const p = await requirePortalAccess(client, c);
  return getTicket(client, c, id, { forceCustomerId: p.party_id });
}
export async function createMyTicket(client, c, input) {
  const p = await requirePortalAccess(client, c);
  // a portal customer creates on their own behalf: no picking a different queue/agent/customer
  return createTicket(client, c, {
    ...input, channel: "web", customerId: p.party_id, contactId: input.contactId ?? p.contact_id ?? undefined, assignedUserId: undefined,
  }, { portal: true });
}
export async function listMyCommunications(client, c, ticketId) {
  const p = await requirePortalAccess(client, c);
  return listCommunications(client, c, ticketId, { forceCustomerId: p.party_id });
}
export async function replyToMyTicket(client, c, ticketId, input) {
  const p = await requirePortalAccess(client, c);
  const contact = p.contact_id ? await qx(client, `SELECT first_name,last_name,email FROM tenant.contacts WHERE id=$1`, [p.contact_id]) : null;
  const identity = contact?.rows[0] ? { name: `${contact.rows[0].first_name} ${contact.rows[0].last_name ?? ""}`.trim(), email: contact.rows[0].email } : undefined;
  return addCommunication(client, c, ticketId, { ...input, direction: "inbound", channel: "web" }, { forceCustomerId: p.party_id, forcePortalIdentity: identity });
}
export async function listMyAttachments(client, c, ticketId) {
  const p = await requirePortalAccess(client, c);
  return listAttachments(client, c, ticketId, { forceCustomerId: p.party_id });
}
export async function addMyAttachment(client, c, ticketId, input) {
  const p = await requirePortalAccess(client, c);
  return addAttachment(client, c, ticketId, input, { forceCustomerId: p.party_id });
}
export async function submitMyCsat(client, c, ticketId, input) {
  const p = await requirePortalAccess(client, c);
  const t = await getTicket(client, c, ticketId, { forceCustomerId: p.party_id });
  if (!["resolved", "closed"].includes(t.status)) throw new SupportError(409, "A satisfaction rating is given once the ticket is resolved.", "SUPPORT_TICKET_STATE");
  if (t.csat_submitted_at) throw new SupportError(409, "A rating has already been submitted for this ticket.", "SUPPORT_CSAT_ALREADY_SUBMITTED");
  const score = Number(input.score);
  if (!(score >= 1 && score <= 5)) throw new SupportError(400, "Rate this from 1 to 5.", "SUPPORT_CSAT_INVALID");
  const { rows } = await qx(client, `UPDATE tenant.support_tickets SET satisfaction_score=$2,csat_comment=$3,csat_submitted_at=now() WHERE organization_id=$1 AND id=$4 RETURNING *`, [c.organizationId, Math.trunc(score), text(input.comment, 1000) || null, t.id]);
  return rows[0];
}
export async function listMyKnowledgeArticles(client, c, filters = {}) {
  await requirePortalAccess(client, c);
  return listKnowledgeArticles(client, c, { ...filters, portal: true });
}
export async function getMyKnowledgeArticle(client, c, id) {
  await requirePortalAccess(client, c);
  return getKnowledgeArticle(client, c, id, { portal: true });
}
