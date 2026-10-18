// Email to lead (CRM plan 3.1). An inbound-mail address set to "CRM: new emails open leads, replies join their record" delivers here.
//
// Where an email goes, in order:
//   1. a reply — its In-Reply-To / References name an email already kept on a CRM record — joins that record;
//   2. the subject carries a record's number in brackets ([LEAD-000012], [DEAL-000034]) — it joins that lead or deal;
//   3. the sender already has an open lead — it joins that lead (a second email never opens a second lead);
//   4. otherwise it opens a new lead: the sender's name and address, the subject as what they asked about, the text as the description,
//      source Email, owner by the assignment rules — exactly as a lead typed in, duplicate checks included. A sender the duplicate check
//      matches to an existing contact lands on that contact instead.
// A converted lead hands its mail on to the deal it became. Each email is kept once (by its message id), appears on the record's
// timeline as a completed email activity, keeps its attachments as the record's files, and its owner is told.
import { notifyFollowers } from "../followers/records.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { uploadAttachment } from "../attachments/records.js";
import { CrmError } from "../data-management/errors.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";
import { createLead } from "../leads/records.js";

const TABLES = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities", party: "business_parties", contact: "contacts" });
const HREF = Object.freeze({ lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" });
const OPEN_LEAD = "lead.status IN ('open', 'qualified') AND lead.archived_at IS NULL AND lead.converted_at IS NULL";

// What the delivery may do: open a lead (with its assignment), see every record to thread onto it, and keep files. It is recorded as the
// address's configured member.
export function crmInboundAuthority(route) {
  return {
    organizationId: route.organization_id,
    userId: route.recorded_as_user_id,
    roleSlugs: ["inbound_mail_route"],
    permissions: [LEAD_PERMISSIONS.view, LEAD_PERMISSIONS.create, LEAD_PERMISSIONS.assign, LEAD_PERMISSIONS.viewAll, LEAD_PERMISSIONS.viewSensitive,
      "crm.view", "crm.records.view_all", "crm.attachments.upload", "crm.attachments.view"],
  };
}

async function recordRow(client, organizationId, type, id) {
  const code = type === "contact" ? "contact_number" : "code";
  const extra = type === "lead" ? ", converted_opportunity_id, converted_contact_id" : "";
  return (await client.query(`SELECT id, owner_user_id, ${code} AS code${extra} FROM tenant.${TABLES[type]} WHERE organization_id = $1 AND id = $2`,
    [organizationId, id])).rows[0] ?? null;
}

// A converted lead's mail goes on to its deal (or, without one, its contact).
async function followConversion(client, organizationId, target) {
  if (target.type !== "lead") return target;
  const row = await recordRow(client, organizationId, "lead", target.id);
  if (row?.converted_opportunity_id) return { type: "opportunity", id: row.converted_opportunity_id, how: target.how };
  if (row?.converted_contact_id) return { type: "contact", id: row.converted_contact_id, how: target.how };
  return target;
}

async function threadOf(client, organizationId, message) {
  if (message.references.length) {
    const row = (await client.query(
      `SELECT entity_type, entity_id FROM tenant.crm_email_messages WHERE organization_id = $1 AND message_id = ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`,
      [organizationId, message.references])).rows[0];
    if (row) return { type: row.entity_type, id: row.entity_id, how: "reply" };
  }
  for (const [, code] of message.subject.matchAll(/\[([A-Z][A-Z0-9]{0,9}-\d{1,12})\]/g)) {
    const lead = (await client.query("SELECT id FROM tenant.crm_leads WHERE organization_id = $1 AND code = $2", [organizationId, code])).rows[0];
    if (lead) return { type: "lead", id: lead.id, how: "reference" };
    const deal = (await client.query("SELECT id FROM tenant.crm_opportunities WHERE organization_id = $1 AND code = $2", [organizationId, code])).rows[0];
    if (deal) return { type: "opportunity", id: deal.id, how: "reference" };
  }
  const lead = (await client.query(
    `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lower(lead.email) = $2 AND ${OPEN_LEAD} ORDER BY lead.created_at DESC LIMIT 1`,
    [organizationId, message.from])).rows[0];
  if (lead) return { type: "lead", id: lead.id, how: "sender" };
  return null;
}

function splitName(fromName, address) {
  const name = String(fromName ?? "").replace(/["<>]/g, "").trim();
  if (!name) return { firstName: address.split("@")[0].slice(0, 80) };
  const parts = name.split(/\s+/);
  return parts.length === 1 ? { firstName: parts[0].slice(0, 80) } : { firstName: parts.slice(0, -1).join(" ").slice(0, 80), lastName: parts.at(-1).slice(0, 80) };
}

async function openLead(client, authority, message) {
  const source = (await client.query("SELECT id FROM tenant.crm_lead_sources WHERE organization_id = $1 AND code = 'email' AND status = 'active'", [authority.organizationId])).rows[0];
  const input = {
    ...splitName(message.fromName, message.from),
    email: message.from,
    productInterest: message.subject.slice(0, 200),
    description: (message.text.trim() || message.subject).slice(0, 4000),
    sourceDetail: message.to[0] ? `Email to ${message.to[0]}`.slice(0, 200) : null,
    ...(source ? { sourceId: source.id } : {}),
  };
  try {
    const lead = await createLead(client, authority, input, { origin: "integration" });
    return { type: "lead", id: lead.id, how: "new_lead" };
  } catch (error) {
    if (!(error instanceof CrmError && error.code === "CRM_LEAD_DUPLICATE")) throw error;
    const matches = (error.details?.matches ?? []).filter((match) => match.strength === "exact");
    const target = matches.find((match) => match.kind === "lead" && !match.isArchived) ?? matches.find((match) => match.kind === "contact") ?? matches.find((match) => match.kind === "lead");
    if (!target) throw error;
    return { type: target.kind, id: target.id, how: "sender" };
  }
}

// Delivers one normalised inbound message (core/platform/integrations/inbound-mail) to CRM. `prepared` are its attachments, already
// validated and scanned for CRM's file types. Returns { outcome, recordType, recordId, emailId }.
export async function deliverInboundEmailToCrm(client, route, message, prepared = [], { inboundEventId = null, storage } = {}) {
  const authority = crmInboundAuthority(route);
  const organizationId = authority.organizationId;
  const kept = (await client.query("SELECT id, entity_type, entity_id FROM tenant.crm_email_messages WHERE organization_id = $1 AND message_id = $2",
    [organizationId, message.messageId])).rows[0];
  if (kept) return { outcome: "duplicate", recordType: kept.entity_type, recordId: kept.entity_id, emailId: kept.id };

  let target = await threadOf(client, organizationId, message);
  if (!target) target = await openLead(client, authority, message);
  target = await followConversion(client, organizationId, target);
  const record = await recordRow(client, organizationId, target.type, target.id);
  if (!record) throw new CrmError(404, "The record this email belongs to no longer exists.", "CRM_EMAIL_RECORD_MISSING");

  const description = (message.text.trim() || "(This email had no text.)").slice(0, 20000);
  const activity = (await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at,
                                        external_id, is_inbound, created_by, updated_by)
     VALUES ($1, $2, $3, 'email', $4, $5, 'completed', $6, now(), now(), $7, true, $8, $8) RETURNING id`,
    [organizationId, target.type, target.id, `Email from ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}: ${message.subject}`.slice(0, 300),
      description, record.owner_user_id ?? null, message.messageId.slice(0, 300), authority.userId ?? null])).rows[0];
  const email = (await client.query(
    `INSERT INTO tenant.crm_email_messages (organization_id, entity_type, entity_id, direction, status, message_id, in_reply_to, reference_ids, from_address, from_name,
                                            to_addresses, subject, body_text, activity_id, inbound_event_id)
     VALUES ($1, $2, $3, 'inbound', 'received', $4, $5, $6::text[], $7, $8, $9::text[], $10, $11, $12, $13) RETURNING id`,
    [organizationId, target.type, target.id, message.messageId, message.references[0] ?? null, message.references, message.from, message.fromName ?? null,
      message.to, message.subject, message.text.slice(0, 100000), activity.id, inboundEventId])).rows[0];
  await client.query(`UPDATE tenant.${TABLES[target.type]} SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, target.id]);

  for (const file of prepared)
    await uploadAttachment(client, authority, target.type, target.id, { prepared: file, description: `From the email "${message.subject}"`.slice(0, 500) }, { storage });

  if (record.owner_user_id && record.owner_user_id !== authority.userId) {
    const fresh = target.how === "new_lead";
    await createNotification(client, {
      organizationId, userId: record.owner_user_id, category: "crm_email_received",
      title: fresh ? `New lead from email: ${message.fromName || message.from}` : `Email from ${message.fromName || message.from}`,
      message: `${record.code ? `${record.code} · ` : ""}${message.subject}`.slice(0, 300),
      href: `${HREF[target.type]}${target.id}`, entityType: `crm.${target.type}`, entityId: target.id,
    });
  }
  // The record's other followers hear of it too (CRM plan 4.6); the owner was told above.
  await notifyFollowers(client, organizationId, target.type, target.id, { title: `Email from ${message.fromName || message.from}`, message: message.subject, exceptUserId: record.owner_user_id ?? null });
  return { outcome: `crm_${target.how}`, recordType: target.type, recordId: target.id, emailId: email.id };
}
