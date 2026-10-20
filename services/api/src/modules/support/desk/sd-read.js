// Support — the ticket desk: reading. The queues with their counts, one ticket (its conversation — private notes only for staff who may
// write them —, attachments, deadlines and whether they are met, assignment and status history, activity and what the person may do), the
// dashboard, the reports and their export, and the options. A person without "view every ticket" sees their own and the unassigned ones.
import { qx } from "../common.js";
import { ACTIVE, DELIVERY, KIND, P, PRIORITY, STATUS, has, need, sdError, text, uuid, visibleSql } from "./sd-rules.js";
import { syncDeliveries } from "./sd-messages.js";

const n = (v) => (v === null || v === undefined ? null : Number(v));
const VIEWS = {
  open: "t.status IN ('new', 'open', 'pending_customer', 'pending_internal')",
  mine: "t.assigned_user_id = $2 AND t.status IN ('new', 'open', 'pending_customer', 'pending_internal')",
  unassigned: "t.assigned_user_id IS NULL AND t.status IN ('new', 'open', 'pending_customer', 'pending_internal')",
  new: "t.status = 'new'",
  pending_customer: "t.status = 'pending_customer'",
  pending_internal: "t.status = 'pending_internal'",
  unmatched: "t.sender_unmatched AND t.status NOT IN ('cancelled', 'merged')",
  response_overdue: "t.first_responded_at IS NULL AND t.first_response_due_at < now() AND t.status IN ('new', 'open', 'pending_internal')",
  resolution_overdue: "t.resolution_due_at < now() AND t.status IN ('new', 'open', 'pending_internal')",
  urgent: "t.priority IN ('urgent', 'high') AND t.status IN ('new', 'open', 'pending_customer', 'pending_internal')",
  resolved: "t.status = 'resolved'",
  closed: "t.status = 'closed'",
  cancelled: "t.status = 'cancelled'",
};
const SELECT = `SELECT t.*, cat.name AS category_name, party.display_name AS party_name, ct.first_name AS contact_first, ct.last_name AS contact_last, agent.full_name AS agent_name,
       mb.name AS mailbox_name, mb.address AS mailbox_address, fu.ticket_number AS follow_up_of_number
  FROM tenant.support_tickets t LEFT JOIN tenant.support_categories cat ON cat.id = t.category_id LEFT JOIN tenant.business_parties party ON party.id = t.customer_id
  LEFT JOIN tenant.contacts ct ON ct.id = t.contact_id LEFT JOIN public.users agent ON agent.id = t.assigned_user_id LEFT JOIN tenant.support_mailboxes mb ON mb.id = t.mailbox_id
  LEFT JOIN tenant.support_tickets fu ON fu.id = t.follow_up_of_ticket_id`;
const clock = (due, done, status) => {
  if (!due) return null;
  if (done) return new Date(done) <= new Date(due) ? "MET" : "MISSED";
  if (!ACTIVE.includes(status)) return null;
  if (status === "pending_customer") return "PAUSED";
  return new Date(due) < new Date() ? "OVERDUE" : "RUNNING";
};
function listView(t) {
  return {
    id: t.id, number: t.ticket_number, subject: t.subject, status: t.status, statusLabel: STATUS[t.status] ?? t.status, priority: t.priority, priorityLabel: PRIORITY[t.priority] ?? t.priority,
    source: t.source, category: t.category_id ? { id: t.category_id, name: t.category_name } : null, customer: t.customer_id ? { id: t.customer_id, name: t.party_name } : null,
    contact: t.contact_id ? { id: t.contact_id, name: `${t.contact_first ?? ""} ${t.contact_last ?? ""}`.trim() } : null, customerName: t.customer_name, customerEmail: t.customer_email,
    agent: t.assigned_user_id ? { id: t.assigned_user_id, name: t.agent_name } : null, unmatched: t.sender_unmatched, reopened: t.reopened_count ?? 0,
    responseDue: t.first_response_due_at, resolutionDue: t.resolution_due_at, response: clock(t.first_response_due_at, t.first_responded_at, t.status),
    resolution: clock(t.resolution_due_at, t.resolved_at, t.status), createdAt: t.created_at, updatedAt: t.updated_at, lastCustomerAt: t.last_customer_message_at,
    followUpOf: t.follow_up_of_ticket_id ? { id: t.follow_up_of_ticket_id, number: t.follow_up_of_number } : null, rowVersion: t.row_version,
  };
}

// filters: view, search, priority, agentId, customerId, from, to
export async function listSupportTickets(client, c, filters = {}) {
  need(c, P.view);
  const values = [c.organizationId, c.userId ?? null];
  const where = ["t.organization_id = $1", visibleSql(c)];
  if (VIEWS[filters.view]) where.push(VIEWS[filters.view]);
  if (filters.priority && PRIORITY[filters.priority]) { values.push(filters.priority); where.push(`t.priority = $${values.length}`); }
  if (filters.agentId) { values.push(uuid(filters.agentId, "Agent")); where.push(`t.assigned_user_id = $${values.length}`); }
  if (filters.customerId) { values.push(uuid(filters.customerId, "Customer")); where.push(`t.customer_id = $${values.length}`); }
  if (filters.from) { values.push(String(filters.from).slice(0, 10)); where.push(`t.created_at >= $${values.length}::date`); }
  if (filters.to) { values.push(String(filters.to).slice(0, 10)); where.push(`t.created_at < $${values.length}::date + 1`); }
  if (filters.search) {
    values.push(`%${text(filters.search, 100)}%`);
    const at = `$${values.length}`;
    where.push(`(t.ticket_number ILIKE ${at} OR t.subject ILIKE ${at} OR t.customer_email ILIKE ${at} OR t.customer_name ILIKE ${at} OR party.display_name ILIKE ${at})`);
  }
  const rows = (await qx(client, `${SELECT} WHERE ${where.join(" AND ")} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(t.first_response_due_at, t.resolution_due_at) NULLS LAST, t.created_at DESC LIMIT 500`, values)).rows;
  return rows.map(listView);
}
export async function getSupportCounts(client, c) {
  need(c, P.view);
  const parts = Object.entries(VIEWS).map(([key, sql]) => `count(*) FILTER (WHERE ${sql})::int AS ${key}`).join(", ");
  return (await qx(client, `SELECT ${parts} FROM tenant.support_tickets t WHERE t.organization_id = $1 AND ${visibleSql(c)}`, [c.organizationId, c.userId ?? null])).rows[0];
}

export async function getSupportTicket(client, c, idValue) {
  need(c, P.view);
  const id = uuid(idValue, "Ticket");
  const row = (await qx(client, `${SELECT} WHERE t.organization_id = $1 AND t.id = $3 AND ${visibleSql(c)}`, [c.organizationId, c.userId ?? null, id])).rows[0];
  if (!row) throw sdError(404, "SUPPORT_TICKET_NOT_FOUND");
  await syncDeliveries(client, c, row.id);
  const staff = has(c, P.note) || has(c, P.sensitive) || has(c, P.manage);
  const messages = (await qx(client, `SELECT m.*, u.full_name AS author FROM tenant.support_communications m LEFT JOIN public.users u ON u.id = m.created_by
      WHERE m.organization_id = $1 AND m.ticket_id = $2 ${staff ? "" : "AND NOT m.private_note"} ORDER BY COALESCE(m.received_at, m.created_at), m.created_at`, [c.organizationId, row.id])).rows;
  const files = (await qx(client, `SELECT a.file_id, a.file_name, a.content_type, a.size_bytes, a.communication_id, a.private_note, a.created_at FROM tenant.support_attachments a
      WHERE a.organization_id = $1 AND a.ticket_id = $2 AND a.file_id IS NOT NULL ${staff ? "" : "AND NOT a.private_note"} ORDER BY a.created_at`, [c.organizationId, row.id])).rows;
  const assignments = (await qx(client, `SELECT a.*, f.full_name AS from_name, t.full_name AS to_name, b.full_name AS by_name FROM tenant.support_ticket_assignments a
      LEFT JOIN public.users f ON f.id = a.from_user_id LEFT JOIN public.users t ON t.id = a.to_user_id LEFT JOIN public.users b ON b.id = a.assigned_by
     WHERE a.organization_id = $1 AND a.ticket_id = $2 ORDER BY a.assigned_at`, [c.organizationId, row.id])).rows;
  const statuses = (await qx(client, `SELECT s.*, u.full_name AS actor FROM tenant.support_ticket_status_history s LEFT JOIN public.users u ON u.id = s.changed_by
      WHERE s.organization_id = $1 AND s.ticket_id = $2 ORDER BY s.changed_at`, [c.organizationId, row.id])).rows;
  const events = (await qx(client, `SELECT e.event_type, e.payload, e.occurred_at, u.full_name AS actor FROM tenant.support_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      WHERE e.organization_id = $1 AND e.ticket_id = $2 ORDER BY e.occurred_at DESC`, [c.organizationId, row.id])).rows;
  const followUps = (await qx(client, `SELECT id, ticket_number, status FROM tenant.support_tickets WHERE organization_id = $1 AND follow_up_of_ticket_id = $2`, [c.organizationId, row.id])).rows;
  const s = row.status;
  const active = ACTIVE.includes(s);
  return {
    ...listView(row), description: row.description, customerPhone: row.customer_phone, tags: row.tags ?? [], mailbox: row.mailbox_id ? { id: row.mailbox_id, name: row.mailbox_name, address: row.mailbox_address } : null,
    candidates: row.sender_candidates ?? [], resolutionSummary: row.resolution_summary, resolutionCode: row.resolution_code, firstRespondedAt: row.first_responded_at, resolvedAt: row.resolved_at,
    closedAt: row.closed_at, reopenedAt: row.reopened_at, pausedMinutes: row.sla_paused_minutes ?? 0,
    messages: messages.map((m) => ({ id: m.id, kind: m.kind, kindLabel: KIND[m.kind] ?? m.kind, private: m.private_note, channel: m.channel, subject: m.subject, body: m.body,
      from: m.kind === "CUSTOMER" ? (m.sender_name || m.sender_address) : (m.author ?? m.sender_name), fromAddress: m.sender_address, to: m.to_addresses ?? [], cc: m.cc_addresses ?? [],
      delivery: m.delivery_status, deliveryLabel: m.delivery_status ? DELIVERY[m.delivery_status] : null, deliveryError: m.delivery_error, at: m.received_at ?? m.created_at,
      files: files.filter((f) => f.communication_id === m.id).map((f) => ({ id: f.file_id, fileName: f.file_name })) })),
    files: files.map((f) => ({ id: f.file_id, fileName: f.file_name, mimeType: f.content_type, sizeBytes: n(f.size_bytes), messageId: f.communication_id, private: f.private_note, at: f.created_at })),
    assignments: assignments.map((a) => ({ from: a.from_name, to: a.to_name, by: a.by_name, reason: a.reason, at: a.assigned_at })),
    statuses: statuses.map((x) => ({ from: x.from_status, to: x.to_status, reason: x.reason, actor: x.actor, at: x.changed_at })),
    history: events.map((e) => ({ type: e.event_type, label: EVENT_LABEL[e.event_type] ?? e.event_type.replace(/^support\.(ticket|mailbox)\./, "").replace(/_/g, " "), at: e.occurred_at, actor: e.actor,
      detail: e.payload?.reason ?? e.payload?.note ?? (e.payload?.outcome ? String(e.payload.outcome).replace(/_/g, " ") : null) })),
    followUps: followUps.map((f) => ({ id: f.id, number: f.ticket_number, status: f.status })),
    can: {
      edit: active && (has(c, P.assign) || has(c, P.communicate)), assign: active && has(c, P.assign), reply: active && has(c, P.reply) && Boolean(row.customer_email),
      note: s !== "cancelled" && (has(c, P.note) || has(c, P.communicate)), logCustomer: active && (has(c, P.communicate) || has(c, P.reply)),
      status: active && s !== "new" && (has(c, P.assign) || has(c, P.reply)), resolve: ["open", "pending_customer", "pending_internal"].includes(s) && has(c, P.resolve),
      close: s === "resolved" && has(c, P.close), reopen: ["resolved", "closed"].includes(s) && has(c, P.reopen), cancel: s === "new" && (has(c, P.assign) || has(c, P.manage)),
      link: row.sender_unmatched && (has(c, P.assign) || has(c, P.communicate)), upload: s !== "cancelled" && (has(c, P.reply) || has(c, P.note) || has(c, P.communicate)),
    },
  };
}
const EVENT_LABEL = {
  "support.ticket.created": "Created", "support.ticket.updated": "Details changed", "support.ticket.assigned": "Assigned", "support.ticket.status": "Status changed",
  "support.ticket.resolved": "Resolved", "support.ticket.closed": "Closed", "support.ticket.reopened": "Reopened", "support.ticket.cancelled": "Cancelled",
  "support.ticket.customer_linked": "Customer linked", "support.ticket.replied": "Replied to the customer", "support.ticket.reply_retried": "Reply sent again",
  "support.ticket.reply_bounced": "Reply bounced", "support.ticket.note_added": "Private note", "support.ticket.customer_message_logged": "Customer message logged",
  "support.ticket.customer_replied": "Customer replied", "support.ticket.email_received": "Email received", "support.ticket.attachment_added": "File added",
  "support.ticket.attachment_removed": "File removed",
};

// ------------------------------------------------------------------ dashboard and reports
export async function getSupportDashboard(client, c) {
  need(c, P.view);
  const counts = await getSupportCounts(client, c);
  const stats = (await qx(client, `SELECT count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS created30,
      count(*) FILTER (WHERE resolved_at >= now() - interval '30 days')::int AS resolved30,
      avg(EXTRACT(EPOCH FROM first_responded_at - created_at) / 60) FILTER (WHERE first_responded_at IS NOT NULL AND created_at >= now() - interval '30 days') AS response_minutes,
      avg(EXTRACT(EPOCH FROM resolved_at - created_at) / 3600) FILTER (WHERE resolved_at IS NOT NULL AND created_at >= now() - interval '30 days') AS resolution_hours,
      count(*) FILTER (WHERE first_responded_at IS NOT NULL AND first_responded_at <= first_response_due_at AND created_at >= now() - interval '30 days')::int AS response_met,
      count(*) FILTER (WHERE first_responded_at IS NOT NULL AND created_at >= now() - interval '30 days')::int AS responded
      FROM tenant.support_tickets t WHERE organization_id = $1 AND ${visibleSql(c)}`, [c.organizationId, c.userId ?? null])).rows[0];
  const failed = Number((await qx(client, `SELECT count(*)::int AS n FROM tenant.support_communications m JOIN tenant.support_tickets t ON t.id = m.ticket_id
      WHERE m.organization_id = $1 AND m.delivery_status IN ('FAILED', 'BOUNCED') AND t.status IN ('new', 'open', 'pending_customer', 'pending_internal')`, [c.organizationId])).rows[0].n);
  return { counts, created30: stats.created30, resolved30: stats.resolved30, failedReplies: failed,
    responseMinutes: stats.response_minutes === null ? null : Math.round(Number(stats.response_minutes)), resolutionHours: stats.resolution_hours === null ? null : Math.round(Number(stats.resolution_hours) * 10) / 10,
    responseMetRate: stats.responded ? Math.round((stats.response_met / stats.responded) * 1000) / 10 : null };
}
export const SUPPORT_REPORTS = Object.freeze({
  register: "Ticket register", by_status: "Tickets by status and priority", by_agent: "Agent workload", by_category: "Tickets by category", by_customer: "Tickets by customer",
  response: "First response against target", resolution: "Resolution against target", reopened: "Reopened tickets", delivery: "Reply delivery problems", unmatched: "Unmatched senders",
});
export async function getSupportReport(client, c, kind, filters = {}) {
  need(c, P.reports, P.manage);
  if (!SUPPORT_REPORTS[kind]) throw sdError(404, "SUPPORT_TICKET_NOT_FOUND", "Unknown report.");
  const from = filters.from ? String(filters.from).slice(0, 10) : "1900-01-01";
  const to = filters.to ? String(filters.to).slice(0, 10) : "2999-12-31";
  const base = `FROM tenant.support_tickets t LEFT JOIN tenant.support_categories cat ON cat.id = t.category_id LEFT JOIN tenant.business_parties party ON party.id = t.customer_id
     LEFT JOIN public.users agent ON agent.id = t.assigned_user_id WHERE t.organization_id = $1 AND t.created_at >= $2::date AND t.created_at < $3::date + 1`;
  const run = async (sql) => (await qx(client, sql, [c.organizationId, from, to])).rows;
  let rows;
  switch (kind) {
    case "register": rows = await run(`SELECT t.ticket_number AS ticket, t.subject, t.status, t.priority, t.source, party.display_name AS customer, t.customer_email, agent.full_name AS agent,
        cat.name AS category, t.created_at, t.first_responded_at, t.resolved_at, t.closed_at, t.reopened_count AS reopened ${base} ORDER BY t.created_at DESC`); break;
    case "by_status": rows = await run(`SELECT t.status, t.priority, count(*)::int AS tickets ${base} GROUP BY t.status, t.priority ORDER BY t.status, t.priority`); break;
    case "by_agent": rows = await run(`SELECT COALESCE(agent.full_name, 'Unassigned') AS agent, count(*) FILTER (WHERE t.status IN ('new', 'open', 'pending_customer', 'pending_internal'))::int AS open,
        count(*) FILTER (WHERE t.status = 'resolved')::int AS resolved, count(*) FILTER (WHERE t.status = 'closed')::int AS closed,
        count(*) FILTER (WHERE t.first_responded_at > t.first_response_due_at OR (t.first_responded_at IS NULL AND t.first_response_due_at < now() AND t.status IN ('new', 'open', 'pending_internal')))::int AS response_missed
        ${base} GROUP BY agent.full_name ORDER BY open DESC`); break;
    case "by_category": rows = await run(`SELECT COALESCE(cat.name, 'Uncategorized') AS category, count(*)::int AS tickets, count(*) FILTER (WHERE t.status IN ('resolved', 'closed'))::int AS resolved
        ${base} GROUP BY cat.name ORDER BY tickets DESC`); break;
    case "by_customer": rows = await run(`SELECT COALESCE(party.display_name, t.customer_email, 'Unknown') AS customer, count(*)::int AS tickets, count(*) FILTER (WHERE t.reopened_count > 0)::int AS reopened
        ${base} GROUP BY COALESCE(party.display_name, t.customer_email, 'Unknown') ORDER BY tickets DESC`); break;
    case "response": rows = await run(`SELECT t.ticket_number AS ticket, t.priority, t.created_at, t.first_response_due_at AS due, t.first_responded_at AS responded_at,
        CASE WHEN t.first_responded_at IS NULL THEN (CASE WHEN t.first_response_due_at < now() THEN 'Overdue' ELSE 'Waiting' END) WHEN t.first_responded_at <= t.first_response_due_at THEN 'Met' ELSE 'Missed' END AS outcome
        ${base} ORDER BY t.created_at DESC`); break;
    case "resolution": rows = await run(`SELECT t.ticket_number AS ticket, t.priority, t.created_at, t.resolution_due_at AS due, t.resolved_at,
        CASE WHEN t.resolved_at IS NULL THEN (CASE WHEN t.resolution_due_at < now() THEN 'Overdue' ELSE 'Open' END) WHEN t.resolved_at <= t.resolution_due_at THEN 'Met' ELSE 'Missed' END AS outcome,
        t.sla_paused_minutes AS paused_minutes ${base} ORDER BY t.created_at DESC`); break;
    case "reopened": rows = await run(`SELECT t.ticket_number AS ticket, t.subject, t.reopened_count AS times, t.reopened_at, t.status ${base} AND t.reopened_count > 0 ORDER BY t.reopened_at DESC`); break;
    case "delivery": rows = await run(`SELECT t.ticket_number AS ticket, m.subject, m.to_addresses AS recipients, m.delivery_status AS delivery, m.delivery_error AS error, m.created_at
        FROM tenant.support_communications m JOIN tenant.support_tickets t ON t.id = m.ticket_id WHERE m.organization_id = $1 AND m.created_at >= $2::date AND m.created_at < $3::date + 1
        AND m.delivery_status IN ('FAILED', 'BOUNCED') ORDER BY m.created_at DESC`); break;
    case "unmatched": rows = await run(`SELECT t.ticket_number AS ticket, t.customer_email AS sender, t.subject, t.status, t.created_at ${base} AND t.sender_unmatched ORDER BY t.created_at DESC`); break;
    default: rows = [];
  }
  return { kind, title: SUPPORT_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, Array.isArray(val) ? val.join(", ") : typeof val === "string" && /^-?\d+\.\d+$/.test(val) ? Number(val) : val]))) };
}
export async function exportSupportReport(client, c, kind = "register", filters = {}) {
  const report = await getSupportReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return { fileName: `support-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body: [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n") };
}

// What the screens offer: agents, categories, mailboxes, customers (with their contacts on demand), the inbound routes, vocabularies.
export async function listSupportOptions(client, c) {
  need(c, P.view);
  const agents = (await qx(client, `SELECT DISTINCT u.id, u.full_name FROM organization_memberships m JOIN public.users u ON u.id = m.user_id
      JOIN user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN roles r ON r.id = a.role_id AND r.status = 'active' LEFT JOIN role_permissions p ON p.role_id = r.id AND p.permission_key IN ('support.ticket.reply', 'support.manage')
     WHERE m.organization_id = $1 AND m.status = 'active' AND (p.permission_key IS NOT NULL OR r.slug = 'organization_owner') ORDER BY u.full_name`, [c.organizationId])).rows;
  const categories = (await qx(client, `SELECT id, name FROM tenant.support_categories WHERE organization_id = $1 AND active ORDER BY name`, [c.organizationId])).rows;
  const mailboxes = (await qx(client, `SELECT id, name, address FROM tenant.support_mailboxes WHERE organization_id = $1 AND status = 'active' ORDER BY name`, [c.organizationId])).rows;
  const customers = (await qx(client, `SELECT id, display_name FROM tenant.business_parties WHERE organization_id = $1 AND party_type IN ('customer', 'both') AND status = 'active' ORDER BY display_name LIMIT 1000`,
    [c.organizationId])).rows;
  const routes = has(c, P.mailbox) ? (await qx(client, `SELECT id, name FROM public.inbound_mail_routes WHERE organization_id = $1 AND target = 'support.email_to_ticket' AND status = 'active' ORDER BY name`,
    [c.organizationId])).rows : [];
  const opt = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
  return { agents: agents.map((u) => ({ value: u.id, label: u.full_name })), categories: categories.map((x) => ({ value: x.id, label: x.name })),
    mailboxes: mailboxes.map((m) => ({ value: m.id, label: `${m.name} <${m.address}>` })), customers: customers.map((x) => ({ value: x.id, label: x.display_name })),
    routes: routes.map((r) => ({ value: r.id, label: r.name })), priorities: opt(PRIORITY), reports: opt(SUPPORT_REPORTS),
    can: { create: has(c, P.create), mailboxes: has(c, P.mailbox), reports: has(c, P.reports) || has(c, P.manage), settings: has(c, P.settings) } };
}
export async function listCustomerContactsForSupport(client, c, customerIdValue) {
  need(c, P.view);
  return (await qx(client, `SELECT ct.id, ct.first_name, ct.last_name, ct.email FROM tenant.contacts ct JOIN tenant.crm_contact_account_relationships link ON link.contact_id = ct.id AND link.status = 'active'
      WHERE ct.organization_id = $1 AND link.party_id = $2 ORDER BY ct.first_name`, [c.organizationId, uuid(customerIdValue, "Customer")])).rows
    .map((x) => ({ value: x.id, label: `${x.first_name ?? ""} ${x.last_name ?? ""}`.trim() + (x.email ? ` <${x.email}>` : ""), email: x.email }));
}
// Settings: targets by priority, the reopen window and whether a customer's reply reopens a resolved ticket.
export async function getSupportDeskSettings(client, c) {
  need(c, P.view);
  const { loadSettings } = await import("./sd-tickets.js");
  const s = await loadSettings(client, c);
  return { defaultPriority: s.default_priority, reopenWindowDays: s.reopen_window_days, reopenOnCustomerReply: s.reopen_on_customer_reply !== false, targets: s.response_targets };
}
export async function saveSupportDeskSettings(client, c, input = {}) {
  need(c, P.settings);
  const targets = {};
  for (const p of Object.keys(PRIORITY)) {
    const t = input.targets?.[p] ?? {};
    const response = Math.trunc(Number(t.response));
    const resolution = Math.trunc(Number(t.resolution));
    if (!(response > 0) || !(resolution >= response)) throw sdError(400, "SUPPORT_TICKET_INVALID", `${PRIORITY[p]}: the response target is more than zero and the resolution target is not shorter.`);
    targets[p] = { response, resolution };
  }
  const days = Math.trunc(Number(input.reopenWindowDays ?? 7));
  if (!(days >= 0 && days <= 365)) throw sdError(400, "SUPPORT_TICKET_INVALID", "The reopen window is 0 to 365 days.");
  const priority = PRIORITY[input.defaultPriority] ? input.defaultPriority : "normal";
  await client.query(`INSERT INTO tenant.support_settings (organization_id, default_priority, reopen_window_days, reopen_on_customer_reply, response_targets) VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (organization_id) DO UPDATE SET default_priority = $2, reopen_window_days = $3, reopen_on_customer_reply = $4, response_targets = $5::jsonb, updated_at = now()`,
  [c.organizationId, priority, days, input.reopenOnCustomerReply !== false, JSON.stringify(targets)]);
  return getSupportDeskSettings(client, c);
}
