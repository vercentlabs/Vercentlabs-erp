// Customer 360: the account's summary cards and the read-only related lists
// on its detail page. CRM data (contacts, leads, opportunities) follows the
// account's own visibility; Sales (with its deliveries), Finance, Point of
// Sale, Projects and Support data is shown only to callers who can open that
// module, and is never editable from here. Each row links to its own page.
import { canInApp, hasApp, loadApps } from "../../../core/access/apps.js";
import { dealRate } from "../data-management/reporting-currency.js";
import { CrmError } from "../data-management/errors.js";
import { getAccount } from "./records.js";
import { getCustomerProjects } from "../../projects/project-customer.js";

// Each tab: the app (module) it reads and the permission it needs. A tab shows only while the organization has that app.
const MODULE_PERMISSIONS = Object.freeze({ sales: "sales.view", finance: "accounting.view", pos: "pos.view", projects: "projects.view", support: "support.view" });
const MODULE_APPS = Object.freeze({ sales: "sales", finance: "accounting", pos: "point-of-sale", projects: "projects", support: "support" });
export const tabAllowed = (context, tab) => canInApp(context, MODULE_APPS[tab], MODULE_PERMISSIONS[tab]);
const OPEN_QUOTATION = "('draft', 'pending_approval', 'approved', 'sent')";
const OPEN_INVOICE = "('posted', 'partially_paid', 'overdue', 'disputed')";
const OPEN_TICKET = "('new', 'open', 'pending_customer', 'pending_internal')";
const num = (value) => Number(value ?? 0);

function access(context) {
  return Object.fromEntries(Object.keys(MODULE_PERMISSIONS).map((tab) => [tab, tabAllowed(context, tab)]));
}

export async function getAccountSummary(client, context, partyId) {
  const account = await getAccount(client, context, partyId);
  await loadApps(client, context);
  const can = access(context);
  const values = [context.organizationId, account.id];
  const one = async (sql) => (await client.query(sql, values)).rows[0];

  const crm = await one(
    `SELECT (SELECT count(*) FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2 AND status = 'won')::int AS won_opportunities,
            (SELECT COALESCE(sum(COALESCE(won.won_amount, won.amount) * ${dealRate("won")}), 0) FROM tenant.crm_opportunities won WHERE won.organization_id = $1 AND won.party_id = $2 AND won.status = 'won') AS won_value,
            (SELECT count(*) FROM tenant.crm_leads WHERE organization_id = $1 AND converted_party_id = $2)::int AS converted_leads,
            -- The company's work: on the company itself, on its deals and on its people (a manager opening the company sees all of it).
            (SELECT count(*) FROM tenant.crm_activities activity WHERE activity.organization_id = $1
                AND activity.status IN ('planned', 'in_progress', 'overdue') AND activity.activity_type IN ('task', 'follow_up')
                AND ((activity.entity_type = 'party' AND activity.entity_id = $2) OR activity.related_party_id = $2
                  OR (activity.entity_type = 'opportunity' AND activity.entity_id IN (SELECT id FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2))
                  OR (activity.entity_type = 'contact' AND activity.entity_id IN (SELECT id FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2))))::int AS open_tasks,
            (SELECT max(COALESCE(activity.completed_at, activity.start_at)) FROM tenant.crm_activities activity WHERE activity.organization_id = $1 AND activity.status = 'completed'
                AND ((activity.entity_type = 'party' AND activity.entity_id = $2) OR activity.related_party_id = $2
                  OR (activity.entity_type = 'opportunity' AND activity.entity_id IN (SELECT id FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2))
                  OR (activity.entity_type = 'contact' AND activity.entity_id IN (SELECT id FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2)))) AS last_activity_at`,
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
      lastActivityAt: [account.lastActivityAt, crm.last_activity_at].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] ?? null,
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
  // Point of Sale (CRM audit: an FMCG or retail customer's counter visits): visits, spend, last visit and loyalty points.
  if (can.pos) {
    const pos = await one(
      `SELECT count(*)::int AS visits, COALESCE(sum(grand_total), 0) AS spend, max(sale_date) AS last_visit,
              (SELECT balance FROM tenant.pos_loyalty_balances WHERE organization_id = $1 AND customer_id = $2) AS points
         FROM tenant.pos_sales WHERE organization_id = $1 AND customer_id = $2 AND status NOT IN ('voided', 'cancelled', 'draft')`);
    summary.pos = { visits: pos.visits, spend: num(pos.spend), lastVisit: pos.last_visit, loyaltyPoints: pos.points === null ? null : num(pos.points) };
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
    const { summary: projects } = await getCustomerProjects(client, context, partyId);
    summary.projects = { active: projects.active + projects.onHold, total: projects.total };
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
                 to_char(opportunity.expected_close_date, 'YYYY-MM-DD') AS date, owner.full_name AS owner_name
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
  // The dispatches against its orders: when each left, how it went, and where it is now.
  deliveries: {
    module: "sales",
    sql: `SELECT request.id, request.request_number AS code, request.delivery_status AS status, request.carrier AS kind, COALESCE(request.dispatch_date, request.requested_at::date) AS date,
                 request.expected_delivery_date AS due_date
            FROM tenant.sales_fulfillment_requests request
           WHERE request.organization_id = $1 AND request.party_id = $2 ORDER BY request.requested_at DESC LIMIT 100`,
    href: (row) => `/sales/deliveries/${row.id}`,
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
    // The invoice's page in Sales when the organization has Sales, else Accounting's list found on its number.
    href: (row, context) => (hasApp(context, "sales") ? `/sales/invoices/${row.id}` : `/accounting/customer-invoices?search=${encodeURIComponent(row.code ?? "")}`),
  },
  payments: {
    module: "finance",
    sql: `SELECT id, receipt_number AS code, status, amount, currency_code, receipt_date AS date, payment_method AS kind
            FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2 ORDER BY receipt_date DESC, created_at DESC LIMIT 100`,
    href: (row) => `/accounting/receipts/${row.id}`,
  },
  // Its counter purchases (Point of Sale), each opening its receipt.
  posSales: {
    module: "pos",
    sql: `SELECT sale.id, COALESCE(sale.invoice_number, sale.receipt_number) AS code, sale.status, sale.grand_total AS amount, sale.currency_code, sale.sale_date AS date,
                 sale.cashier_name AS owner_name
            FROM tenant.pos_sales sale WHERE sale.organization_id = $1 AND sale.customer_id = $2 AND sale.status <> 'draft'
           ORDER BY sale.sale_date DESC, sale.created_at DESC LIMIT 100`,
    href: (row) => `/pos/receipts/${row.id}`,
  },
  // Read through Projects, which shows only the projects the person may see (and an account's drafts before it became a Customer).
  projects: { module: "projects", projects: true, href: (row) => `/projects/${row.id}` },
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
  await loadApps(client, context);
  if (definition.module && !tabAllowed(context, definition.module))
    throw new CrmError(403, "You do not have access to this information.", "PERMISSION_DENIED");
  if (definition.projects) {
    const { projects } = await getCustomerProjects(client, context, account.id);
    return projects.map((row) => ({ id: row.id, code: row.code, title: row.name ?? "Untitled draft", status: row.status.toLowerCase(), stage: null, kind: row.provisional ? "provisional" : null,
      priority: null, paymentStatus: null, amount: null, outstanding: null, currencyCode: null, percentComplete: null, date: row.targetEndDate ?? null, dueDate: null, ownerName: row.manager, href: row.href }));
  }
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
    href: definition.href(row, context),
  }));
}
