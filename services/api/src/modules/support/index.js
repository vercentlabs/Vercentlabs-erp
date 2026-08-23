// tenant.support_communications rows marked private_note=true are internal
// staff-only notes not meant to be visible to every ticket viewer. Gated
// behind support.sensitive.view (see docs/implementation/
// ERP_SECURITY_HARDENING_003.md, Part 1). Read-only enforcement: creating a
// private note remains governed by the pre-existing
// support.communication.manage permission, unchanged — a caller can still
// leave a private note without holding support.sensitive.view, they simply
// cannot read other staff's private notes back without it.
function canViewSensitiveSupportRecords(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("support.sensitive.view"))
  );
}

const TABLES = Object.freeze({
  tickets: "support_tickets",
  queues: "support_queues",
  "sla-policies": "support_sla_policies",
  escalations: "support_escalations",
  communications: "support_communications",
  knowledge: "support_knowledge_articles",
  categories: "support_categories",
  "customer-history": "support_tickets",
});

function requirePermission(context, permission) {
  if (
    !context.roleSlugs?.includes("organization_owner") &&
    !context.permissions?.includes(permission)
  ) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported support resource.");
  return value;
}

async function event(
  client,
  context,
  ticketId,
  aggregateType,
  aggregateId,
  eventType,
  payload = {},
) {
  await client.query(
    `INSERT INTO tenant.support_events
      (organization_id,company_id,ticket_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      context.organizationId,
      context.companyId,
      ticketId || null,
      aggregateType,
      aggregateId,
      eventType,
      JSON.stringify(payload),
      context.userId,
    ],
  );
}

export async function getSupportDashboard(client, context) {
  requirePermission(context, "support.view");
  const tickets = await client.query(
    `SELECT
       count(*) FILTER (WHERE status IN ('new','open','pending_customer','pending_internal'))::int AS open_tickets,
       count(*) FILTER (WHERE priority IN ('urgent','critical') AND status NOT IN ('resolved','closed','cancelled'))::int AS high_priority_tickets,
       count(*) FILTER (WHERE first_response_due_at < now() AND first_responded_at IS NULL AND status NOT IN ('resolved','closed','cancelled'))::int AS first_response_breaches,
       count(*) FILTER (WHERE resolution_due_at < now() AND status NOT IN ('resolved','closed','cancelled'))::int AS resolution_breaches,
       count(*) FILTER (WHERE created_at::date=current_date)::int AS tickets_today
     FROM tenant.support_tickets
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const escalations = await client.query(
    `SELECT count(*)::int AS open_escalations
     FROM tenant.support_escalations
     WHERE organization_id=$1 AND company_id=$2 AND status='open'`,
    [context.organizationId, context.companyId],
  );
  return { ...tickets.rows[0], ...escalations.rows[0] };
}

export async function listSupportResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0, customerId = null, queueId = null } = {},
) {
  requirePermission(context, "support.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  const filters = [];

  if (customerId && target === "support_tickets") {
    values.push(customerId);
    filters.push(`record.customer_id=$${values.length}`);
  }
  if (queueId && target === "support_tickets") {
    values.push(queueId);
    filters.push(`record.queue_id=$${values.length}`);
  }

  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  const result = await client.query(
    `SELECT record.* FROM tenant.${target} record
     WHERE record.organization_id=$1 AND record.company_id=$2${where}
     ORDER BY record.${target === "support_escalations" ? "escalated_at" : "created_at"} DESC NULLS LAST,record.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  if (target === "support_communications" && !canViewSensitiveSupportRecords(context)) {
    return result.rows.filter((row) => !row.private_note);
  }
  return result.rows;
}

export async function createSupportQueue(client, context, input) {
  requirePermission(context, "support.queue.manage");
  const result = await client.query(
    `INSERT INTO tenant.support_queues
      (organization_id,company_id,code,name,description,manager_user_id,
       assignment_strategy,business_hours,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.code,
      input.name,
      input.description || null,
      input.managerUserId || null,
      input.assignmentStrategy || "manual",
      JSON.stringify(input.businessHours || {}),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function createSlaPolicy(client, context, input) {
  requirePermission(context, "support.sla.manage");
  const result = await client.query(
    `INSERT INTO tenant.support_sla_policies
      (organization_id,company_id,code,name,description,priority,
       first_response_minutes,resolution_minutes,pause_on_pending_customer,
       business_hours_only,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.code,
      input.name,
      input.description || null,
      input.priority || null,
      Number(input.firstResponseMinutes),
      Number(input.resolutionMinutes),
      input.pauseOnPendingCustomer !== false,
      input.businessHoursOnly !== false,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function createSupportTicket(client, context, input) {
  requirePermission(context, "support.ticket.create");

  let sla = null;
  if (input.slaPolicyId) {
    const slaResult = await client.query(
      `SELECT * FROM tenant.support_sla_policies
       WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active=true`,
      [context.organizationId, context.companyId, input.slaPolicyId],
    );
    sla = slaResult.rows[0] || null;
  }

  const now = new Date();
  const firstResponseDueAt = sla
    ? new Date(now.getTime() + Number(sla.first_response_minutes) * 60000)
    : null;
  const resolutionDueAt = sla
    ? new Date(now.getTime() + Number(sla.resolution_minutes) * 60000)
    : null;

  const ticket = await client.query(
    `INSERT INTO tenant.support_tickets
      (organization_id,company_id,branch_id,ticket_number,subject,description,
       channel,category_id,queue_id,assigned_user_id,customer_id,contact_id,
       customer_name,customer_email,customer_phone,related_crm_record_type,
       related_crm_record_id,related_sales_order_id,related_invoice_id,
       related_asset_id,related_project_id,related_quality_record_type,
       related_quality_record_id,priority,status,sla_policy_id,
       first_response_due_at,resolution_due_at,source_reference,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,'new',$25,$26,$27,$28,$29,$29)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId || null,
      input.ticketNumber || `SUP-${Date.now()}`,
      input.subject,
      input.description,
      input.channel || "web",
      input.categoryId || null,
      input.queueId || null,
      input.assignedUserId || null,
      input.customerId || null,
      input.contactId || null,
      input.customerName || null,
      input.customerEmail || null,
      input.customerPhone || null,
      input.relatedCrmRecordType || null,
      input.relatedCrmRecordId || null,
      input.relatedSalesOrderId || null,
      input.relatedInvoiceId || null,
      input.relatedAssetId || null,
      input.relatedProjectId || null,
      input.relatedQualityRecordType || null,
      input.relatedQualityRecordId || null,
      input.priority || "normal",
      input.slaPolicyId || null,
      firstResponseDueAt,
      resolutionDueAt,
      input.sourceReference || null,
      context.userId,
    ],
  );

  await client.query(
    `INSERT INTO tenant.support_ticket_status_history
      (organization_id,ticket_id,from_status,to_status,reason,changed_by)
     VALUES ($1,$2,NULL,'new','Ticket created',$3)`,
    [context.organizationId, ticket.rows[0].id, context.userId],
  );

  await event(
    client,
    context,
    ticket.rows[0].id,
    "ticket",
    ticket.rows[0].id,
    "support.ticket.created",
  );
  return ticket.rows[0];
}

export async function assignSupportTicket(client, context, ticketId, input) {
  requirePermission(context, "support.ticket.assign");
  const current = await client.query(
    `SELECT * FROM tenant.support_tickets
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, ticketId],
  );
  if (!current.rows[0]) throw new Error("Support ticket not found.");

  const updated = await client.query(
    `UPDATE tenant.support_tickets
     SET queue_id=$4,assigned_user_id=$5,
       status=CASE WHEN status='new' THEN 'open' ELSE status END,
       updated_by=$6,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      ticketId,
      input.queueId || null,
      input.userId || null,
      context.userId,
    ],
  );

  await client.query(
    `INSERT INTO tenant.support_ticket_assignments
      (organization_id,ticket_id,from_queue_id,to_queue_id,from_user_id,
       to_user_id,reason,assigned_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      context.organizationId,
      ticketId,
      current.rows[0].queue_id,
      input.queueId || null,
      current.rows[0].assigned_user_id,
      input.userId || null,
      input.reason || null,
      context.userId,
    ],
  );

  await event(
    client,
    context,
    ticketId,
    "ticket",
    ticketId,
    "support.ticket.assigned",
  );
  return updated.rows[0];
}

export async function addSupportCommunication(
  client,
  context,
  ticketId,
  input,
) {
  requirePermission(context, "support.communication.manage");
  const result = await client.query(
    `INSERT INTO tenant.support_communications
      (organization_id,company_id,ticket_id,direction,channel,subject,body,
       sender_name,sender_address,recipient_address,external_message_id,
       private_note,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      ticketId,
      input.direction,
      input.channel,
      input.subject || null,
      input.body,
      input.senderName || null,
      input.senderAddress || null,
      input.recipientAddress || null,
      input.externalMessageId || null,
      Boolean(input.privateNote),
      context.userId,
    ],
  );

  if (input.direction === "outbound") {
    await client.query(
      `UPDATE tenant.support_tickets
       SET first_responded_at=coalesce(first_responded_at,now()),
         status=CASE WHEN status='new' THEN 'open' ELSE status END,
         updated_by=$4,updated_at=now()
       WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
      [context.organizationId, context.companyId, ticketId, context.userId],
    );
  }

  await event(
    client,
    context,
    ticketId,
    "communication",
    result.rows[0].id,
    "support.communication.created",
  );
  return result.rows[0];
}

export async function transitionSupportTicket(
  client,
  context,
  ticketId,
  input,
) {
  const action = input.action;
  const transitions = {
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
  const transition = transitions[action];
  if (!transition) throw new Error("Unsupported support ticket action.");

  requirePermission(
    context,
    action === "resolve"
      ? "support.ticket.resolve"
      : action === "close"
        ? "support.ticket.close"
        : "support.manage",
  );

  if (action === "resolve" && !input.resolutionCode) {
    const error = new Error("Resolution code is required.");
    error.code = "RESOLUTION_CODE_REQUIRED";
    throw error;
  }

  const current = await client.query(
    `SELECT * FROM tenant.support_tickets
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, ticketId],
  );
  if (!current.rows[0] || current.rows[0].status !== transition[0]) {
    throw new Error("Ticket is not in the required state.");
  }

  const updated = await client.query(
    `UPDATE tenant.support_tickets
     SET status=$4,
       resolved_at=CASE WHEN $4='resolved' THEN now() ELSE resolved_at END,
       closed_at=CASE WHEN $4='closed' THEN now() ELSE closed_at END,
       resolution_code=CASE WHEN $4='resolved' THEN $5 ELSE resolution_code END,
       resolution_summary=CASE WHEN $4='resolved' THEN $6 ELSE resolution_summary END,
       updated_by=$7,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      ticketId,
      transition[1],
      input.resolutionCode || null,
      input.resolutionSummary || null,
      context.userId,
    ],
  );

  await client.query(
    `INSERT INTO tenant.support_ticket_status_history
      (organization_id,ticket_id,from_status,to_status,reason,changed_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      context.organizationId,
      ticketId,
      transition[0],
      transition[1],
      input.reason || null,
      context.userId,
    ],
  );

  await event(
    client,
    context,
    ticketId,
    "ticket",
    ticketId,
    `support.ticket.${action}`,
  );
  return updated.rows[0];
}

export async function createKnowledgeArticle(client, context, input) {
  requirePermission(context, "support.knowledge.manage");
  const result = await client.query(
    `INSERT INTO tenant.support_knowledge_articles
      (organization_id,company_id,article_number,title,summary,content,
       category_id,status,visibility,version,tags,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10::jsonb,$11)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.articleNumber || `KB-${Date.now()}`,
      input.title,
      input.summary || null,
      input.content,
      input.categoryId || null,
      input.visibility || "internal",
      Number(input.version || 1),
      JSON.stringify(input.tags || []),
      context.userId,
    ],
  );
  return result.rows[0];
}
