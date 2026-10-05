// The contact's summary and its read-only related lists. Opportunities,
// quotations, orders and tickets are read from their own modules — never
// copied into CRM — and shown only to callers who can open those modules.
import { contactCan } from "./access.js";
import { CrmError } from "../data-management/errors.js";
import { getContact } from "./records.js";

const MODULE_PERMISSIONS = Object.freeze({ sales: "sales.view", projects: "projects.view", support: "support.view" });
const OPEN_TICKET = "('new', 'open', 'pending_customer', 'pending_internal')";

export async function getContactSummary(client, context, contactId) {
  const contact = await getContact(client, context, contactId);
  const access = Object.fromEntries(Object.entries(MODULE_PERMISSIONS).map(([module, permission]) => [module, contactCan(context, permission)]));
  const values = [context.organizationId, contact.id];
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM tenant.crm_activities WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2
                AND activity_type IN ('task', 'follow_up') AND status IN ('planned', 'in_progress', 'overdue'))::int AS open_tasks,
            (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id = $1 AND contact_id = $2
                AND lifecycle_status IN ('draft', 'pending_approval', 'approved', 'sent'))::int AS open_quotations,
            (SELECT count(*) FROM tenant.sales_orders WHERE organization_id = $1 AND contact_id = $2 AND lifecycle_status NOT IN ('draft', 'cancelled'))::int AS orders,
            (SELECT count(*) FROM tenant.support_tickets WHERE organization_id = $1 AND contact_id = $2 AND status IN ${OPEN_TICKET})::int AS open_tickets`,
    values,
  );
  const row = rows[0];
  return {
    access,
    accountId: contact.accountId,
    accountName: contact.accountName,
    role: contact.roleLabel,
    ownerName: contact.ownerName,
    openOpportunities: contact.openOpportunities,
    openTasks: row.open_tasks,
    nextFollowUpAt: contact.nextFollowUpAt,
    lastActivityAt: contact.lastActivityAt,
    ...(access.sales ? { openQuotations: row.open_quotations, orders: row.orders } : {}),
    ...(access.support ? { openTickets: row.open_tickets } : {}),
  };
}

const RELATED = Object.freeze({
  opportunities: {
    module: null,
    sql: `SELECT opportunity.id, opportunity.code, opportunity.name AS title, opportunity.status, stage.name AS stage, opportunity.amount, opportunity.currency_code,
                 opportunity.expected_close_date AS date, owner.full_name AS owner_name,
                 CASE WHEN opportunity.contact_id = $2 THEN 'Primary contact' ELSE initcap(replace(COALESCE(role.role, 'stakeholder'), '_', ' ')) END AS kind
            FROM tenant.crm_opportunities opportunity
            LEFT JOIN tenant.crm_opportunity_contact_roles role ON role.organization_id = opportunity.organization_id AND role.opportunity_id = opportunity.id
                  AND role.contact_id = $2 AND role.status = 'active'
            LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
            LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
           WHERE opportunity.organization_id = $1 AND opportunity.status <> 'archived' AND (opportunity.contact_id = $2 OR role.id IS NOT NULL)
           ORDER BY opportunity.status = 'open' DESC, opportunity.expected_close_date NULLS LAST LIMIT 100`,
    href: (row) => `/crm/opportunities/${row.id}`,
  },
  quotations: {
    module: "sales",
    sql: `SELECT quotation.id, quotation.quotation_number AS code, quotation.lifecycle_status AS status, version.grand_total AS amount, version.currency_code,
                 quotation.created_at AS date, quotation.valid_until, account.display_name AS title
            FROM tenant.sales_quotations quotation
            LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
            LEFT JOIN tenant.business_parties account ON account.organization_id = quotation.organization_id AND account.id = quotation.party_id
           WHERE quotation.organization_id = $1 AND quotation.contact_id = $2 ORDER BY quotation.created_at DESC LIMIT 100`,
    href: (row) => `/sales/quotations/${row.id}`,
  },
  orders: {
    module: "sales",
    sql: `SELECT sales_order.id, sales_order.sales_order_number AS code, sales_order.lifecycle_status AS status, sales_order.payment_status, version.grand_total AS amount,
                 version.currency_code, sales_order.order_date AS date, account.display_name AS title
            FROM tenant.sales_orders sales_order
            LEFT JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
            LEFT JOIN tenant.business_parties account ON account.organization_id = sales_order.organization_id AND account.id = sales_order.party_id
           WHERE sales_order.organization_id = $1 AND sales_order.contact_id = $2 ORDER BY sales_order.order_date DESC NULLS LAST, sales_order.created_at DESC LIMIT 100`,
    href: (row) => `/sales/orders/${row.id}`,
  },
  // Projects have no contact of their own: those of the person's company.
  projects: {
    module: "projects",
    sql: `SELECT project.id, project.project_number AS code, project.name AS title, project.status, project.percent_complete, project.planned_end_date AS date,
                 manager.full_name AS owner_name
            FROM tenant.projects project
            JOIN tenant.contacts contact ON contact.organization_id = project.organization_id AND contact.id = $2
            LEFT JOIN public.users manager ON manager.id = project.project_manager_id
           WHERE project.organization_id = $1 AND project.customer_id = contact.party_id ORDER BY project.created_at DESC LIMIT 100`,
    href: () => null,
  },
  tickets: {
    module: "support",
    sql: `SELECT ticket.id, ticket.ticket_number AS code, ticket.subject AS title, ticket.status, ticket.priority, ticket.created_at AS date, agent.full_name AS owner_name
            FROM tenant.support_tickets ticket LEFT JOIN public.users agent ON agent.id = ticket.assigned_user_id
           WHERE ticket.organization_id = $1 AND ticket.contact_id = $2 ORDER BY ticket.created_at DESC LIMIT 100`,
    href: (row) => `/support/ticket/${row.id}`,
  },
});

export const CONTACT_RELATED_LISTS = Object.freeze(Object.keys(RELATED));

export async function listContactRelated(client, context, contactId, list) {
  const definition = RELATED[list];
  if (!definition) throw new CrmError(404, "Unknown related list.", "CRM_CONTACT_RELATED_UNKNOWN");
  const contact = await getContact(client, context, contactId);
  if (definition.module && !contactCan(context, MODULE_PERMISSIONS[definition.module]))
    throw new CrmError(403, "You do not have access to this information.", "PERMISSION_DENIED");
  const { rows } = await client.query(definition.sql, [context.organizationId, contact.id]);
  return rows.map((row) => ({
    id: row.id,
    code: row.code ?? null,
    title: row.title ?? null,
    status: row.status ?? null,
    stage: row.stage ?? null,
    kind: row.kind ?? null,
    priority: row.priority ?? null,
    paymentStatus: row.payment_status ?? null,
    amount: row.amount === undefined || row.amount === null ? null : Number(row.amount),
    outstanding: null,
    currencyCode: row.currency_code?.trim() ?? null,
    percentComplete: row.percent_complete === undefined || row.percent_complete === null ? null : Number(row.percent_complete),
    date: row.date ?? null,
    dueDate: row.valid_until ?? null,
    ownerName: row.owner_name ?? null,
    href: definition.href(row),
  }));
}
