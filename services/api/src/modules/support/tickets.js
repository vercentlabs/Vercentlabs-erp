// F343-F368: the core ticket desk -- settings, categories, queues (with routing and membership), SLA
// policies, escalation policies, the ticket lifecycle itself (create/assign/transition/reopen/merge),
// communications (customer replies and private notes), attachments, and escalation handling.
import {
  CHANNELS, PRIORITIES, SupportError, dateOrNull, emailOrNull, has, need, needAny, nonNegative, oneOf, positive, qx, recordEvent, resolveParty, seq, stripPrivate, text, textOrNull, uuid, uuidOrNull,
} from "./common.js";
import { nextDocumentNumber } from "../../core/document-numbering.js";

const MANAGE = "support.manage";
const VIEW = ["support.view", MANAGE];

// ---------------------------------------------------------------- settings
async function loadSettings(client, c) {
  const { rows } = await qx(client, `SELECT * FROM tenant.support_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]);
  return rows[0] ?? { organization_id: c.organizationId, company_id: c.companyId, default_priority: "normal", require_resolution_code: true, prohibit_self_closure: false, reopen_window_days: 7 };
}
export async function getSupportSettings(client, c) {
  needAny(c, VIEW);
  return loadSettings(client, c);
}
export async function saveSupportSettings(client, c, input) {
  need(c, "support.settings.manage");
  const priority = oneOf(String(input.defaultPriority ?? "normal"), PRIORITIES, "Default priority");
  const reopenDays = Math.trunc(nonNegative(input.reopenWindowDays ?? 7, "Reopen window", 7));
  const { rows } = await qx(client, `INSERT INTO tenant.support_settings(organization_id,company_id,default_priority,require_resolution_code,prohibit_self_closure,reopen_window_days) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (organization_id,company_id) DO UPDATE SET default_priority=$3,require_resolution_code=$4,prohibit_self_closure=$5,reopen_window_days=$6,updated_at=now() RETURNING *`,
    [c.organizationId, c.companyId, priority, input.requireResolutionCode !== false, input.prohibitSelfClosure === true, reopenDays]);
  return rows[0];
}

// ---------------------------------------------------------------- categories (F347)
export async function listCategories(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT cat.*, p.name AS parent_name, q.name AS default_queue_name FROM tenant.support_categories cat
    LEFT JOIN tenant.support_categories p ON p.id=cat.parent_category_id LEFT JOIN tenant.support_queues q ON q.id=cat.default_queue_id
    WHERE cat.organization_id=$1 AND cat.company_id=$2 ORDER BY cat.code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveCategory(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new SupportError(400, "A category needs a code and a name.", "SUPPORT_CATEGORY_INVALID");
  const parentId = uuidOrNull(input.parentCategoryId, "Parent category");
  if (parentId === input.id) throw new SupportError(400, "A category cannot be its own parent.", "SUPPORT_CATEGORY_INVALID");
  const priority = oneOf(String(input.defaultPriority ?? "normal"), PRIORITIES, "Default priority");
  const queueId = uuidOrNull(input.defaultQueueId, "Default queue");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_categories SET name=$4,description=$5,parent_category_id=$6,default_priority=$7,default_queue_id=$8,active=$9,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Category"), name, textOrNull(input.description, 500), parentId, priority, queueId, input.active !== false]);
    if (!rows[0]) throw new SupportError(404, "Category was not found.", "SUPPORT_CATEGORY_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_categories(organization_id,company_id,code,name,description,parent_category_id,default_priority,default_queue_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c.organizationId, c.companyId, code, name, textOrNull(input.description, 500), parentId, priority, queueId, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, `Category ${code} already exists.`, "SUPPORT_CATEGORY_DUPLICATE");
    throw e;
  }
}

// ---------------------------------------------------------------- queues and membership (F350, F351)
export async function listQueues(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT qu.*, (SELECT count(*)::int FROM tenant.support_queue_members m WHERE m.queue_id=qu.id AND m.active) AS member_count,
      (SELECT count(*)::int FROM tenant.support_tickets t WHERE t.queue_id=qu.id AND t.status NOT IN ('resolved','closed','cancelled','merged')) AS open_tickets
    FROM tenant.support_queues qu WHERE qu.organization_id=$1 AND qu.company_id=$2 ORDER BY qu.code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveQueue(client, c, input) {
  need(c, "support.queue.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new SupportError(400, "A queue needs a code and a name.", "SUPPORT_QUEUE_INVALID");
  const strategy = oneOf(String(input.assignmentStrategy ?? "manual"), ["manual", "round_robin", "least_loaded", "skills_based"], "Assignment strategy");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_queues SET name=$4,description=$5,manager_user_id=$6,default_sla_policy_id=$7,assignment_strategy=$8,active=$9,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Queue"), name, textOrNull(input.description, 500), uuidOrNull(input.managerUserId, "Manager"), uuidOrNull(input.defaultSlaPolicyId, "Default SLA policy"), strategy, input.active !== false]);
    if (!rows[0]) throw new SupportError(404, "Queue was not found.", "SUPPORT_QUEUE_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_queues(organization_id,company_id,code,name,description,manager_user_id,default_sla_policy_id,assignment_strategy,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c.organizationId, c.companyId, code, name, textOrNull(input.description, 500), uuidOrNull(input.managerUserId, "Manager"), uuidOrNull(input.defaultSlaPolicyId, "Default SLA policy"), strategy, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, `Queue ${code} already exists.`, "SUPPORT_QUEUE_DUPLICATE");
    throw e;
  }
}
export async function listQueueMembers(client, c, queueId) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT m.* FROM tenant.support_queue_members m WHERE m.organization_id=$1 AND m.queue_id=$2 ORDER BY m.created_at`, [c.organizationId, uuid(queueId, "Queue")]);
  return rows;
}
export async function setQueueMember(client, c, input) {
  need(c, "support.queue.manage");
  const capacity = Math.trunc(positive(input.capacity ?? 20, "Capacity"));
  const { rows } = await qx(client, `INSERT INTO tenant.support_queue_members(organization_id,queue_id,user_id,skill_tags,capacity,active) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
    ON CONFLICT (queue_id,user_id) DO UPDATE SET skill_tags=$4::jsonb,capacity=$5,active=$6 RETURNING *`,
    [c.organizationId, uuid(input.queueId, "Queue"), uuid(input.userId, "User"), JSON.stringify(Array.isArray(input.skillTags) ? input.skillTags : []), capacity, input.active !== false]);
  return rows[0];
}
export async function removeQueueMember(client, c, queueId, userId) {
  need(c, "support.queue.manage");
  await qx(client, `DELETE FROM tenant.support_queue_members WHERE organization_id=$1 AND queue_id=$2 AND user_id=$3`, [c.organizationId, uuid(queueId, "Queue"), uuid(userId, "User")]);
  return { removed: true };
}

// ---------------------------------------------------------------- routing rules (F352)
export async function listRoutingRules(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT r.*, q.name AS target_queue_name, cat.name AS match_category_name FROM tenant.support_routing_rules r
    LEFT JOIN tenant.support_queues q ON q.id=r.target_queue_id LEFT JOIN tenant.support_categories cat ON cat.id=r.match_category_id
    WHERE r.organization_id=$1 AND r.company_id=$2 ORDER BY r.sequence, r.code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveRoutingRule(client, c, input) {
  need(c, "support.queue.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new SupportError(400, "A routing rule needs a code and a name.", "SUPPORT_ROUTING_INVALID");
  const sequence = Math.trunc(nonNegative(input.sequence ?? 100, "Sequence", 100));
  const payload = [
    c.organizationId, c.companyId, code, name, sequence,
    input.matchChannel ? oneOf(String(input.matchChannel), CHANNELS, "Match channel") : null,
    uuidOrNull(input.matchCategoryId, "Match category"),
    textOrNull(input.matchKeyword, 120),
    uuidOrNull(input.targetQueueId, "Target queue"),
    input.targetPriority ? oneOf(String(input.targetPriority), PRIORITIES, "Target priority") : null,
  ];
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_routing_rules SET name=$4,sequence=$5,match_channel=$6,match_category_id=$7,match_keyword=$8,target_queue_id=$9,target_priority=$10,active=$11 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Rule"), ...payload.slice(3), input.active !== false]);
    if (!rows[0]) throw new SupportError(404, "Routing rule was not found.", "SUPPORT_ROUTING_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_routing_rules(organization_id,company_id,code,name,sequence,match_channel,match_category_id,match_keyword,target_queue_id,target_priority,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [...payload, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, `Routing rule ${code} already exists.`, "SUPPORT_ROUTING_DUPLICATE");
    throw e;
  }
}
export async function deactivateRoutingRule(client, c, id) {
  need(c, "support.queue.manage");
  const { rows } = await qx(client, `UPDATE tenant.support_routing_rules SET active=false WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Rule")]);
  if (!rows[0]) throw new SupportError(404, "Routing rule was not found.", "SUPPORT_ROUTING_NOT_FOUND");
  return rows[0];
}

// Resolve which queue/priority a new ticket lands in: first matching active rule wins, in sequence
// order; a keyword match checks the subject and description case-insensitively. Falls back to the
// category's default queue, then stays unassigned.
async function routeTicket(client, c, { channel, categoryId, subject, description }) {
  const { rows } = await qx(client, `SELECT * FROM tenant.support_routing_rules WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY sequence, code`, [c.organizationId, c.companyId]);
  const haystack = `${subject} ${description}`.toLowerCase();
  for (const r of rows) {
    if (r.match_channel && r.match_channel !== channel) continue;
    if (r.match_category_id && r.match_category_id !== categoryId) continue;
    if (r.match_keyword && !haystack.includes(String(r.match_keyword).toLowerCase())) continue;
    return { queueId: r.target_queue_id, priority: r.target_priority };
  }
  if (categoryId) {
    const cat = await qx(client, `SELECT default_queue_id, default_priority FROM tenant.support_categories WHERE organization_id=$1 AND id=$2`, [c.organizationId, categoryId]);
    if (cat.rows[0]?.default_queue_id) return { queueId: cat.rows[0].default_queue_id, priority: null };
  }
  return { queueId: null, priority: null };
}

// Pick which agent within a queue gets a ticket, per the queue's assignment strategy. Manual queues
// return null (an agent picks it up, or a supervisor assigns it by hand).
async function pickAssignee(client, c, queueId, { categoryTags = [] } = {}) {
  const queue = (await qx(client, `SELECT * FROM tenant.support_queues WHERE organization_id=$1 AND id=$2`, [c.organizationId, queueId])).rows[0];
  if (!queue || queue.assignment_strategy === "manual") return null;
  const members = (await qx(client, `SELECT * FROM tenant.support_queue_members WHERE organization_id=$1 AND queue_id=$2 AND active ORDER BY user_id`, [c.organizationId, queueId])).rows;
  if (!members.length) return null;
  if (queue.assignment_strategy === "skills_based" && categoryTags.length) {
    const matched = members.filter((m) => (m.skill_tags || []).some((t) => categoryTags.includes(t)));
    if (matched.length) return pickLeastLoaded(client, c, matched);
  }
  if (queue.assignment_strategy === "least_loaded") return pickLeastLoaded(client, c, members);
  // round_robin: whoever in the queue was assigned longest ago (or never)
  const last = await qx(client, `SELECT assigned_user_id, max(created_at) AS last_at FROM tenant.support_tickets WHERE organization_id=$1 AND queue_id=$2 AND assigned_user_id = ANY($3::uuid[]) GROUP BY assigned_user_id`,
    [c.organizationId, queueId, members.map((m) => m.user_id)]);
  const lastByUser = Object.fromEntries(last.rows.map((r) => [r.assigned_user_id, new Date(r.last_at).getTime()]));
  return members.map((m) => m.user_id).sort((a, b) => (lastByUser[a] ?? 0) - (lastByUser[b] ?? 0))[0];
}
async function pickLeastLoaded(client, c, members) {
  const load = await qx(client, `SELECT assigned_user_id, count(*)::int AS n FROM tenant.support_tickets WHERE organization_id=$1 AND assigned_user_id = ANY($2::uuid[]) AND status NOT IN ('resolved','closed','cancelled','merged') GROUP BY assigned_user_id`,
    [c.organizationId, members.map((m) => m.user_id)]);
  const loadByUser = Object.fromEntries(load.rows.map((r) => [r.assigned_user_id, r.n]));
  return members.map((m) => m.user_id).sort((a, b) => (loadByUser[a] ?? 0) - (loadByUser[b] ?? 0))[0];
}

// ---------------------------------------------------------------- SLA policies (F359-361)
export async function listSlaPolicies(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT * FROM tenant.support_sla_policies WHERE organization_id=$1 AND company_id=$2 ORDER BY code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveSlaPolicy(client, c, input) {
  need(c, "support.sla.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new SupportError(400, "An SLA policy needs a code and a name.", "SUPPORT_SLA_INVALID");
  const firstResponse = Math.trunc(positive(input.firstResponseMinutes, "First-response target"));
  const resolution = Math.trunc(positive(input.resolutionMinutes, "Resolution target"));
  if (resolution < firstResponse) throw new SupportError(400, "The resolution target cannot be shorter than the first-response target.", "SUPPORT_SLA_INVALID");
  const priority = input.priority ? oneOf(String(input.priority), PRIORITIES, "Priority") : null;
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_sla_policies SET name=$4,description=$5,priority=$6,first_response_minutes=$7,resolution_minutes=$8,pause_on_pending_customer=$9,business_hours_only=$10,active=$11,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "SLA policy"), name, textOrNull(input.description, 500), priority, firstResponse, resolution, input.pauseOnPendingCustomer !== false, input.businessHoursOnly !== false, input.active !== false]);
    if (!rows[0]) throw new SupportError(404, "SLA policy was not found.", "SUPPORT_SLA_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_sla_policies(organization_id,company_id,code,name,description,priority,first_response_minutes,resolution_minutes,pause_on_pending_customer,business_hours_only,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [c.organizationId, c.companyId, code, name, textOrNull(input.description, 500), priority, firstResponse, resolution, input.pauseOnPendingCustomer !== false, input.businessHoursOnly !== false, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, `SLA policy ${code} already exists.`, "SUPPORT_SLA_DUPLICATE");
    throw e;
  }
}
export async function deactivateSlaPolicy(client, c, id) {
  need(c, "support.sla.manage");
  const { rows } = await qx(client, `UPDATE tenant.support_sla_policies SET active=false,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(id, "SLA policy")]);
  if (!rows[0]) throw new SupportError(404, "SLA policy was not found.", "SUPPORT_SLA_NOT_FOUND");
  return rows[0];
}

// A simplified business calendar (Mon-Fri, 09:00-18:00, no holiday calendar) used only when the SLA
// policy is business-hours-only; a 24x7 policy just adds the raw minutes.
function addBusinessMinutes(from, minutes) {
  let remaining = minutes;
  let cur = new Date(from);
  while (remaining > 0) {
    const day = cur.getUTCDay();
    const hour = cur.getUTCHours();
    if (day === 0 || day === 6) { cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + (day === 0 ? 1 : 2), 9, 0, 0)); continue; }
    if (hour < 9) { cur.setUTCHours(9, 0, 0, 0); continue; }
    if (hour >= 18) { cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 1, 9, 0, 0)); continue; }
    const minutesLeftToday = (18 - hour) * 60 - cur.getUTCMinutes();
    const step = Math.min(remaining, minutesLeftToday);
    cur = new Date(cur.getTime() + step * 60000);
    remaining -= step;
  }
  return cur;
}
function dueAt(from, minutes, businessHoursOnly) {
  return businessHoursOnly ? addBusinessMinutes(from, minutes) : new Date(from.getTime() + minutes * 60000);
}

// ---------------------------------------------------------------- escalation policies (F363)
export async function listEscalationPolicies(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT * FROM tenant.support_escalation_policies WHERE organization_id=$1 AND company_id=$2 ORDER BY code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveEscalationPolicy(client, c, input) {
  need(c, "support.escalation.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new SupportError(400, "An escalation policy needs a code and a name.", "SUPPORT_ESCALATION_INVALID");
  const triggerType = oneOf(String(input.triggerType ?? "manual"), ["first_response_risk", "resolution_risk", "priority", "customer_tier", "manual"], "Trigger type");
  const payload = [c.organizationId, c.companyId, code, name, triggerType, textOrNull(input.triggerValue, 60), uuidOrNull(input.targetQueueId, "Target queue"), uuidOrNull(input.targetUserId, "Target user"), input.priorityOverride ? oneOf(String(input.priorityOverride), PRIORITIES, "Priority override") : null, JSON.stringify(Array.isArray(input.notificationTargets) ? input.notificationTargets : [])];
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_escalation_policies SET name=$4,trigger_type=$5,trigger_value=$6,target_queue_id=$7,target_user_id=$8,priority_override=$9,notification_targets=$10::jsonb,active=$11 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Escalation policy"), ...payload.slice(3), input.active !== false]);
    if (!rows[0]) throw new SupportError(404, "Escalation policy was not found.", "SUPPORT_ESCALATION_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_escalation_policies(organization_id,company_id,code,name,trigger_type,trigger_value,target_queue_id,target_user_id,priority_override,notification_targets,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [...payload, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, `Escalation policy ${code} already exists.`, "SUPPORT_ESCALATION_DUPLICATE");
    throw e;
  }
}

// ---------------------------------------------------------------- tickets: create (F343-346,348,349,354,355)
const TICKET_SELECT = `t.*, cat.name AS category_name, q.name AS queue_name, party.display_name AS party_name, contact.first_name AS contact_first_name, contact.last_name AS contact_last_name`;
const TICKET_JOIN = `LEFT JOIN tenant.support_categories cat ON cat.id=t.category_id LEFT JOIN tenant.support_queues q ON q.id=t.queue_id LEFT JOIN tenant.business_parties party ON party.id=t.customer_id LEFT JOIN tenant.contacts contact ON contact.id=t.contact_id`;

export async function createTicket(client, c, input, { portal = false } = {}) {
  if (!portal) need(c, "support.ticket.create");
  const subject = text(input.subject, 200);
  const description = text(input.description, 8000);
  if (!subject) throw new SupportError(400, "A ticket needs a subject.", "SUPPORT_TICKET_INVALID");
  if (!description) throw new SupportError(400, "A ticket needs a description.", "SUPPORT_TICKET_INVALID");
  const channel = oneOf(String(input.channel ?? "web"), CHANNELS, "Channel");
  const categoryId = uuidOrNull(input.categoryId, "Category");
  const customerId = uuidOrNull(input.customerId, "Customer");
  if (customerId) await resolveParty(client, c, customerId);
  const contactId = uuidOrNull(input.contactId, "Contact");
  if (contactId) {
    const cx = await qx(client, `SELECT id FROM tenant.contacts WHERE organization_id=$1 AND id=$2 AND ($3::uuid IS NULL OR party_id=$3)`, [c.organizationId, contactId, customerId]);
    if (!cx.rows[0]) throw new SupportError(400, "Contact was not found for this customer.", "SUPPORT_CONTACT_INVALID");
  }

  const settings = await loadSettings(client, c);
  const routed = await routeTicket(client, c, { channel, categoryId, subject, description });
  const queueId = uuidOrNull(input.queueId, "Queue") ?? routed.queueId;
  let priority = input.priority ? oneOf(String(input.priority), PRIORITIES, "Priority") : (routed.priority ?? settings.default_priority);

  // entitlement: resolve an active one for this customer (+ product, if given); enforce its quota
  let entitlementId = uuidOrNull(input.entitlementId, "Entitlement");
  let entitlement = null;
  const productId = uuidOrNull(input.productId, "Product");
  if (!entitlementId && customerId) {
    const found = await qx(client, `SELECT * FROM tenant.support_entitlements WHERE organization_id=$1 AND party_id=$2 AND status='active' AND starts_on<=current_date AND (ends_on IS NULL OR ends_on>=current_date) AND (product_id IS NULL OR product_id=$3) ORDER BY product_id NULLS LAST LIMIT 1 FOR UPDATE`, [c.organizationId, customerId, productId]);
    entitlement = found.rows[0] ?? null;
    entitlementId = entitlement?.id ?? null;
  } else if (entitlementId) {
    const found = await qx(client, `SELECT * FROM tenant.support_entitlements WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, entitlementId]);
    entitlement = found.rows[0] ?? null;
  }
  if (entitlement && entitlement.ticket_quota !== null && entitlement.tickets_used >= entitlement.ticket_quota && !has(c, MANAGE)) {
    throw new SupportError(409, `This entitlement's ticket quota (${entitlement.ticket_quota}) is used up.`, "SUPPORT_ENTITLEMENT_QUOTA_EXCEEDED");
  }

  const slaPolicyId = uuidOrNull(input.slaPolicyId, "SLA policy") ?? entitlement?.sla_policy_id ?? null;
  let sla = null;
  if (slaPolicyId) {
    const s = await qx(client, `SELECT * FROM tenant.support_sla_policies WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, slaPolicyId]);
    sla = s.rows[0] ?? null;
  }
  const now = new Date();
  const firstResponseDueAt = sla ? dueAt(now, sla.first_response_minutes, sla.business_hours_only) : null;
  const resolutionDueAt = sla ? dueAt(now, sla.resolution_minutes, sla.business_hours_only) : null;
  const ticketNumber = await nextDocumentNumber(client, c, { documentType: "support_ticket", prefix: "TKT" });
  const assignedUserId = uuidOrNull(input.assignedUserId, "Agent") ?? (queueId ? await pickAssignee(client, c, queueId) : null);

  const { rows } = await qx(client, `INSERT INTO tenant.support_tickets
      (organization_id,company_id,branch_id,ticket_number,subject,description,channel,category_id,queue_id,assigned_user_id,customer_id,contact_id,
       customer_name,customer_email,customer_phone,related_asset_id,related_sales_order_id,related_project_id,product_id,entitlement_id,tags,
       priority,status,sla_policy_id,first_response_due_at,resolution_due_at,source_reference,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,'new',$23,$24,$25,$26,$27,$27) RETURNING *`,
    [c.organizationId, c.companyId, uuidOrNull(input.branchId, "Branch"), ticketNumber, subject, description, channel, categoryId, queueId, assignedUserId,
      customerId, contactId, textOrNull(input.customerName, 200), emailOrNull(input.customerEmail), textOrNull(input.customerPhone, 30),
      uuidOrNull(input.relatedAssetId, "Asset"), uuidOrNull(input.relatedSalesOrderId, "Sales order"), uuidOrNull(input.relatedProjectId, "Project"),
      productId, entitlementId, JSON.stringify(Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean) : []),
      priority, slaPolicyId, firstResponseDueAt, resolutionDueAt, textOrNull(input.sourceReference, 300), c.userId]);
  const ticket = rows[0];

  await qx(client, `INSERT INTO tenant.support_ticket_status_history(organization_id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,NULL,'new','Ticket created',$3)`, [c.organizationId, ticket.id, c.userId]);
  if (assignedUserId) await qx(client, `INSERT INTO tenant.support_ticket_assignments(organization_id,ticket_id,from_queue_id,to_queue_id,from_user_id,to_user_id,reason,assigned_by) VALUES ($1,$2,NULL,$3,NULL,$4,'Routed on creation',$5)`, [c.organizationId, ticket.id, queueId, assignedUserId, c.userId]);
  if (entitlement) await qx(client, `UPDATE tenant.support_entitlements SET tickets_used=tickets_used+1,updated_at=now() WHERE id=$1`, [entitlement.id]);
  await recordEvent(client, c, ticket.id, "ticket", ticket.id, "support.ticket.created", { channel, priority });
  await syncCrmServiceEvent(client, c, ticket, "case_opened");
  return ticket;
}

// F343/365: list and get, scoped for staff (queue/assignee/status filters) or a portal customer (their
// own party's tickets only -- see portal.js, which calls listTickets with a forced customerId).
export async function listTickets(client, c, filters = {}) {
  const params = [c.organizationId, c.companyId];
  const where = [];
  if (filters.forceCustomerId) { params.push(uuid(filters.forceCustomerId, "Customer")); where.push(`t.customer_id=$${params.length}`); }
  else needAny(c, VIEW);
  if (filters.status) { params.push(String(filters.status)); where.push(`t.status=$${params.length}`); }
  if (filters.queueId) { params.push(uuid(filters.queueId, "Queue")); where.push(`t.queue_id=$${params.length}`); }
  if (filters.assignedUserId) { params.push(uuid(filters.assignedUserId, "Agent")); where.push(`t.assigned_user_id=$${params.length}`); }
  if (filters.priority) { params.push(String(filters.priority)); where.push(`t.priority=$${params.length}`); }
  if (filters.customerId && !filters.forceCustomerId) { params.push(uuid(filters.customerId, "Customer")); where.push(`t.customer_id=$${params.length}`); }
  if (filters.tag) { params.push(JSON.stringify([String(filters.tag)])); where.push(`t.tags @> $${params.length}::jsonb`); }
  if (filters.scope === "mine" && !filters.forceCustomerId) { params.push(c.userId); where.push(`t.assigned_user_id=$${params.length}`); }
  if (filters.breachedOnly) where.push(`((t.first_response_due_at < now() AND t.first_responded_at IS NULL) OR t.resolution_due_at < now()) AND t.status NOT IN ('resolved','closed','cancelled','merged')`);
  const { rows } = await qx(client, `SELECT ${TICKET_SELECT} FROM tenant.support_tickets t ${TICKET_JOIN} WHERE t.organization_id=$1 AND t.company_id=$2 ${where.length ? "AND " + where.join(" AND ") : ""} ORDER BY t.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function getTicket(client, c, id, { forceCustomerId } = {}) {
  const params = [c.organizationId, uuid(id, "Ticket")];
  let scope = "";
  if (forceCustomerId) { params.push(forceCustomerId); scope = ` AND t.customer_id=$3`; }
  else needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT ${TICKET_SELECT} FROM tenant.support_tickets t ${TICKET_JOIN} WHERE t.organization_id=$1 AND t.id=$2${scope}`, params);
  if (!rows[0]) throw new SupportError(404, "Ticket was not found.", "SUPPORT_TICKET_NOT_FOUND");
  return rows[0];
}

// F343: edit subject/description/category/tags -- not status, which goes through transitionTicket.
export async function updateTicket(client, c, id, input) {
  needAny(c, ["support.ticket.assign", MANAGE, "support.communication.manage"]);
  const t = await getTicket(client, c, id);
  const set = [];
  const params = [c.organizationId, c.companyId, t.id];
  const add = (col, value) => { params.push(value); set.push(`${col}=$${params.length}`); };
  if (input.subject !== undefined) add("subject", text(input.subject, 200) || t.subject);
  if (input.categoryId !== undefined) add("category_id", uuidOrNull(input.categoryId, "Category"));
  if (input.priority !== undefined) add("priority", oneOf(String(input.priority), PRIORITIES, "Priority"));
  if (input.tags !== undefined) add("tags", JSON.stringify(Array.isArray(input.tags) ? input.tags.map((x) => text(x, 40)).filter(Boolean) : []));
  if (input.productId !== undefined) add("product_id", uuidOrNull(input.productId, "Product"));
  if (!set.length) return t;
  set.push(`updated_by=$${params.length + 1}`, `updated_at=now()`);
  params.push(c.userId);
  const { rows } = await qx(client, `UPDATE tenant.support_tickets t SET ${set.join(",")} WHERE t.organization_id=$1 AND t.company_id=$2 AND t.id=$3 RETURNING *`, params);
  await recordEvent(client, c, t.id, "ticket", t.id, "support.ticket.updated", { fields: Object.keys(input) });
  return rows[0];
}

// F351/F364: assign (or reassign) to a queue and/or an agent.
export async function assignTicket(client, c, id, input) {
  need(c, "support.ticket.assign");
  const cur = await qx(client, `SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Ticket")]);
  if (!cur.rows[0]) throw new SupportError(404, "Ticket was not found.", "SUPPORT_TICKET_NOT_FOUND");
  const t = cur.rows[0];
  if (["closed", "cancelled", "merged"].includes(t.status)) throw new SupportError(409, "A closed, cancelled or merged ticket cannot be reassigned.", "SUPPORT_TICKET_STATE");
  const queueId = input.queueId !== undefined ? uuidOrNull(input.queueId, "Queue") : t.queue_id;
  const userId = input.userId !== undefined ? uuidOrNull(input.userId, "Agent") : t.assigned_user_id;
  const { rows } = await qx(client, `UPDATE tenant.support_tickets SET queue_id=$4,assigned_user_id=$5,status=CASE WHEN status='new' THEN 'open' ELSE status END,updated_by=$6,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, t.id, queueId, userId, c.userId]);
  await qx(client, `INSERT INTO tenant.support_ticket_assignments(organization_id,ticket_id,from_queue_id,to_queue_id,from_user_id,to_user_id,reason,assigned_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.organizationId, t.id, t.queue_id, queueId, t.assigned_user_id, userId, textOrNull(input.reason, 300), c.userId]);
  await recordEvent(client, c, t.id, "ticket", t.id, "support.ticket.assigned", { queueId, userId });
  return rows[0];
}

// F349/F366: the ticket state machine, including reopen (within the settings' reopen window).
const TRANSITIONS = {
  open: ["new", "open"],
  pending_customer: ["open", "pending_customer"],
  pending_internal: ["open", "pending_internal"],
  resume_from_customer: ["pending_customer", "open"],
  resume_from_internal: ["pending_internal", "open"],
  resolve: ["open", "resolved"],
  close: ["resolved", "closed"],
  reopen: ["resolved", "open"],
  cancel: ["new", "cancelled"],
};
export async function transitionTicket(client, c, id, input, { internal = false } = {}) {
  const action = String(input.action ?? "");
  const transition = TRANSITIONS[action];
  if (!transition) throw new SupportError(400, "Unsupported ticket action.", "SUPPORT_TICKET_ACTION_INVALID");
  // a customer's reply auto-resumes a pending_customer ticket -- a system side effect of their own
  // message, not a staff action gated behind support.ticket.assign
  if (!internal) need(c, action === "resolve" ? "support.ticket.resolve" : action === "close" ? "support.ticket.close" : "support.ticket.assign");

  const cur = await qx(client, `SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Ticket")]);
  if (!cur.rows[0]) throw new SupportError(404, "Ticket was not found.", "SUPPORT_TICKET_NOT_FOUND");
  const t = cur.rows[0];
  if (t.status !== transition[0]) throw new SupportError(409, `Ticket is ${t.status}, not ${transition[0]}.`, "SUPPORT_TICKET_STATE");

  const settings = await loadSettings(client, c);
  if (action === "resolve" && settings.require_resolution_code && !text(input.resolutionCode)) throw new SupportError(400, "A resolution code is required.", "SUPPORT_RESOLUTION_CODE_REQUIRED");
  if (action === "close" && settings.prohibit_self_closure && t.created_by === c.userId && !has(c, MANAGE)) throw new SupportError(403, "You cannot close a ticket you raised yourself.", "SELF_APPROVAL_BLOCKED");
  if (action === "reopen") {
    const resolvedAt = t.resolved_at ? new Date(t.resolved_at) : null;
    if (resolvedAt && (Date.now() - resolvedAt.getTime()) / 86400000 > settings.reopen_window_days) throw new SupportError(409, `This ticket can only be reopened within ${settings.reopen_window_days} day(s) of resolution.`, "SUPPORT_REOPEN_WINDOW_EXPIRED");
    if (!text(input.reason)) throw new SupportError(400, "Give a reason for reopening.", "SUPPORT_REASON_REQUIRED");
  }

  // SLA pause/resume: pending_customer pauses the clock (if the policy says so); resuming extends the
  // due dates by however long it was paused.
  let slaPausedAt = t.sla_paused_at;
  let slaPausedMinutes = t.sla_paused_minutes;
  let firstResponseDueAt = t.first_response_due_at;
  let resolutionDueAt = t.resolution_due_at;
  let sla = null;
  if (t.sla_policy_id) sla = (await qx(client, `SELECT * FROM tenant.support_sla_policies WHERE id=$1`, [t.sla_policy_id])).rows[0];
  if (action === "pending_customer" && sla?.pause_on_pending_customer) slaPausedAt = new Date();
  if ((action === "resume_from_customer" || action === "resolve") && slaPausedAt) {
    const pausedFor = Math.round((Date.now() - new Date(slaPausedAt).getTime()) / 60000);
    slaPausedMinutes += pausedFor;
    if (firstResponseDueAt && !t.first_responded_at) firstResponseDueAt = new Date(new Date(firstResponseDueAt).getTime() + pausedFor * 60000);
    if (resolutionDueAt) resolutionDueAt = new Date(new Date(resolutionDueAt).getTime() + pausedFor * 60000);
    slaPausedAt = null;
  }

  const { rows } = await qx(client, `UPDATE tenant.support_tickets SET status=$4,
      resolved_at=CASE WHEN $4='resolved' THEN now() ELSE resolved_at END,
      closed_at=CASE WHEN $4='closed' THEN now() ELSE closed_at END,
      resolution_code=CASE WHEN $4='resolved' THEN $5 ELSE resolution_code END,
      resolution_summary=CASE WHEN $4='resolved' THEN $6 ELSE resolution_summary END,
      reopened_count=CASE WHEN $4='open' AND $7='reopen' THEN reopened_count+1 ELSE reopened_count END,
      csat_requested_at=CASE WHEN $4='resolved' THEN now() ELSE csat_requested_at END,
      sla_paused_at=$8, sla_paused_minutes=$9, first_response_due_at=$10, resolution_due_at=$11,
      updated_by=$12, updated_at=now()
    WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, t.id, transition[1], textOrNull(input.resolutionCode, 60), textOrNull(input.resolutionSummary, 4000), action, slaPausedAt, slaPausedMinutes, firstResponseDueAt, resolutionDueAt, c.userId]);

  await qx(client, `INSERT INTO tenant.support_ticket_status_history(organization_id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,$4,$5,$6)`, [c.organizationId, t.id, transition[0], transition[1], textOrNull(input.reason, 500), c.userId]);
  await recordEvent(client, c, t.id, "ticket", t.id, `support.ticket.${action}`, {});
  await syncCrmServiceEvent(client, c, rows[0], transition[1] === "resolved" ? "case_resolved" : "case_updated");
  return rows[0];
}

// F367: merge a duplicate into a primary ticket. The duplicate becomes read-only (status='merged');
// its conversation stays intact and reachable through the primary ticket's history.
export async function mergeTickets(client, c, input) {
  need(c, MANAGE);
  const primaryId = uuid(input.primaryTicketId, "Primary ticket");
  const duplicateId = uuid(input.duplicateTicketId, "Duplicate ticket");
  if (primaryId === duplicateId) throw new SupportError(400, "A ticket cannot be merged into itself.", "SUPPORT_MERGE_INVALID");
  if (!text(input.reason)) throw new SupportError(400, "Give a reason for the merge.", "SUPPORT_REASON_REQUIRED");
  const rows = await seq([
    () => qx(client, `SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, primaryId]),
    () => qx(client, `SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, duplicateId]),
  ]);
  const primary = rows[0].rows[0];
  const duplicate = rows[1].rows[0];
  if (!primary || !duplicate) throw new SupportError(404, "Ticket was not found.", "SUPPORT_TICKET_NOT_FOUND");
  if (["closed", "cancelled", "merged"].includes(duplicate.status)) throw new SupportError(409, "That ticket cannot be merged (already closed, cancelled or merged).", "SUPPORT_TICKET_STATE");
  if (primary.status === "merged") throw new SupportError(409, "The primary ticket is itself merged into another one.", "SUPPORT_TICKET_STATE");

  await qx(client, `UPDATE tenant.support_tickets SET status='merged',merged_into_ticket_id=$4,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, duplicate.id, primary.id, c.userId]);
  await qx(client, `INSERT INTO tenant.support_ticket_status_history(organization_id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,'merged',$4,$5)`, [c.organizationId, duplicate.id, duplicate.status, text(input.reason, 500), c.userId]);
  await qx(client, `INSERT INTO tenant.support_communications(organization_id,company_id,ticket_id,direction,channel,body,private_note,created_by) VALUES ($1,$2,$3,'internal','internal',$4,true,$5)`,
    [c.organizationId, c.companyId, primary.id, `Merged ticket ${duplicate.ticket_number} into this one. ${text(input.reason, 400)}`, c.userId]);
  await recordEvent(client, c, primary.id, "ticket", primary.id, "support.ticket.merge_received", { duplicateId: duplicate.id });
  await recordEvent(client, c, duplicate.id, "ticket", duplicate.id, "support.ticket.merged", { primaryId: primary.id });
  return { primary: (await getTicket(client, c, primary.id)), duplicate: (await getTicket(client, c, duplicate.id)) };
}

// ---------------------------------------------------------------- communications (F356-358)
export async function listCommunications(client, c, ticketId, { forceCustomerId } = {}) {
  await getTicket(client, c, ticketId, { forceCustomerId });
  const { rows } = await qx(client, `SELECT * FROM tenant.support_communications WHERE organization_id=$1 AND ticket_id=$2 ORDER BY created_at`, [c.organizationId, uuid(ticketId, "Ticket")]);
  return forceCustomerId ? rows.filter((r) => !r.private_note) : stripPrivate(rows, c);
}
export async function addCommunication(client, c, ticketId, input, { forceCustomerId, forcePortalIdentity } = {}) {
  const t = await getTicket(client, c, ticketId, { forceCustomerId });
  if (["closed", "cancelled", "merged"].includes(t.status)) throw new SupportError(409, "This ticket is closed, cancelled or merged and cannot take a new message.", "SUPPORT_TICKET_STATE");
  if (!forceCustomerId) need(c, "support.communication.manage");
  const direction = forceCustomerId ? "inbound" : oneOf(String(input.direction ?? "outbound"), ["inbound", "outbound", "internal"], "Direction");
  const privateNote = forceCustomerId ? false : Boolean(input.privateNote);
  if (privateNote && direction !== "internal") throw new SupportError(400, "A private note must have direction 'internal'.", "SUPPORT_COMMUNICATION_INVALID");
  const body = text(input.body, 8000);
  if (!body) throw new SupportError(400, "A message needs a body.", "SUPPORT_COMMUNICATION_INVALID");
  const { rows } = await qx(client, `INSERT INTO tenant.support_communications(organization_id,company_id,ticket_id,direction,channel,subject,body,sender_name,sender_address,recipient_address,external_message_id,private_note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, t.id, direction, oneOf(String(input.channel ?? t.channel), CHANNELS, "Channel"), textOrNull(input.subject, 200), body, textOrNull(input.senderName ?? forcePortalIdentity?.name, 200), textOrNull(input.senderAddress ?? forcePortalIdentity?.email, 320), textOrNull(input.recipientAddress, 320), textOrNull(input.externalMessageId, 300), privateNote, c.userId]);

  if (direction === "outbound") await qx(client, `UPDATE tenant.support_tickets SET first_responded_at=coalesce(first_responded_at,now()),status=CASE WHEN status='new' THEN 'open' ELSE status END,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, t.id, c.userId]);
  if (direction === "inbound" && ["pending_customer"].includes(t.status)) {
    // a customer reply while waiting on them moves it back to open and resumes the SLA clock -- a
    // system side effect of their own message, so it bypasses the staff assign/resolve permission gate
    await transitionTicket(client, c, t.id, { action: "resume_from_customer", reason: "Customer replied" }, { internal: true });
  }
  await recordEvent(client, c, t.id, "communication", rows[0].id, "support.communication.created", { direction, privateNote });
  return rows[0];
}

export async function listAttachments(client, c, ticketId, { forceCustomerId } = {}) {
  await getTicket(client, c, ticketId, { forceCustomerId });
  const { rows } = await qx(client, `SELECT * FROM tenant.support_attachments WHERE organization_id=$1 AND ticket_id=$2 ORDER BY created_at`, [c.organizationId, uuid(ticketId, "Ticket")]);
  return forceCustomerId ? rows.filter((r) => !r.private_note) : stripPrivate(rows, c);
}
export async function addAttachment(client, c, ticketId, input, { forceCustomerId } = {}) {
  const t = await getTicket(client, c, ticketId, { forceCustomerId });
  if (!forceCustomerId) need(c, "support.communication.manage");
  const fileName = text(input.fileName, 260);
  if (!fileName) throw new SupportError(400, "A file name is required.", "SUPPORT_ATTACHMENT_INVALID");
  const size = Math.trunc(positive(input.sizeBytes, "File size"));
  if (size > 26214400) throw new SupportError(400, "Attachments are limited to 25 MB.", "SUPPORT_ATTACHMENT_TOO_LARGE");
  const { rows } = await qx(client, `INSERT INTO tenant.support_attachments(organization_id,company_id,ticket_id,communication_id,file_name,content_type,size_bytes,storage_key,private_note,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, t.id, uuidOrNull(input.communicationId, "Communication"), fileName, textOrNull(input.contentType, 120) ?? "application/octet-stream", size, text(input.storageKey, 400) || `support/${t.id}/${Date.now()}-${fileName}`, forceCustomerId ? false : Boolean(input.privateNote), c.userId]);
  await recordEvent(client, c, t.id, "attachment", rows[0].id, "support.attachment.added", { fileName });
  return rows[0];
}
export async function removeAttachment(client, c, id) {
  need(c, "support.communication.manage");
  const { rows } = await qx(client, `DELETE FROM tenant.support_attachments WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, uuid(id, "Attachment")]);
  if (!rows[0]) throw new SupportError(404, "Attachment was not found.", "SUPPORT_ATTACHMENT_NOT_FOUND");
  return rows[0];
}

// ---------------------------------------------------------------- escalations (F362-363)
export async function listEscalations(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where = ` AND e.status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT e.*, t.ticket_number, t.subject FROM tenant.support_escalations e JOIN tenant.support_tickets t ON t.id=e.ticket_id WHERE e.organization_id=$1 AND e.company_id=$2${where} ORDER BY e.escalated_at DESC LIMIT 500`, params);
  return rows;
}
export async function escalateTicket(client, c, ticketId, input) {
  need(c, "support.escalation.manage");
  const t = await getTicket(client, c, ticketId);
  let policy = null;
  if (input.policyId) policy = (await qx(client, `SELECT * FROM tenant.support_escalation_policies WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.policyId, "Escalation policy")])).rows[0];
  const level = Math.trunc(positive(input.escalationLevel ?? 1, "Escalation level"));
  const { rows } = await qx(client, `INSERT INTO tenant.support_escalations(organization_id,company_id,ticket_id,policy_id,escalation_level,reason,escalated_to_queue_id,escalated_to_user_id,escalated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, t.id, policy?.id ?? null, level, text(input.reason, 500) || "Manually escalated", uuidOrNull(input.escalatedToQueueId, "Queue") ?? policy?.target_queue_id ?? null, uuidOrNull(input.escalatedToUserId, "User") ?? policy?.target_user_id ?? null, c.userId]);
  if (policy?.priority_override) await qx(client, `UPDATE tenant.support_tickets SET priority=$3 WHERE organization_id=$1 AND id=$2`, [c.organizationId, t.id, policy.priority_override]);
  await recordEvent(client, c, t.id, "escalation", rows[0].id, "support.escalation.raised", { level });
  await syncCrmServiceEvent(client, c, t, "escalation");
  return rows[0];
}
export async function decideEscalation(client, c, id, input) {
  need(c, "support.escalation.manage");
  const action = oneOf(String(input.action ?? ""), ["acknowledge", "resolve", "cancel"], "Action");
  const cur = await qx(client, `SELECT * FROM tenant.support_escalations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Escalation")]);
  if (!cur.rows[0]) throw new SupportError(404, "Escalation was not found.", "SUPPORT_ESCALATION_NOT_FOUND");
  const e = cur.rows[0];
  if (e.status !== "open" && action === "acknowledge") throw new SupportError(409, "Only an open escalation can be acknowledged.", "SUPPORT_ESCALATION_STATE");
  if (!["open", "acknowledged"].includes(e.status) && action !== "acknowledge") throw new SupportError(409, "This escalation is already closed out.", "SUPPORT_ESCALATION_STATE");
  const target = action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved" : "cancelled";
  const { rows } = await qx(client, `UPDATE tenant.support_escalations SET status=$4, acknowledged_by=CASE WHEN $4='acknowledged' THEN $5 ELSE acknowledged_by END, acknowledged_at=CASE WHEN $4='acknowledged' THEN now() ELSE acknowledged_at END, resolved_at=CASE WHEN $4 IN ('resolved','cancelled') THEN now() ELSE resolved_at END WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, e.id, target, c.userId]);
  return rows[0];
}

// F362: a sweep that raises an escalation for every ticket that has breached (or is at risk of
// breaching) its SLA and does not already have an open escalation. Idempotent -- run as often as
// wanted (a cron, or on demand); it never double-escalates the same ticket at the same level.
export async function checkSlaBreaches(client, c) {
  needAny(c, ["support.escalation.manage", MANAGE]);
  const policies = (await qx(client, `SELECT * FROM tenant.support_escalation_policies WHERE organization_id=$1 AND company_id=$2 AND active AND trigger_type IN ('first_response_risk','resolution_risk')`, [c.organizationId, c.companyId])).rows;
  if (!policies.length) return { raised: 0 };
  const atRisk = await qx(client, `SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND status NOT IN ('resolved','closed','cancelled','merged')
      AND ((first_response_due_at < now() AND first_responded_at IS NULL) OR resolution_due_at < now())
      AND NOT EXISTS (SELECT 1 FROM tenant.support_escalations ex WHERE ex.ticket_id=support_tickets.id AND ex.status='open')`, [c.organizationId, c.companyId]);
  let raised = 0;
  for (const t of atRisk.rows) {
    const breach = t.first_response_due_at && !t.first_responded_at && new Date(t.first_response_due_at) < new Date() ? "first_response_risk" : "resolution_risk";
    const policy = policies.find((p) => p.trigger_type === breach) ?? policies[0];
    await qx(client, `INSERT INTO tenant.support_escalations(organization_id,company_id,ticket_id,policy_id,escalation_level,reason,escalated_to_queue_id,escalated_to_user_id,escalated_by) VALUES ($1,$2,$3,$4,1,$5,$6,$7,NULL)`,
      [c.organizationId, c.companyId, t.id, policy.id, breach === "first_response_risk" ? "First-response SLA breached" : "Resolution SLA breached", policy.target_queue_id, policy.target_user_id]);
    if (policy.priority_override) await qx(client, `UPDATE tenant.support_tickets SET priority=$3 WHERE organization_id=$1 AND id=$2`, [c.organizationId, t.id, policy.priority_override]);
    await recordEvent(client, c, t.id, "escalation", t.id, "support.sla.breached", { breach });
    raised += 1;
  }
  return { raised };
}

// ---------------------------------------------------------------- history (F365, F380)
export async function getTicketHistory(client, c, ticketId) {
  const t = await getTicket(client, c, ticketId);
  const [statusHistory, assignments, escalations, events] = await seq([
    () => qx(client, `SELECT * FROM tenant.support_ticket_status_history WHERE organization_id=$1 AND ticket_id=$2 ORDER BY changed_at`, [c.organizationId, t.id]),
    () => qx(client, `SELECT * FROM tenant.support_ticket_assignments WHERE organization_id=$1 AND ticket_id=$2 ORDER BY assigned_at`, [c.organizationId, t.id]),
    () => qx(client, `SELECT * FROM tenant.support_escalations WHERE organization_id=$1 AND ticket_id=$2 ORDER BY escalated_at`, [c.organizationId, t.id]),
    () => qx(client, `SELECT * FROM tenant.support_events WHERE organization_id=$1 AND ticket_id=$2 ORDER BY occurred_at`, [c.organizationId, t.id]),
  ]);
  return { ticket: t, statusHistory: statusHistory.rows, assignments: assignments.rows, escalations: escalations.rows, events: events.rows };
}

// A best-effort write into CRM's own customer-service event log (tenant.crm_customer_service_events),
// so an account's CRM timeline/health score picks up support activity without Support owning or
// duplicating CRM's schema. Idempotent (upserts by ticket number); never blocks the Support action if
// the party has no CRM footprint or the write fails for an unrelated reason.
async function syncCrmServiceEvent(client, c, ticket, eventType) {
  if (!ticket.customer_id) return;
  try {
    await client.query(
      `INSERT INTO tenant.crm_customer_service_events(organization_id,company_id,party_id,contact_id,external_system,external_case_id,event_type,title,description,status,priority,occurred_at,created_by)
       VALUES ($1,$2,$3,$4,'support',$5,$6,$7,$8,$9,$10,now(),$11)
       ON CONFLICT (organization_id,external_system,external_case_id) DO UPDATE SET event_type=EXCLUDED.event_type,status=EXCLUDED.status,priority=EXCLUDED.priority,occurred_at=now()`,
      [c.organizationId, c.companyId, ticket.customer_id, ticket.contact_id, ticket.ticket_number, eventType, ticket.subject,
        ticket.description?.slice(0, 500) ?? null, ticket.status === "resolved" || ticket.status === "closed" ? "resolved" : "open",
        ["urgent", "critical"].includes(ticket.priority) ? "urgent" : ticket.priority === "high" ? "high" : ticket.priority === "low" ? "low" : "medium", c.userId],
    );
  } catch {
    // CRM's table may not exist in an environment without that module's migrations; Support never
    // depends on this succeeding.
  }
}
