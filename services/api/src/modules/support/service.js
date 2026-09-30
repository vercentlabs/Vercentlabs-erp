// The Support home dashboard, the picker options for the web forms and a customer's contacts.
import { needAny, qx, seq, uuid } from "./common.js";

const MANAGE = "support.manage";
const VIEW = ["support.view", MANAGE];

// ---------------------------------------------------------------- F379: ticket dashboard
export async function getSupportDeskDashboard(client, c) {
  needAny(c, VIEW);
  const [tickets, myQueue] = await seq([
    () => qx(client, `SELECT
        count(*) FILTER (WHERE status IN ('new','open','pending_customer','pending_internal'))::int AS open_tickets,
        count(*) FILTER (WHERE priority IN ('urgent','critical') AND status NOT IN ('resolved','closed','cancelled','merged'))::int AS high_priority_tickets,
        count(*) FILTER (WHERE created_at::date=current_date)::int AS tickets_today,
        count(*) FILTER (WHERE resolved_at::date=current_date)::int AS resolved_today,
        count(*) FILTER (WHERE status='new')::int AS unassigned_tickets
      FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS my_open FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND assigned_user_id=$3 AND status NOT IN ('resolved','closed','cancelled','merged')`, [c.organizationId, c.companyId, c.userId]),
  ]);
  return { ...tickets.rows[0], ...myQueue.rows[0] };
}

// ---------------------------------------------------------------- picker options for the web forms
export async function listSupportOptions(client, c) {
  needAny(c, ["support.view", "support.ticket.create", "support.communication.manage", MANAGE]);
  const p = [c.organizationId, c.companyId];
  const [customers, categories, agents] = await seq([
    () => qx(client, `SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','both') ORDER BY display_name LIMIT 2000`, [c.organizationId]),
    () => qx(client, `SELECT id, code, name FROM tenant.support_categories WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT u.id, u.email AS code, u.full_name AS name FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND m.status='active' ORDER BY u.full_name LIMIT 500`, [c.organizationId]),
  ]);
  return { customers: customers.rows, categories: categories.rows, agents: agents.rows };
}
export async function listCustomerContacts(client, c, partyId) {
  needAny(c, ["support.view", "support.ticket.create", MANAGE]);
  const { rows } = await qx(client, `SELECT id, trim(first_name || ' ' || coalesce(last_name,'')) AS name, email FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND status='active' ORDER BY is_primary DESC, first_name`, [c.organizationId, uuid(partyId, "Customer")]);
  return rows;
}
