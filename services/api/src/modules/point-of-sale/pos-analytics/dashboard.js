import { requirePermission } from "../shared/access-control.js";

// POS-CAP-009 (F307 POS analytics). getPointOfSaleDashboard is today's
// coarse today-only aggregate -- the real date-range/store/terminal/
// cashier drilldown analytics this capability still needs belongs here
// alongside it once built (see the POS implementation tracker's gap
// matrix for F307's remaining scope).
export async function getPointOfSaleDashboard(client, context) {
  requirePermission(context, "pos.view");
  const sales = await client.query(
    `SELECT
       count(*) FILTER (WHERE sale.sale_date::date=current_date AND sale.status='completed')::int AS sales_today,
       coalesce(sum(sale.grand_total)
         FILTER (WHERE sale.sale_date::date=current_date AND sale.status='completed'),0)::text AS revenue_today,
       count(*) FILTER (WHERE shift.status='open')::int AS open_shifts
     FROM tenant.pos_sales sale
     RIGHT JOIN tenant.pos_shifts shift
       ON shift.organization_id=sale.organization_id
      AND shift.id=sale.shift_id
     WHERE shift.organization_id=$1 AND shift.company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const returns = await client.query(
    `SELECT count(*) FILTER (
       WHERE created_at::date=current_date
         AND status IN ('approved','completed')
     )::int AS returns_today
     FROM tenant.pos_returns
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  return { ...sales.rows[0], ...returns.rows[0] };
}
