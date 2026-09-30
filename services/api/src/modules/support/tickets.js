// F343-F368: the core ticket desk -- settings, categories, the ticket lifecycle itself
// (create/assign/transition/reopen), communications (customer replies and private notes), attachments and
// the ticket history.
import {
  CHANNELS, PRIORITIES, SupportError, emailOrNull, has, need, needAny, nonNegative, oneOf, qx, recordEvent, resolveParty, seq, stripPrivate, text, textOrNull, uuid, uuidOrNull,
} from "./common.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { archiveFile, readFileContent, storeFile } from "../../core/platform/files/index.js";

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

// ---------------------------------------------------------------- tickets: create (F343-346,348,349,354,355)
const TICKET_SELECT = `t.*, cat.name AS category_name, party.display_name AS party_name, contact.first_name AS contact_first_name, contact.last_name AS contact_last_name`;
const TICKET_JOIN = `LEFT JOIN tenant.support_categories cat ON cat.id=t.category_id LEFT JOIN tenant.business_parties party ON party.id=t.customer_id LEFT JOIN tenant.contacts contact ON contact.id=t.contact_id`;

export async function createTicket(client, c, input) {
  need(c, "support.ticket.create");
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
  const priority = input.priority ? oneOf(String(input.priority), PRIORITIES, "Priority") : settings.default_priority;
  const ticketNumber = await nextDocumentNumber(client, c, { documentType: "support_ticket", prefix: "TKT" });
  const assignedUserId = uuidOrNull(input.assignedUserId, "Agent");

  const { rows } = await qx(client, `INSERT INTO tenant.support_tickets
      (organization_id,company_id,branch_id,ticket_number,subject,description,channel,category_id,assigned_user_id,customer_id,contact_id,
       customer_name,customer_email,customer_phone,tags,priority,status,source_reference,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,'new',$17,$18,$18) RETURNING *`,
    [c.organizationId, c.companyId, uuidOrNull(input.branchId, "Branch"), ticketNumber, subject, description, channel, categoryId, assignedUserId,
      customerId, contactId, textOrNull(input.customerName, 200), emailOrNull(input.customerEmail), textOrNull(input.customerPhone, 30),
      JSON.stringify(Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean) : []),
      priority, textOrNull(input.sourceReference, 300), c.userId]);
  const ticket = rows[0];

  await qx(client, `INSERT INTO tenant.support_ticket_status_history(organization_id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,NULL,'new','Ticket created',$3)`, [c.organizationId, ticket.id, c.userId]);
  if (assignedUserId) await qx(client, `INSERT INTO tenant.support_ticket_assignments(organization_id,ticket_id,from_user_id,to_user_id,reason,assigned_by) VALUES ($1,$2,NULL,$3,'Assigned on creation',$4)`, [c.organizationId, ticket.id, assignedUserId, c.userId]);
  await recordEvent(client, c, ticket.id, "ticket", ticket.id, "support.ticket.created", { channel, priority });
  await syncCrmServiceEvent(client, c, ticket, "case_opened");
  return ticket;
}

// F343/365: list and get, with assignee/status/priority/customer filters.
export async function listTickets(client, c, filters = {}) {
  const params = [c.organizationId, c.companyId];
  const where = [];
  needAny(c, VIEW);
  if (filters.status) { params.push(String(filters.status)); where.push(`t.status=$${params.length}`); }
  if (filters.assignedUserId) { params.push(uuid(filters.assignedUserId, "Agent")); where.push(`t.assigned_user_id=$${params.length}`); }
  if (filters.priority) { params.push(String(filters.priority)); where.push(`t.priority=$${params.length}`); }
  if (filters.customerId) { params.push(uuid(filters.customerId, "Customer")); where.push(`t.customer_id=$${params.length}`); }
  if (filters.tag) { params.push(JSON.stringify([String(filters.tag)])); where.push(`t.tags @> $${params.length}::jsonb`); }
  if (filters.scope === "mine") { params.push(c.userId); where.push(`t.assigned_user_id=$${params.length}`); }
  const { rows } = await qx(client, `SELECT ${TICKET_SELECT} FROM tenant.support_tickets t ${TICKET_JOIN} WHERE t.organization_id=$1 AND t.company_id=$2 ${where.length ? "AND " + where.join(" AND ") : ""} ORDER BY t.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function getTicket(client, c, id) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT ${TICKET_SELECT} FROM tenant.support_tickets t ${TICKET_JOIN} WHERE t.organization_id=$1 AND t.id=$2`, [c.organizationId, uuid(id, "Ticket")]);
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
  if (!set.length) return t;
  set.push(`updated_by=$${params.length + 1}`, `updated_at=now()`);
  params.push(c.userId);
  const { rows } = await qx(client, `UPDATE tenant.support_tickets t SET ${set.join(",")} WHERE t.organization_id=$1 AND t.company_id=$2 AND t.id=$3 RETURNING *`, params);
  await recordEvent(client, c, t.id, "ticket", t.id, "support.ticket.updated", { fields: Object.keys(input) });
  return rows[0];
}

// F351/F364: assign (or reassign) to an agent.
export async function assignTicket(client, c, id, input) {
  need(c, "support.ticket.assign");
  const cur = await qx(client, `SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Ticket")]);
  if (!cur.rows[0]) throw new SupportError(404, "Ticket was not found.", "SUPPORT_TICKET_NOT_FOUND");
  const t = cur.rows[0];
  if (["closed", "cancelled", "merged"].includes(t.status)) throw new SupportError(409, "A closed or cancelled ticket cannot be reassigned.", "SUPPORT_TICKET_STATE");
  const userId = input.userId !== undefined ? uuidOrNull(input.userId, "Agent") : c.userId;
  const { rows } = await qx(client, `UPDATE tenant.support_tickets SET assigned_user_id=$4,status=CASE WHEN status='new' THEN 'open' ELSE status END,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, t.id, userId, c.userId]);
  await qx(client, `INSERT INTO tenant.support_ticket_assignments(organization_id,ticket_id,from_user_id,to_user_id,reason,assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.organizationId, t.id, t.assigned_user_id, userId, textOrNull(input.reason, 300), c.userId]);
  await recordEvent(client, c, t.id, "ticket", t.id, "support.ticket.assigned", { userId });
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
  // message (inbound mail), not a staff action gated behind support.ticket.assign
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

  const { rows } = await qx(client, `UPDATE tenant.support_tickets SET status=$4,
      resolved_at=CASE WHEN $4='resolved' THEN now() ELSE resolved_at END,
      closed_at=CASE WHEN $4='closed' THEN now() ELSE closed_at END,
      resolution_code=CASE WHEN $4='resolved' THEN $5 ELSE resolution_code END,
      resolution_summary=CASE WHEN $4='resolved' THEN $6 ELSE resolution_summary END,
      reopened_count=CASE WHEN $4='open' AND $7='reopen' THEN reopened_count+1 ELSE reopened_count END,
      updated_by=$8, updated_at=now()
    WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, t.id, transition[1], textOrNull(input.resolutionCode, 60), textOrNull(input.resolutionSummary, 4000), action, c.userId]);

  await qx(client, `INSERT INTO tenant.support_ticket_status_history(organization_id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,$4,$5,$6)`, [c.organizationId, t.id, transition[0], transition[1], textOrNull(input.reason, 500), c.userId]);
  await recordEvent(client, c, t.id, "ticket", t.id, `support.ticket.${action}`, {});
  await syncCrmServiceEvent(client, c, rows[0], transition[1] === "resolved" ? "case_resolved" : "case_updated");
  return rows[0];
}

// ---------------------------------------------------------------- communications (F356-358)
export async function listCommunications(client, c, ticketId) {
  await getTicket(client, c, ticketId);
  const { rows } = await qx(client, `SELECT * FROM tenant.support_communications WHERE organization_id=$1 AND ticket_id=$2 ORDER BY created_at`, [c.organizationId, uuid(ticketId, "Ticket")]);
  return stripPrivate(rows, c);
}
export async function addCommunication(client, c, ticketId, input) {
  const t = await getTicket(client, c, ticketId);
  if (["closed", "cancelled", "merged"].includes(t.status)) throw new SupportError(409, "This ticket is closed, cancelled or merged and cannot take a new message.", "SUPPORT_TICKET_STATE");
  need(c, "support.communication.manage");
  const direction = oneOf(String(input.direction ?? "outbound"), ["inbound", "outbound", "internal"], "Direction");
  const privateNote = Boolean(input.privateNote);
  if (privateNote && direction !== "internal") throw new SupportError(400, "A private note must have direction 'internal'.", "SUPPORT_COMMUNICATION_INVALID");
  const body = text(input.body, 8000);
  if (!body) throw new SupportError(400, "A message needs a body.", "SUPPORT_COMMUNICATION_INVALID");
  const { rows } = await qx(client, `INSERT INTO tenant.support_communications(organization_id,company_id,ticket_id,direction,channel,subject,body,sender_name,sender_address,recipient_address,external_message_id,private_note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, t.id, direction, oneOf(String(input.channel ?? t.channel), CHANNELS, "Channel"), textOrNull(input.subject, 200), body, textOrNull(input.senderName, 200), textOrNull(input.senderAddress, 320), textOrNull(input.recipientAddress, 320), textOrNull(input.externalMessageId, 300), privateNote, c.userId]);

  if (direction === "outbound") await qx(client, `UPDATE tenant.support_tickets SET first_responded_at=coalesce(first_responded_at,now()),status=CASE WHEN status='new' THEN 'open' ELSE status END,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, t.id, c.userId]);
  if (direction === "inbound" && ["pending_customer"].includes(t.status)) {
    // a customer reply while waiting on them moves it back to open and resumes the SLA clock -- a
    // system side effect of their own message, so it bypasses the staff assign/resolve permission gate
    await transitionTicket(client, c, t.id, { action: "resume_from_customer", reason: "Customer replied" }, { internal: true });
  }
  await recordEvent(client, c, t.id, "communication", rows[0].id, "support.communication.created", { direction, privateNote });
  return rows[0];
}

export async function listAttachments(client, c, ticketId) {
  await getTicket(client, c, ticketId);
  const { rows } = await qx(client, `SELECT * FROM tenant.support_attachments WHERE organization_id=$1 AND ticket_id=$2 ORDER BY created_at`, [c.organizationId, uuid(ticketId, "Ticket")]);
  return stripPrivate(rows, c);
}
// Attachments are Shared Platform files (entity "support.ticket"): the bytes
// go through the platform upload pipeline (validation, malware scan, SHA-256,
// object storage). `input.prepared` is a prepareFileUpload() result made by
// the route; a caller-typed storage reference is never accepted.
export async function addAttachment(client, c, ticketId, input, { storage, purpose = "attachment", communicationId = null } = {}) {
  const t = await getTicket(client, c, ticketId);
  need(c, "support.communication.manage");
  if (!input?.prepared) throw new SupportError(400, "Upload the file itself; a file reference cannot be attached.", "SUPPORT_ATTACHMENT_UPLOAD_REQUIRED");
  if (input.prepared.sizeBytes > 26214400) throw new SupportError(400, "Attachments are limited to 25 MB.", "SUPPORT_ATTACHMENT_TOO_LARGE");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: "support.ticket", entityId: t.id, prepared: input.prepared, uploadedBy: c.userId ?? null, purpose }, { storage });
  const { rows } = await qx(client, `INSERT INTO tenant.support_attachments(organization_id,company_id,ticket_id,communication_id,file_name,content_type,size_bytes,storage_key,private_note,uploaded_by,file_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, t.id, uuidOrNull(input.communicationId ?? communicationId, "Communication"), file.fileName, file.mimeType, file.sizeBytes, `platform-file:${file.id}`, Boolean(input.privateNote), c.userId ?? null, file.id]);
  await recordEvent(client, c, t.id, "attachment", rows[0].id, "support.attachment.added", { fileName: file.fileName });
  return rows[0];
}

// Download: the ticket must be visible to the caller and a private attachment
// only to sensitive viewers or its uploader. Metadata-only rows from before Shared Files have no bytes (404).
export async function getAttachmentContent(client, c, attachmentId, { storage } = {}) {
  const { rows } = await qx(client, `SELECT * FROM tenant.support_attachments WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(attachmentId, "Attachment")]);
  const row = rows[0];
  const notFound = () => new SupportError(404, "Attachment was not found.", "SUPPORT_ATTACHMENT_NOT_FOUND");
  if (!row) throw notFound();
  await getTicket(client, c, row.ticket_id);
  const visible = Boolean(stripPrivate(row, c, false));
  if (!visible || !row.file_id) throw notFound();
  try {
    return await readFileContent(client, { organizationId: c.organizationId, entityType: "support.ticket", entityId: row.ticket_id, fileId: row.file_id }, { storage });
  } catch (error) {
    if (error?.code === "FILE_NOT_FOUND") throw notFound();
    throw error;
  }
}

export async function removeAttachment(client, c, id) {
  need(c, "support.communication.manage");
  const { rows } = await qx(client, `DELETE FROM tenant.support_attachments WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, uuid(id, "Attachment")]);
  if (!rows[0]) throw new SupportError(404, "Attachment was not found.", "SUPPORT_ATTACHMENT_NOT_FOUND");
  if (rows[0].file_id) await archiveFile(client, { organizationId: c.organizationId, entityType: "support.ticket", entityId: rows[0].ticket_id, fileId: rows[0].file_id, actorUserId: c.userId ?? null });
  return rows[0];
}

// ---------------------------------------------------------------- history (F365, F380)
export async function getTicketHistory(client, c, ticketId) {
  const t = await getTicket(client, c, ticketId);
  const [statusHistory, assignments, events] = await seq([
    () => qx(client, `SELECT * FROM tenant.support_ticket_status_history WHERE organization_id=$1 AND ticket_id=$2 ORDER BY changed_at`, [c.organizationId, t.id]),
    () => qx(client, `SELECT * FROM tenant.support_ticket_assignments WHERE organization_id=$1 AND ticket_id=$2 ORDER BY assigned_at`, [c.organizationId, t.id]),
    () => qx(client, `SELECT * FROM tenant.support_events WHERE organization_id=$1 AND ticket_id=$2 ORDER BY occurred_at`, [c.organizationId, t.id]),
  ]);
  return { ticket: t, statusHistory: statusHistory.rows, assignments: assignments.rows, events: events.rows };
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
