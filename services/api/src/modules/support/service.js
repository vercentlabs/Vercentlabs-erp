// F372-F380: customer order history, product/asset linkage detail, warranty/service entitlements,
// CSAT reporting, agent performance, SLA reporting, ticket dashboards, and the org-wide audit log.
// Cross-module reads (Sales orders, Assets) are read-only lookups scoped by organization/company --
// Support never writes to another module's tables (the one exception, a best-effort write into CRM's
// own service-event log, lives in tickets.js next to the ticket lifecycle it mirrors).
import { SupportError, dateOrNull, dateRequired, need, needAny, oneOf, positive, qx, resolveParty, seq, textOrNull, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/document-numbering.js";

const MANAGE = "support.manage";
const VIEW = ["support.view", MANAGE];
const REPORTS = ["support.reports.view", MANAGE];

// ---------------------------------------------------------------- F372: customer order history
export async function getCustomerOrderHistory(client, c, partyId) {
  needAny(c, VIEW);
  await resolveParty(client, c, partyId);
  const { rows } = await qx(client, `SELECT id, sales_order_number, order_date, lifecycle_status, fulfillment_status, payment_status, currency_code
    FROM tenant.sales_orders WHERE organization_id=$1 AND company_id=$2 AND party_id=$3 ORDER BY order_date DESC LIMIT 200`, [c.organizationId, c.companyId, uuid(partyId, "Customer")]).catch(() => ({ rows: [] }));
  return rows;
}

// ---------------------------------------------------------------- F373/F374: product and asset linkage
export async function getTicketLinkedRecords(client, c, ticketId) {
  needAny(c, VIEW);
  const t = (await qx(client, `SELECT product_id, related_asset_id, related_sales_order_id FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(ticketId, "Ticket")])).rows[0];
  if (!t) throw new SupportError(404, "Ticket was not found.", "SUPPORT_TICKET_NOT_FOUND");
  const [product, asset, order] = await seq([
    () => (!t.product_id ? Promise.resolve({ rows: [] }) : qx(client, `SELECT id, code, name, item_type FROM tenant.items WHERE organization_id=$1 AND id=$2`, [c.organizationId, t.product_id]).catch(() => ({ rows: [] }))),
    () => (!t.related_asset_id ? Promise.resolve({ rows: [] }) : qx(client, `SELECT id, asset_number, name, serial_number, status, warranty_start_date, warranty_end_date FROM tenant.assets WHERE organization_id=$1 AND id=$2`, [c.organizationId, t.related_asset_id]).catch(() => ({ rows: [] }))),
    () => (!t.related_sales_order_id ? Promise.resolve({ rows: [] }) : qx(client, `SELECT id, sales_order_number, order_date, lifecycle_status FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [c.organizationId, t.related_sales_order_id]).catch(() => ({ rows: [] }))),
  ]);
  const assetRow = asset.rows[0] ?? null;
  return {
    product: product.rows[0] ?? null,
    asset: assetRow,
    assetUnderWarranty: assetRow?.warranty_end_date ? assetRow.warranty_end_date >= new Date().toISOString().slice(0, 10) : null,
    order: order.rows[0] ?? null,
  };
}

// ---------------------------------------------------------------- F375: entitlements (warranty / service plan)
export async function listEntitlements(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.partyId) { params.push(uuid(filters.partyId, "Customer")); where = ` AND e.party_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT e.*, party.display_name AS party_name, i.name AS product_name FROM tenant.support_entitlements e
    LEFT JOIN tenant.business_parties party ON party.id=e.party_id LEFT JOIN tenant.items i ON i.id=e.product_id
    WHERE e.organization_id=$1 AND e.company_id=$2${where} ORDER BY e.starts_on DESC LIMIT 500`, params);
  return rows;
}
export async function saveEntitlement(client, c, input) {
  need(c, MANAGE);
  const partyId = uuid(input.partyId, "Customer");
  await resolveParty(client, c, partyId);
  const startsOn = dateRequired(input.startsOn, "Start date");
  const endsOn = dateOrNull(input.endsOn, "End date");
  if (endsOn && endsOn < startsOn) throw new SupportError(400, "The end date is before the start date.", "SUPPORT_ENTITLEMENT_INVALID");
  const tier = oneOf(String(input.tier ?? "standard"), ["standard", "premium", "enterprise"], "Tier");
  const quota = input.ticketQuota === undefined || input.ticketQuota === "" ? null : Math.trunc(positive(input.ticketQuota, "Ticket quota"));
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_entitlements SET tier=$4,sla_policy_id=$5,starts_on=$6,ends_on=$7,ticket_quota=$8,notes=$9,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Entitlement"), tier, uuidOrNull(input.slaPolicyId, "SLA policy"), startsOn, endsOn, quota, textOrNull(input.notes, 1000)]);
    if (!rows[0]) throw new SupportError(404, "Entitlement was not found.", "SUPPORT_ENTITLEMENT_NOT_FOUND");
    return rows[0];
  }
  const entitlementNumber = await nextDocumentNumber(client, c, { documentType: "support_entitlement", prefix: "ENT" });
  const { rows } = await qx(client, `INSERT INTO tenant.support_entitlements(organization_id,company_id,entitlement_number,party_id,product_id,tier,source,sla_policy_id,starts_on,ends_on,ticket_quota,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, entitlementNumber, partyId, uuidOrNull(input.productId, "Product"), tier, oneOf(String(input.source ?? "manual"), ["manual", "warranty", "subscription"], "Source"), uuidOrNull(input.slaPolicyId, "SLA policy"), startsOn, endsOn, quota, textOrNull(input.notes, 1000), c.userId]);
  return rows[0];
}
export async function setEntitlementStatus(client, c, id, status) {
  need(c, MANAGE);
  const target = oneOf(String(status), ["active", "suspended", "expired", "cancelled"], "Status");
  const { rows } = await qx(client, `UPDATE tenant.support_entitlements SET status=$4,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Entitlement"), target]);
  if (!rows[0]) throw new SupportError(404, "Entitlement was not found.", "SUPPORT_ENTITLEMENT_NOT_FOUND");
  return rows[0];
}

// ---------------------------------------------------------------- F376: CSAT
export async function getCsatReport(client, c, filters = {}) {
  needAny(c, REPORTS);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.from) { params.push(dateRequired(filters.from, "From")); where += ` AND csat_submitted_at >= $${params.length}`; }
  if (filters.to) { params.push(dateRequired(filters.to, "To")); where += ` AND csat_submitted_at <= $${params.length}::date + 1`; }
  const { rows } = await qx(client, `SELECT count(*)::int AS responses, round(avg(satisfaction_score)::numeric,2) AS average,
      count(*) FILTER (WHERE satisfaction_score >= 4)::int AS satisfied, count(*) FILTER (WHERE satisfaction_score <= 2)::int AS dissatisfied
    FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND csat_submitted_at IS NOT NULL${where}`, params);
  const byAgent = await qx(client, `SELECT assigned_user_id, count(*)::int AS responses, round(avg(satisfaction_score)::numeric,2) AS average
    FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND csat_submitted_at IS NOT NULL${where} AND assigned_user_id IS NOT NULL GROUP BY assigned_user_id ORDER BY average DESC`, params);
  return { ...rows[0], byAgent: byAgent.rows };
}

// ---------------------------------------------------------------- F377: agent performance
export async function getAgentPerformance(client, c, filters = {}) {
  needAny(c, REPORTS);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.from) { params.push(dateRequired(filters.from, "From")); where += ` AND t.created_at >= $${params.length}`; }
  if (filters.to) { params.push(dateRequired(filters.to, "To")); where += ` AND t.created_at <= $${params.length}::date + 1`; }
  const { rows } = await qx(client, `SELECT t.assigned_user_id,
      count(*)::int AS total_tickets,
      count(*) FILTER (WHERE t.status IN ('resolved','closed'))::int AS resolved_tickets,
      round(avg(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))/60) FILTER (WHERE t.first_responded_at IS NOT NULL)::numeric,1) AS avg_first_response_minutes,
      round(avg(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/60) FILTER (WHERE t.resolved_at IS NOT NULL)::numeric,1) AS avg_resolution_minutes,
      count(*) FILTER (WHERE t.resolution_due_at IS NOT NULL AND t.resolved_at IS NOT NULL AND t.resolved_at > t.resolution_due_at)::int AS breached_resolutions,
      round(avg(t.satisfaction_score) FILTER (WHERE t.satisfaction_score IS NOT NULL)::numeric,2) AS avg_csat
    FROM tenant.support_tickets t WHERE t.organization_id=$1 AND t.company_id=$2 AND t.assigned_user_id IS NOT NULL${where} GROUP BY t.assigned_user_id ORDER BY total_tickets DESC`, params);
  return rows;
}

// ---------------------------------------------------------------- F378: SLA reporting
export async function getSlaReport(client, c, filters = {}) {
  needAny(c, REPORTS);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.from) { params.push(dateRequired(filters.from, "From")); where += ` AND t.created_at >= $${params.length}`; }
  if (filters.to) { params.push(dateRequired(filters.to, "To")); where += ` AND t.created_at <= $${params.length}::date + 1`; }
  const byPriority = await qx(client, `SELECT t.priority,
      count(*) FILTER (WHERE t.sla_policy_id IS NOT NULL)::int AS covered,
      count(*) FILTER (WHERE t.first_response_due_at IS NOT NULL AND (t.first_responded_at IS NULL OR t.first_responded_at <= t.first_response_due_at))::int AS first_response_met,
      count(*) FILTER (WHERE t.first_response_due_at IS NOT NULL AND t.first_responded_at IS NOT NULL AND t.first_responded_at > t.first_response_due_at)::int AS first_response_breached,
      count(*) FILTER (WHERE t.resolution_due_at IS NOT NULL AND t.resolved_at IS NOT NULL AND t.resolved_at <= t.resolution_due_at)::int AS resolution_met,
      count(*) FILTER (WHERE t.resolution_due_at IS NOT NULL AND t.resolved_at IS NOT NULL AND t.resolved_at > t.resolution_due_at)::int AS resolution_breached
    FROM tenant.support_tickets t WHERE t.organization_id=$1 AND t.company_id=$2${where} GROUP BY t.priority ORDER BY t.priority`, params);
  const openBreaches = await qx(client, `SELECT count(*) FILTER (WHERE t.first_response_due_at < now() AND t.first_responded_at IS NULL)::int AS first_response_at_risk,
      count(*) FILTER (WHERE t.resolution_due_at < now())::int AS resolution_at_risk
    FROM tenant.support_tickets t WHERE t.organization_id=$1 AND t.company_id=$2 AND t.status NOT IN ('resolved','closed','cancelled','merged')`, [c.organizationId, c.companyId]);
  return { byPriority: byPriority.rows, ...openBreaches.rows[0] };
}

// ---------------------------------------------------------------- F379: ticket dashboard
export async function getSupportDeskDashboard(client, c) {
  needAny(c, VIEW);
  const [tickets, escalations, myQueue] = await seq([
    () => qx(client, `SELECT
        count(*) FILTER (WHERE status IN ('new','open','pending_customer','pending_internal'))::int AS open_tickets,
        count(*) FILTER (WHERE priority IN ('urgent','critical') AND status NOT IN ('resolved','closed','cancelled','merged'))::int AS high_priority_tickets,
        count(*) FILTER (WHERE first_response_due_at < now() AND first_responded_at IS NULL AND status NOT IN ('resolved','closed','cancelled','merged'))::int AS first_response_breaches,
        count(*) FILTER (WHERE resolution_due_at < now() AND status NOT IN ('resolved','closed','cancelled','merged'))::int AS resolution_breaches,
        count(*) FILTER (WHERE created_at::date=current_date)::int AS tickets_today,
        count(*) FILTER (WHERE resolved_at::date=current_date)::int AS resolved_today,
        count(*) FILTER (WHERE status='new')::int AS unassigned_tickets
      FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS open_escalations FROM tenant.support_escalations WHERE organization_id=$1 AND company_id=$2 AND status='open'`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS my_open FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND assigned_user_id=$3 AND status NOT IN ('resolved','closed','cancelled','merged')`, [c.organizationId, c.companyId, c.userId]),
  ]);
  return { ...tickets.rows[0], ...escalations.rows[0], ...myQueue.rows[0] };
}

// ---------------------------------------------------------------- F380: audit trail
export async function getAuditLog(client, c, filters = {}) {
  need(c, "support.audit.view");
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.ticketId) { params.push(uuid(filters.ticketId, "Ticket")); where += ` AND ev.ticket_id=$${params.length}`; }
  if (filters.eventType) { params.push(String(filters.eventType)); where += ` AND ev.event_type=$${params.length}`; }
  const { rows } = await qx(client, `SELECT ev.*, t.ticket_number FROM tenant.support_events ev LEFT JOIN tenant.support_tickets t ON t.id=ev.ticket_id WHERE ev.organization_id=$1 AND ev.company_id=$2${where} ORDER BY ev.occurred_at DESC LIMIT 1000`, params);
  return rows;
}

// ---------------------------------------------------------------- picker options for the web forms
export async function listSupportOptions(client, c) {
  needAny(c, ["support.view", "support.ticket.create", "support.communication.manage", MANAGE]);
  const p = [c.organizationId, c.companyId];
  const [customers, categories, queues, slaPolicies, agents, products, entitlements] = await seq([
    () => qx(client, `SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','both') ORDER BY display_name LIMIT 2000`, [c.organizationId]),
    () => qx(client, `SELECT id, code, name FROM tenant.support_categories WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.support_queues WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.support_sla_policies WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT DISTINCT u.id, u.email AS code, u.full_name AS name FROM tenant.support_queue_members m JOIN public.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active ORDER BY u.full_name`, [c.organizationId]),
    () => qx(client, `SELECT id, code, name FROM tenant.items WHERE organization_id=$1 AND company_id=$2 ORDER BY code LIMIT 2000`, p).catch(() => ({ rows: [] })),
    () => qx(client, `SELECT id, entitlement_number AS code, entitlement_number AS name FROM tenant.support_entitlements WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY entitlement_number LIMIT 500`, p),
  ]);
  return { customers: customers.rows, categories: categories.rows, queues: queues.rows, slaPolicies: slaPolicies.rows, agents: agents.rows, products: products.rows, entitlements: entitlements.rows };
}
export async function listCustomerContacts(client, c, partyId) {
  needAny(c, ["support.view", "support.ticket.create", MANAGE]);
  const { rows } = await qx(client, `SELECT id, trim(first_name || ' ' || coalesce(last_name,'')) AS name, email FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND status='active' ORDER BY is_primary DESC, first_name`, [c.organizationId, uuid(partyId, "Customer")]);
  return rows;
}
