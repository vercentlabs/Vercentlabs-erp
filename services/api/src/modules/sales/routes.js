// Beats (Sales plan, Phase 4): the round a salesperson makes on given weekdays — the retailers of one area, visited every Monday and
// Thursday. Each customer is on at most one beat (business_parties.sales_route_id); orders and customers are listed by beat, and the
// beat list shows how many customers each has and what they ordered this month.
import { SalesError } from "./index.js";
import { customerScopeSql } from "./customers/access.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WEEKDAYS = Object.freeze([
  { day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" }, { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 7, label: "Sun" },
]);
const can = (context, permission) => context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission);
const text = (value, max) => String(value ?? "").trim().slice(0, max);

const view = (row) => ({
  id: row.id, code: row.code, name: row.name, salespersonUserId: row.salesperson_user_id, salespersonName: row.salesperson_name ?? null,
  visitDays: (row.visit_days ?? []).map(Number), status: row.status, customers: Number(row.customers ?? 0),
  orderedThisMonth: row.ordered_this_month == null ? null : Number(row.ordered_this_month), ordersThisMonth: Number(row.orders_this_month ?? 0),
});

// filters: { status: active | inactive | all, today: true (only the beats visited today) }
export async function listSalesRoutes(client, context, filters = {}) {
  if (!can(context, "sales.view")) throw new SalesError(403, "You do not have permission to see beats.", "PERMISSION_DENIED");
  const status = ["active", "inactive"].includes(filters.status) ? filters.status : filters.status === "all" ? null : "active";
  const rows = (await client.query(
    `SELECT route.*, owner.full_name AS salesperson_name,
            (SELECT count(*) FROM tenant.business_parties party WHERE party.organization_id = route.organization_id AND party.sales_route_id = route.id AND party.status = 'active') AS customers,
            month.orders AS orders_this_month, month.ordered AS ordered_this_month
       FROM tenant.sales_routes route
       LEFT JOIN public.users owner ON owner.id = route.salesperson_user_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS orders, sum(version.grand_total * COALESCE(version.exchange_rate, 1)) AS ordered
           FROM tenant.sales_orders sales_order
           JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
           JOIN tenant.business_parties party ON party.organization_id = sales_order.organization_id AND party.id = sales_order.party_id
          WHERE sales_order.organization_id = route.organization_id AND party.sales_route_id = route.id AND sales_order.lifecycle_status IN ('confirmed', 'closed')
            AND sales_order.order_date >= date_trunc('month', tenant.company_today())::date) month ON true
      WHERE route.organization_id = $1 AND ($2::text IS NULL OR route.status = $2)
        AND (NOT $3 OR extract(isodow FROM tenant.company_today())::smallint = ANY(route.visit_days))
      ORDER BY route.name`, [context.organizationId, status, filters.today === true || filters.today === "true"])).rows;
  return { routes: rows.map(view), weekdays: WEEKDAYS };
}

// input: { code, name, salespersonUserId?, visitDays?: [1..7], status? }
export async function saveSalesRoute(client, context, input = {}, routeId = null) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up beats.", "PERMISSION_DENIED");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!code) throw new SalesError(400, "Enter the beat's code.", "SALES_ROUTE_INVALID", { field: "code" });
  if (!name) throw new SalesError(400, "Enter the beat's name.", "SALES_ROUTE_INVALID", { field: "name" });
  const days = [...new Set((Array.isArray(input.visitDays) ? input.visitDays : []).map(Number))].filter((day) => Number.isInteger(day) && day >= 1 && day <= 7).sort();
  const salesperson = input.salespersonUserId || null;
  if (salesperson && (!UUID.test(String(salesperson)) || !(await client.query(
    `SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [context.organizationId, salesperson])).rows[0]))
    throw new SalesError(400, "Choose an active user as the salesperson.", "SALES_ROUTE_INVALID", { field: "salespersonUserId" });
  const status = input.status === "inactive" ? "inactive" : "active";
  // Checked first: a unique violation would end the transaction.
  if ((await client.query("SELECT 1 FROM tenant.sales_routes WHERE organization_id = $1 AND code = $2 AND id IS DISTINCT FROM $3::uuid",
    [context.organizationId, code, routeId && UUID.test(String(routeId)) ? routeId : null])).rows[0])
    throw new SalesError(409, `Another beat has the code ${code}.`, "SALES_ROUTE_DUPLICATE", { field: "code" });
  try {
    const row = routeId
      ? (await client.query(
        `UPDATE tenant.sales_routes SET code = $3, name = $4, salesperson_user_id = $5, visit_days = $6::smallint[], status = $7, updated_by = $8, updated_at = clock_timestamp()
          WHERE organization_id = $1 AND id = $2 RETURNING *`, [context.organizationId, UUID.test(String(routeId)) ? routeId : null, code, name, salesperson, days, status, context.userId ?? null])).rows[0]
      : (await client.query(
        `INSERT INTO tenant.sales_routes (organization_id, code, name, salesperson_user_id, visit_days, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5::smallint[], $6, $7, $7) RETURNING *`,
        [context.organizationId, code, name, salesperson, days, status, context.userId ?? null])).rows[0];
    if (!row) throw new SalesError(404, "Beat not found.", "SALES_ROUTE_NOT_FOUND");
    return { route: view(row) };
  } catch (error) {
    if (error?.code === "23505") throw new SalesError(409, `Another beat has the code ${code}.`, "SALES_ROUTE_DUPLICATE", { field: "code" });
    throw error;
  }
}

// Puts customers on a beat (or takes them off it: routeId null). input: { customerIds: [...], routeId }
export async function assignCustomersToRoute(client, context, input = {}) {
  if (!can(context, "sales.customers.edit")) throw new SalesError(403, "You do not have permission to change customers.", "PERMISSION_DENIED");
  const ids = (Array.isArray(input.customerIds) ? input.customerIds : []).filter((id) => UUID.test(String(id))).slice(0, 500);
  if (!ids.length) throw new SalesError(400, "Choose the customers.", "SALES_ROUTE_INVALID");
  const routeId = input.routeId || null;
  if (routeId && !(await client.query("SELECT 1 FROM tenant.sales_routes WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, UUID.test(String(routeId)) ? routeId : null])).rows[0])
    throw new SalesError(400, "Choose an active beat.", "SALES_ROUTE_INVALID", { field: "routeId" });
  // Only customers the person may see.
  const values = [context.organizationId, ids, routeId, context.userId ?? null];
  const scope = customerScopeSql(context, values, "customer");
  const { rowCount } = await client.query(
    `UPDATE tenant.business_parties customer SET sales_route_id = $3, updated_by = $4, updated_at = now()
      WHERE customer.organization_id = $1 AND customer.id = ANY($2::uuid[]) AND customer.party_type IN ('customer', 'both', 'prospect')${scope}`, values);
  return { updated: rowCount ?? 0 };
}
