// Customer 360: the account's summary cards and the read-only related lists
// on its detail page. CRM data (contacts, leads, opportunities) follows the
// account's own visibility; Sales, Finance, Projects and Support data is
// shown only to callers who can open that module, and is never editable
// from here.
import { CrmError } from "../data-management/errors.js";
import { accountCan } from "./access.js";
import { getAccount } from "./records.js";

const MODULE_PERMISSIONS = Object.freeze({ sales: "sales.view", finance: "accounting.view", projects: "projects.view", support: "support.view" });
const OPEN_QUOTATION = "('draft', 'pending_approval', 'approved', 'sent')";
const OPEN_INVOICE = "('posted', 'partially_paid', 'overdue', 'disputed')";
const OPEN_TICKET = "('new', 'open', 'pending_customer', 'pending_internal')";
const num = (value) => Number(value ?? 0);

function access(context) {
  return Object.fromEntries(Object.entries(MODULE_PERMISSIONS).map(([module, permission]) => [module, accountCan(context, permission)]));
}

export async function getAccountSummary(client, context, partyId) {
  const account = await getAccount(client, context, partyId);
  const can = access(context);
  const values = [context.organizationId, account.id];
  const one = async (sql) => (await client.query(sql, values)).rows[0];

  const crm = await one(
    `SELECT (SELECT count(*) FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2 AND status = 'won')::int AS won_opportunities,
            (SELECT COALESCE(sum(amount), 0) FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2 AND status = 'won') AS won_value,
            (SELECT count(*) FROM tenant.crm_leads WHERE organization_id = $1 AND converted_party_id = $2)::int AS converted_leads,
            (SELECT count(*) FROM tenant.crm_activities WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2
                AND status IN ('planned', 'in_progress', 'overdue') AND activity_type IN ('task', 'follow_up'))::int AS open_tasks`,
  );
  const summary = {
    access: can,
    crm: {
      openOpportunities: account.openOpportunities,
      openPipelineValue: account.openPipelineValue,
      wonOpportunities: crm.won_opportunities,
      wonValue: num(crm.won_value),
      contacts: account.contactCount,
      convertedLeads: crm.converted_leads,
      openTasks: crm.open_tasks,
      lastActivityAt: account.lastActivityAt,
      nextFollowUpAt: account.nextFollowUpAt,
    },
  };
  if (can.sales) {
    const sales = await one(
      `SELECT (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id = $1 AND party_id = $2 AND lifecycle_status IN ${OPEN_QUOTATION})::int AS open_quotations,
              (SELECT COALESCE(sum(version.grand_total), 0) FROM tenant.sales_quotations quotation
                 JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
                WHERE quotation.organization_id = $1 AND quotation.party_id = $2 AND quotation.lifecycle_status IN ${OPEN_QUOTATION}) AS open_quotation_value,
              (SELECT count(*) FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2 AND lifecycle_status NOT IN ('draft', 'cancelled'))::int AS orders,
              (SELECT COALESCE(sum(version.grand_total), 0) FROM tenant.sales_orders sales_order
                 JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
                WHERE sales_order.organization_id = $1 AND sales_order.party_id = $2 AND sales_order.lifecycle_status NOT IN ('draft', 'cancelled')) AS order_value,
              (SELECT max(order_date) FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2 AND lifecycle_status NOT IN ('draft', 'cancelled')) AS last_order_date`,
    );
    summary.sales = { openQuotations: sales.open_quotations, openQuotationValue: num(sales.open_quotation_value), orders: sales.orders, orderValue: num(sales.order_value), lastOrderDate: sales.last_order_date };
  }
  if (can.finance) {
    const finance = await one(
      `SELECT COALESCE(sum(grand_total) FILTER (WHERE invoice_type <> 'credit_note' AND status NOT IN ('draft', 'pending_approval', 'cancelled', 'reversed')), 0) AS invoiced,
              COALESCE(sum(outstanding_amount) FILTER (WHERE invoice_type <> 'credit_note' AND status IN ${OPEN_INVOICE}), 0) AS outstanding,
              COALESCE(sum(outstanding_amount) FILTER (WHERE invoice_type <> 'credit_note' AND status IN ${OPEN_INVOICE} AND due_date < current_date), 0) AS overdue,
              (SELECT max(receipt_date) FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2 AND status NOT IN ('draft', 'cancelled', 'reversed')) AS last_payment_date
         FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND party_id = $2`,
    );
    summary.finance = { invoiced: num(finance.invoiced), outstanding: num(finance.outstanding), overdue: num(finance.overdue), lastPaymentDate: finance.last_payment_date };
  }
  if (can.projects) {
    const projects = await one(`SELECT count(*) FILTER (WHERE status IN ('planned', 'active', 'on_hold'))::int AS active, count(*)::int AS total FROM tenant.projects WHERE organization_id = $1 AND customer_id = $2`);
    summary.projects = { active: projects.active, total: projects.total };
  }
  if (can.support) {
    const support = await one(`SELECT count(*) FILTER (WHERE status IN ${OPEN_TICKET})::int AS open, count(*)::int AS total FROM tenant.support_tickets WHERE organization_id = $1 AND customer_id = $2`);
    summary.support = { openTickets: support.open, total: support.total };
  }
  return summary;
}

// The related lists. Each entry: the module it needs (null = account
// visibility only), the query, and how a row is shown.
const RELATED = Object.freeze({
  leads: {
    module: null,
    sql: `SELECT lead.id, lead.code, COALESCE(NULLIF(lead.full_name, ''), lead.company_name) AS title, lead.status, lead.converted_at AS date, owner.full_name AS owner_name
            FROM tenant.crm_leads lead LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
           WHERE lead.organization_id = $1 AND lead.converted_party_id = $2 ORDER BY lead.created_at DESC LIMIT 100`,
    href: (row) => `/crm/leads/${row.id}`,
  },
  opportunities: {
    module: null,
    sql: `SELECT opportunity.id, opportunity.code, opportunity.name AS title, opportunity.status, stage.name AS stage, opportunity.amount, opportunity.currency_code,
                 opportunity.expected_close_date AS date, owner.full_name AS owner_name
            FROM tenant.crm_opportunities opportunity
            LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
            LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
           WHERE opportunity.organization_id = $1 AND opportunity.party_id = $2 AND opportunity.status <> 'archived'
           ORDER BY opportunity.status = 'open' DESC, opportunity.expected_close_date NULLS LAST LIMIT 100`,
    href: (row) => `/crm/opportunities/${row.id}`,
  },
  quotations: {
    module: "sales",
    sql: `SELECT quotation.id, quotation.quotation_number AS code, quotation.lifecycle_status AS status, version.grand_total AS amount, version.currency_code,
                 quotation.created_at AS date, quotation.valid_until
            FROM tenant.sales_quotations quotation
            LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
           WHERE quotation.organization_id = $1 AND quotation.party_id = $2 ORDER BY quotation.created_at DESC LIMIT 100`,
    href: (row) => `/sales/quotations/${row.id}`,
  },
  orders: {
    module: "sales",
    sql: `SELECT sales_order.id, sales_order.sales_order_number AS code, sales_order.lifecycle_status AS status, sales_order.payment_status, version.grand_total AS amount,
                 version.currency_code, sales_order.order_date AS date
            FROM tenant.sales_orders sales_order
            LEFT JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
           WHERE sales_order.organization_id = $1 AND sales_order.party_id = $2 ORDER BY sales_order.order_date DESC NULLS LAST, sales_order.created_at DESC LIMIT 100`,
    href: (row) => `/sales/orders/${row.id}`,
  },
  returns: {
    module: "sales",
    sql: `SELECT sales_return.id, sales_return.return_number AS code, sales_return.status, sales_return.reason_code AS title, sales_return.return_date AS date
            FROM tenant.sales_returns sales_return
           WHERE sales_return.organization_id = $1 AND sales_return.party_id = $2 ORDER BY sales_return.return_date DESC, sales_return.created_at DESC LIMIT 100`,
    href: (row) => `/sales/returns/${row.id}`,
  },
  invoices: {
    module: "finance",
    sql: `SELECT id, invoice_number AS code, invoice_type AS kind, status, grand_total AS amount, outstanding_amount AS outstanding, currency_code, invoice_date AS date, due_date
            FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND party_id = $2 ORDER BY invoice_date DESC, created_at DESC LIMIT 100`,
    href: () => null,
  },
  payments: {
    module: "finance",
    sql: `SELECT id, receipt_number AS code, status, amount, currency_code, receipt_date AS date, payment_method AS kind
            FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2 ORDER BY receipt_date DESC, created_at DESC LIMIT 100`,
    href: () => null,
  },
  projects: {
    module: "projects",
    sql: `SELECT project.id, project.project_number AS code, project.name AS title, project.status, project.percent_complete, project.planned_end_date AS date,
                 manager.full_name AS owner_name
            FROM tenant.projects project LEFT JOIN public.users manager ON manager.id = project.project_manager_id
           WHERE project.organization_id = $1 AND project.customer_id = $2 ORDER BY project.created_at DESC LIMIT 100`,
    href: () => null,
  },
  tickets: {
    module: "support",
    sql: `SELECT ticket.id, ticket.ticket_number AS code, ticket.subject AS title, ticket.status, ticket.priority, ticket.created_at AS date, agent.full_name AS owner_name
            FROM tenant.support_tickets ticket LEFT JOIN public.users agent ON agent.id = ticket.assigned_user_id
           WHERE ticket.organization_id = $1 AND ticket.customer_id = $2 ORDER BY ticket.created_at DESC LIMIT 100`,
    href: (row) => `/support/ticket/${row.id}`,
  },
});

export const ACCOUNT_RELATED_LISTS = Object.freeze(Object.keys(RELATED));

export async function listAccountRelated(client, context, partyId, list) {
  const definition = RELATED[list];
  if (!definition) throw new CrmError(404, "Unknown related list.", "CRM_ACCOUNT_RELATED_UNKNOWN");
  const account = await getAccount(client, context, partyId);
  if (definition.module && !accountCan(context, MODULE_PERMISSIONS[definition.module]))
    throw new CrmError(403, "You do not have access to this information.", "PERMISSION_DENIED");
  const { rows } = await client.query(definition.sql, [context.organizationId, account.id]);
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
    outstanding: row.outstanding === undefined || row.outstanding === null ? null : Number(row.outstanding),
    currencyCode: row.currency_code?.trim() ?? null,
    percentComplete: row.percent_complete === undefined || row.percent_complete === null ? null : Number(row.percent_complete),
    date: row.date ?? null,
    dueDate: row.due_date ?? row.valid_until ?? null,
    ownerName: row.owner_name ?? null,
    href: definition.href(row),
  }));
}
