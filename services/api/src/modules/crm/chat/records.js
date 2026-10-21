// Website chat (CRM plan 5.8): a chat box on the organization's website. The visitor gives a name and an email or mobile and writes;
// the conversation joins that person's open lead, or opens a new lead (source Website chat — converted at once when leads are switched
// off), and is answered from CRM's chat inbox. The visitor's browser holds a random token for its conversation; only its hash is kept.
import { createHash, randomBytes } from "node:crypto";
import { requireCrmOn } from "../data-management/crm-on.js";
import { setTenantContext } from "@vercentlabs/database";

import { createNotification } from "../../../core/platform/notifications/index.js";
import { CrmError } from "../data-management/errors.js";
import { requireLeadPermission } from "../leads/access.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_MESSAGES = 300;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const text = (value) => String(value ?? "").trim();
const invalid = (message, field) => new CrmError(400, message, "CRM_CHAT_VALIDATION", field ? { issues: [{ field, message }] } : {});

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage website chat.", "PERMISSION_DENIED");
}

// ------------------------------------------------------------------ channels (settings)

const toChannel = (row) => ({ id: row.id, name: row.name, publicKey: row.public_key, welcomeMessage: row.welcome_message, allowedOrigins: row.allowed_origins ?? [],
  ownerUserId: row.owner_user_id ?? null, isActive: row.status === "active", openChats: Number(row.open_chats ?? 0) });

export async function listChatChannels(client, context) {
  requireManage(context);
  return (await client.query(
    `SELECT channel.*, (SELECT count(*) FROM tenant.crm_chat_sessions s WHERE s.channel_id = channel.id AND s.status = 'open') AS open_chats
       FROM tenant.crm_chat_channels channel WHERE channel.organization_id = $1 ORDER BY channel.created_at`, [context.organizationId])).rows.map(toChannel);
}

function cleanOrigins(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  const out = [];
  for (const entry of list.map(text).filter(Boolean)) {
    let parsed;
    try { parsed = new URL(entry); } catch { throw invalid(`"${entry}" is not a website address.`, "allowedOrigins"); }
    if (!["https:", "http:"].includes(parsed.protocol)) throw invalid(`"${entry}" is not a website address.`, "allowedOrigins");
    out.push(parsed.origin);
  }
  return [...new Set(out)].slice(0, 20);
}

// input: { name, welcomeMessage?, allowedOrigins?, ownerUserId? } — ownerUserId answers new chats when the lead has no owner.
export async function createChatChannel(client, context, input = {}) {
  requireManage(context);
  const name = text(input.name).slice(0, 80);
  if (!name) throw invalid("Name the chat.", "name");
  const row = (await client.query(
    `INSERT INTO tenant.crm_chat_channels (organization_id, name, public_key, welcome_message, allowed_origins, owner_user_id, created_by)
     VALUES ($1, $2, $3, COALESCE(NULLIF($4, ''), 'Hello! How can we help you?'), $5::text[], $6, $7) RETURNING *`,
    [context.organizationId, name, randomBytes(16).toString("hex"), text(input.welcomeMessage).slice(0, 500), cleanOrigins(input.allowedOrigins),
      UUID.test(String(input.ownerUserId ?? "")) ? input.ownerUserId : null, context.userId ?? null])).rows[0];
  return toChannel(row);
}

export async function updateChatChannel(client, context, channelId, input = {}) {
  requireManage(context);
  const current = UUID.test(String(channelId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_chat_channels WHERE organization_id = $1 AND id = $2", [context.organizationId, channelId])).rows[0] : null;
  if (!current) throw new CrmError(404, "Chat not found.", "CRM_CHAT_NOT_FOUND");
  const row = (await client.query(
    `UPDATE tenant.crm_chat_channels SET name = $3, welcome_message = $4, allowed_origins = $5::text[], owner_user_id = $6, status = $7, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, current.id, input.name !== undefined ? text(input.name).slice(0, 80) || current.name : current.name,
      input.welcomeMessage !== undefined ? text(input.welcomeMessage).slice(0, 500) || current.welcome_message : current.welcome_message,
      input.allowedOrigins !== undefined ? cleanOrigins(input.allowedOrigins) : current.allowed_origins,
      input.ownerUserId !== undefined ? (UUID.test(String(input.ownerUserId ?? "")) ? input.ownerUserId : null) : current.owner_user_id,
      input.isActive === undefined ? current.status : input.isActive ? "active" : "inactive"])).rows[0];
  return toChannel(row);
}

// ------------------------------------------------------------------ public (the visitor)

async function channelOf(client, publicKey, origin = null, selfOrigin = null) {
  if (!/^[0-9a-f]{32}$/.test(String(publicKey ?? ""))) throw new CrmError(404, "Chat not found.", "CRM_CHAT_NOT_FOUND");
  const found = (await client.query("SELECT * FROM tenant.crm_resolve_chat_channel($1)", [publicKey])).rows[0];
  if (!found) throw new CrmError(404, "Chat not found.", "CRM_CHAT_NOT_FOUND");
  await setTenantContext(client, found.organization_id);
  await requireCrmOn(client, found.organization_id, "Chat not found.");
  const channel = (await client.query("SELECT channel.*, organization.name AS organization_name FROM tenant.crm_chat_channels channel JOIN public.organizations organization ON organization.id = channel.organization_id WHERE channel.id = $1",
    [found.channel_id])).rows[0];
  if (origin && channel.allowed_origins?.length && !channel.allowed_origins.includes(origin) && origin !== selfOrigin)
    throw new CrmError(403, "This website may not use the chat.", "CRM_CHAT_ORIGIN");
  return channel;
}

export async function getPublicChat(client, publicKey) {
  const channel = await channelOf(client, publicKey);
  return { name: channel.name, organizationName: channel.organization_name, welcomeMessage: channel.welcome_message };
}

async function sessionOf(client, channel, token) {
  if (!/^[0-9a-f]{48}$/.test(String(token ?? ""))) throw new CrmError(404, "This chat has ended. Start a new one.", "CRM_CHAT_SESSION");
  const session = (await client.query("SELECT * FROM tenant.crm_chat_sessions WHERE organization_id = $1 AND channel_id = $2 AND visitor_token_hash = $3",
    [channel.organization_id, channel.id, hash(token)])).rows[0];
  if (!session) throw new CrmError(404, "This chat has ended. Start a new one.", "CRM_CHAT_SESSION");
  return session;
}

// The lead a chat belongs to: the person's open lead (by email or mobile), else a new one.
async function leadFor(client, channel, visitor) {
  const existing = (await client.query(
    `SELECT id, owner_user_id FROM tenant.crm_leads WHERE organization_id = $1 AND status IN ('open', 'qualified') AND archived_at IS NULL AND merged_into_lead_id IS NULL
        AND (($2::text IS NOT NULL AND lower(email) = $2) OR ($3::text IS NOT NULL AND normalized_mobile = $3)) ORDER BY created_at DESC LIMIT 1`,
    [channel.organization_id, visitor.email, visitor.mobileDigits])).rows[0];
  if (existing) return existing;
  const actor = (await client.query("SELECT created_by FROM public.organizations WHERE id = $1", [channel.organization_id])).rows[0]?.created_by ?? null;
  const authority = { organizationId: channel.organization_id, userId: actor, roleSlugs: [],
    permissions: [LEAD_PERMISSIONS.create, LEAD_PERMISSIONS.assign, LEAD_PERMISSIONS.viewAll, LEAD_PERMISSIONS.viewSensitive, "crm.records.view_all"] };
  const source = (await client.query("SELECT id FROM tenant.crm_lead_sources WHERE organization_id = $1 AND status = 'active' AND code IN ('website_chat', 'website', 'web') ORDER BY (code = 'website_chat') DESC LIMIT 1",
    [channel.organization_id])).rows[0];
  const names = visitor.name.split(/\s+/);
  const { createLead } = await import("../leads/records.js");
  const lead = await createLead(client, authority, {
    firstName: names.length > 1 ? names.slice(0, -1).join(" ") : names[0], lastName: names.length > 1 ? names.at(-1) : undefined,
    email: visitor.email ?? undefined, mobile: visitor.mobile ?? undefined, description: visitor.message.slice(0, 4000),
    sourceDetail: `Website chat: ${channel.name}`.slice(0, 200), ...(source ? { sourceId: source.id } : {}),
    ...(channel.owner_user_id ? { ownerUserId: channel.owner_user_id } : {}),
  }, { origin: "integration" });
  return { id: lead.id, owner_user_id: lead.ownerUserId ?? null };
}

async function tellTeam(client, session, lead, body) {
  const userId = session.assigned_to ?? lead?.owner_user_id ?? null;
  if (!userId) return;
  await createNotification(client, {
    organizationId: session.organization_id, userId, category: "crm_chat_message", title: `Website chat: ${session.visitor_name ?? "a visitor"}`,
    message: body.slice(0, 300), href: `/crm/chat?session=${session.id}`, entityType: "crm.lead", entityId: session.lead_id ?? null,
  });
}

// A visitor starts a chat. input: { name, email?, mobile?, message, pageUrl? } — returns { token, sessionId } (keep the token).
export async function startChat(client, publicKey, input = {}, { origin = null, selfOrigin = null } = {}) {
  const channel = await channelOf(client, publicKey, origin, selfOrigin);
  if (channel.status !== "active") throw new CrmError(404, "Chat not found.", "CRM_CHAT_NOT_FOUND");
  const name = text(input.name).slice(0, 120);
  const email = text(input.email).toLowerCase().slice(0, 320) || null;
  const mobile = text(input.mobile).slice(0, 30) || null;
  const message = text(input.message).slice(0, 2000);
  if (!name) throw invalid("Enter your name.", "name");
  if (!email && !mobile) throw invalid("Enter your email or mobile, so we can reply if you leave.", "email");
  if (email && !EMAIL.test(email)) throw invalid("Enter a valid email.", "email");
  if (!message) throw invalid("Write your message.", "message");
  const mobileDigits = mobile ? mobile.replace(/\D/g, "").slice(-10) : null;
  const lead = await leadFor(client, channel, { name, email, mobile, mobileDigits: mobileDigits ? `+91${mobileDigits}` : null, message });
  // A lead converted at once (leads switched off) still holds the chat; its deal is one click away.
  const token = randomBytes(24).toString("hex");
  const session = (await client.query(
    `INSERT INTO tenant.crm_chat_sessions (organization_id, channel_id, visitor_token_hash, visitor_name, visitor_email, visitor_mobile, page_url, lead_id, assigned_to, unread_by_team)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING *`,
    [channel.organization_id, channel.id, hash(token), name, email, mobile, text(input.pageUrl).slice(0, 500) || null, lead.id, lead.owner_user_id ?? channel.owner_user_id ?? null])).rows[0];
  await client.query("INSERT INTO tenant.crm_chat_messages (organization_id, session_id, sender, body) VALUES ($1, $2, 'system', $3), ($1, $2, 'visitor', $4)",
    [channel.organization_id, session.id, channel.welcome_message, message]);
  await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at, is_inbound, external_id)
     VALUES ($1, 'lead', $2, 'other', $3, $4, 'completed', $5, now(), now(), true, $6)`,
    [channel.organization_id, lead.id, `Website chat started: ${message}`.slice(0, 300), message, session.assigned_to, `chat:${session.id}`]);
  await tellTeam(client, session, lead, message);
  return { token, sessionId: session.id };
}

// The visitor writes again.
export async function postVisitorMessage(client, publicKey, token, body) {
  const channel = await channelOf(client, publicKey);
  const session = await sessionOf(client, channel, token);
  if (session.status !== "open") throw new CrmError(409, "This chat has ended. Start a new one.", "CRM_CHAT_CLOSED");
  const message = text(body).slice(0, 2000);
  if (!message) throw invalid("Write your message.", "message");
  const count = (await client.query("SELECT count(*)::int AS n FROM tenant.crm_chat_messages WHERE session_id = $1", [session.id])).rows[0].n;
  if (count >= MAX_MESSAGES) throw new CrmError(429, "This chat is long: please email us instead.", "CRM_CHAT_FULL");
  await client.query("INSERT INTO tenant.crm_chat_messages (organization_id, session_id, sender, body) VALUES ($1, $2, 'visitor', $3)", [session.organization_id, session.id, message]);
  await client.query("UPDATE tenant.crm_chat_sessions SET last_message_at = now(), unread_by_team = unread_by_team + 1 WHERE id = $1", [session.id]);
  if (session.unread_by_team === 0) await tellTeam(client, session, null, message);
  return { ok: true };
}

const toMessage = (row) => ({ id: row.id, sender: row.sender, body: row.body, authorName: row.author_name ?? null, at: row.created_at });

// What the visitor sees: the messages (after `after`, an ISO time), and whether the chat is still open.
export async function readVisitorChat(client, publicKey, token, { after = null } = {}) {
  const channel = await channelOf(client, publicKey);
  const session = await sessionOf(client, channel, token);
  const messages = (await client.query(
    `SELECT message.*, author.full_name AS author_name FROM tenant.crm_chat_messages message LEFT JOIN users author ON author.id = message.author_user_id
      WHERE message.organization_id = $1 AND message.session_id = $2 AND ($3::timestamptz IS NULL OR message.created_at > $3) ORDER BY message.created_at`,
    [session.organization_id, session.id, after ? new Date(after).toISOString() : null])).rows;
  return { status: session.status, messages: messages.map(toMessage) };
}

// ------------------------------------------------------------------ the inbox (staff)

const toSession = (row) => ({
  id: row.id, channelName: row.channel_name, visitorName: row.visitor_name, visitorEmail: row.visitor_email, visitorMobile: row.visitor_mobile, pageUrl: row.page_url,
  leadId: row.lead_id, leadCode: row.lead_code ?? null, leadStatus: row.lead_status ?? null, opportunityId: row.converted_opportunity_id ?? null,
  assignedTo: row.assigned_to, assignedName: row.assigned_name ?? null, status: row.status, unread: row.unread_by_team, lastMessageAt: row.last_message_at,
  lastMessage: row.last_message ?? null, createdAt: row.created_at,
});
const SESSION_SELECT = `SELECT session.*, channel.name AS channel_name, lead.code AS lead_code, lead.status AS lead_status, lead.converted_opportunity_id, member.full_name AS assigned_name,
    (SELECT body FROM tenant.crm_chat_messages m WHERE m.session_id = session.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
  FROM tenant.crm_chat_sessions session
  JOIN tenant.crm_chat_channels channel ON channel.id = session.channel_id
  LEFT JOIN tenant.crm_leads lead ON lead.organization_id = session.organization_id AND lead.id = session.lead_id
  LEFT JOIN users member ON member.id = session.assigned_to`;

export async function listChatSessions(client, context, { status = "open" } = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to see website chats.");
  return (await client.query(`${SESSION_SELECT} WHERE session.organization_id = $1 AND ($2 = 'all' OR session.status = $2) ORDER BY session.last_message_at DESC LIMIT 200`,
    [context.organizationId, ["open", "closed"].includes(status) ? status : "all"])).rows.map(toSession);
}

// A conversation, its messages read by the team.
export async function getChatSession(client, context, sessionId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to see website chats.");
  const row = UUID.test(String(sessionId ?? "")) ? (await client.query(`${SESSION_SELECT} WHERE session.organization_id = $1 AND session.id = $2`, [context.organizationId, sessionId])).rows[0] : null;
  if (!row) throw new CrmError(404, "Chat not found.", "CRM_CHAT_NOT_FOUND");
  await client.query("UPDATE tenant.crm_chat_sessions SET unread_by_team = 0 WHERE id = $1", [row.id]);
  const messages = (await client.query(
    `SELECT message.*, author.full_name AS author_name FROM tenant.crm_chat_messages message LEFT JOIN users author ON author.id = message.author_user_id
      WHERE message.organization_id = $1 AND message.session_id = $2 ORDER BY message.created_at`, [context.organizationId, row.id])).rows;
  return { ...toSession({ ...row, unread_by_team: 0 }), messages: messages.map(toMessage) };
}

export async function replyToChat(client, context, sessionId, body) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to answer website chats.");
  const session = await getChatSession(client, context, sessionId);
  if (session.status !== "open") throw new CrmError(409, "This chat has ended.", "CRM_CHAT_CLOSED");
  const message = text(body).slice(0, 4000);
  if (!message) throw invalid("Write the reply.", "body");
  await client.query("INSERT INTO tenant.crm_chat_messages (organization_id, session_id, sender, author_user_id, body) VALUES ($1, $2, 'agent', $3, $4)",
    [context.organizationId, session.id, context.userId ?? null, message]);
  await client.query("UPDATE tenant.crm_chat_sessions SET last_message_at = now(), assigned_to = COALESCE(assigned_to, $3) WHERE organization_id = $1 AND id = $2",
    [context.organizationId, session.id, context.userId ?? null]);
  if (session.leadId) await client.query("UPDATE tenant.crm_leads SET last_activity_at = now() WHERE organization_id = $1 AND id = $2", [context.organizationId, session.leadId]);
  return getChatSession(client, context, session.id);
}

// Ends the chat; the conversation is kept on the lead's timeline as one activity.
export async function closeChat(client, context, sessionId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to close website chats.");
  const session = await getChatSession(client, context, sessionId);
  if (session.status === "closed") return session;
  await client.query("UPDATE tenant.crm_chat_sessions SET status = 'closed' WHERE organization_id = $1 AND id = $2", [context.organizationId, session.id]);
  const transcript = session.messages.filter((entry) => entry.sender !== "system")
    .map((entry) => `${entry.sender === "visitor" ? session.visitorName ?? "Visitor" : entry.authorName ?? "Us"}: ${entry.body}`).join("\n").slice(0, 20000);
  if (session.leadId)
    await client.query(
      `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at, created_by, updated_by)
       VALUES ($1, $2, $3, 'other', $4, $5, 'completed', $6, $7, now(), $6, $6)`,
      [context.organizationId, session.opportunityId ? "opportunity" : "lead", session.opportunityId ?? session.leadId, `Website chat with ${session.visitorName ?? "a visitor"}`.slice(0, 300),
        transcript, context.userId ?? null, session.createdAt]);
  return getChatSession(client, context, session.id);
}
