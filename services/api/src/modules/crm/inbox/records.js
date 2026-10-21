// The CRM Inbox (CRM audit navigation): what customers sent lately, in one place — website chats, WhatsApp messages and emails — each
// opening the lead, deal, company or contact it belongs to (a chat opens the chat inbox). Only messages on records the person may see
// (the same record rule tasks use: tasks/access.js taskRelatedScopeSql).
import { canViewSensitiveLeadContent, leadCan } from "../leads/access.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";
import { CrmError } from "../data-management/errors.js";
import { taskRelatedScopeSql } from "../tasks/access.js";

const CHANNELS = Object.freeze(["all", "chat", "whatsapp", "email"]);
const HREF = { lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" };
const RECORD_NAME = (alias) => `CASE ${alias}.entity_type
    WHEN 'lead' THEN (SELECT COALESCE(NULLIF(lead.full_name, ''), lead.company_name, lead.code) FROM tenant.crm_leads lead WHERE lead.organization_id = ${alias}.organization_id AND lead.id = ${alias}.entity_id)
    WHEN 'opportunity' THEN (SELECT deal.name FROM tenant.crm_opportunities deal WHERE deal.organization_id = ${alias}.organization_id AND deal.id = ${alias}.entity_id)
    WHEN 'party' THEN (SELECT party.display_name FROM tenant.business_parties party WHERE party.organization_id = ${alias}.organization_id AND party.id = ${alias}.entity_id)
    WHEN 'contact' THEN (SELECT btrim(person.first_name || ' ' || COALESCE(person.last_name, '')) FROM tenant.contacts person WHERE person.organization_id = ${alias}.organization_id AND person.id = ${alias}.entity_id)
  END`;

// filters: { channel?: "all" | "chat" | "whatsapp" | "email", days? (default 30), limit? }
export async function listInbox(client, context, filters = {}) {
  if (!leadCan(context, LEAD_PERMISSIONS.view)) throw new CrmError(403, "You do not have permission to see the CRM inbox.", "PERMISSION_DENIED");
  const channel = CHANNELS.includes(filters.channel) ? filters.channel : "all";
  const days = Math.min(Math.max(Number(filters.days) || 30, 1), 365);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 300);
  const sensitive = canViewSensitiveLeadContent(context);
  const items = [];
  if (channel === "all" || channel === "chat") {
    const { listChatSessions } = await import("../chat/records.js");
    for (const session of (await listChatSessions(client, context, { status: "all" })).slice(0, limit))
      items.push({ id: `chat:${session.id}`, channel: "chat", from: session.visitorName ?? "Website visitor", text: session.lastMessage ?? "", at: session.lastMessageAt,
        unread: session.unread > 0, recordName: session.leadCode ?? null, href: `/crm/chat?session=${session.id}` });
  }
  // [channel, table, what the message says, who sent it]
  for (const [kind, table, textColumn, fromColumn] of [["whatsapp", "crm_whatsapp_messages", "body", "phone"], ["email", "crm_email_messages", "subject", "COALESCE(message.from_name, message.from_address)"]]) {
    if (channel !== "all" && channel !== kind) continue;
    const values = [context.organizationId, days];
    const scope = taskRelatedScopeSql(context, values, "message");
    const { rows } = await client.query(
      `SELECT message.id, message.entity_type, message.entity_id, message.${textColumn} AS text, ${fromColumn.includes("(") ? fromColumn : `message.${fromColumn}`} AS sender,
              message.created_at AS at, ${RECORD_NAME("message")} AS record_name
         FROM tenant.${table} message
        WHERE message.organization_id = $1 AND message.direction = 'inbound' AND message.created_at >= now() - make_interval(days => $2)${scope}
        ORDER BY message.created_at DESC LIMIT ${limit}`, values);
    for (const row of rows)
      items.push({ id: `${kind}:${row.id}`, channel: kind, from: sensitive ? row.sender ?? null : null, text: String(row.text ?? "").slice(0, 300), at: row.at, unread: false,
        recordName: row.record_name ?? null, href: HREF[row.entity_type] ? `${HREF[row.entity_type]}${row.entity_id}` : null });
  }
  items.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
  return { channel, items: items.slice(0, limit) };
}
