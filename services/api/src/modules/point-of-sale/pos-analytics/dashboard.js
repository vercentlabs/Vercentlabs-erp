import { accessiblePosStoreIds, requirePermission } from "../shared/access-control.js";

// The POS Overview: today at the outlets the person works at (all outlets for those who manage them). "Today" is the company's calendar
// day in its own timezone. Sales and their tenders, the shifts open now, payments and checkouts still waiting for an outcome, returns and
// refunds, cash differences and payment exceptions still open, and each outlet's business day. Counts that need action are what the
// Overview links to; nothing here is a substitute for the Day-End report.
export async function getPointOfSaleDashboard(client, context) {
  requirePermission(context, "pos.view");
  const stores = await accessiblePosStoreIds(client, context);
  const values = [context.organizationId, stores];
  const scope = (alias) => `${alias}.organization_id = $1 AND ($2::uuid[] IS NULL OR ${alias}.store_id = ANY($2::uuid[]))`;
  const today = `(now() AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM public.organizations WHERE id = $1), ''), 'UTC'))::date`;
  const localDay = (column) => `(${column} AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM public.organizations WHERE id = $1), ''), 'UTC'))::date`;
  const sales = (await client.query(
    `SELECT count(*)::int AS sales_today, COALESCE(sum(sale.grand_total), 0)::text AS revenue_today
       FROM tenant.pos_sales sale
      WHERE ${scope("sale")} AND sale.status IN ('completed', 'partially_returned', 'returned') AND ${localDay("COALESCE(sale.completed_at, sale.sale_date)")} = ${today}`,
    values)).rows[0];
  const tenders = (await client.query(
    `SELECT payment.payment_method AS method, COALESCE(sum(payment.amount), 0)::text AS amount, count(*)::int AS payments
       FROM tenant.pos_payments payment JOIN tenant.pos_sales sale ON sale.id = payment.sale_id
      WHERE ${scope("sale")} AND sale.status IN ('completed', 'partially_returned', 'returned') AND payment.status IN ('captured', 'refunded', 'partially_refunded')
        AND ${localDay("COALESCE(sale.completed_at, sale.sale_date)")} = ${today}
      GROUP BY 1 ORDER BY 1`, values)).rows;
  const shifts = (await client.query(
    `SELECT shift.id, shift.shift_number, shift.status, shift.opened_at, terminal.code AS terminal_code, terminal.name AS terminal_name, store.name AS store_name,
            COALESCE(cashier.full_name, shift.cashier_id::text) AS cashier_name
       FROM tenant.pos_shifts shift
       JOIN tenant.pos_terminals terminal ON terminal.id = shift.terminal_id
       JOIN tenant.pos_stores store ON store.id = shift.store_id
       LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
      WHERE ${scope("shift")} AND shift.status IN ('open', 'closing')
      ORDER BY shift.opened_at LIMIT 50`, values)).rows;
  const counts = (await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.pos_returns ret WHERE ${scope("ret")} AND ret.status IN ('approved', 'completed') AND ${localDay("ret.created_at")} = ${today}) AS returns_today,
       (SELECT count(*)::int FROM tenant.pos_payments payment WHERE ${scope("payment")}
          AND (payment.attempt_status IN ('unknown', 'reconciliation_required', 'processing', 'capture_pending', 'awaiting_customer') OR payment.recovery_status = 'finalization_failed')
          AND COALESCE(payment.initiated_at, payment.updated_at) > now() - interval '7 days') AS pending_payments,
       (SELECT count(*)::int FROM tenant.pos_carts cart WHERE ${scope("cart")} AND cart.status IN ('draft', 'priced') AND cart.checkout_started_at IS NOT NULL) AS pending_checkouts,
       (SELECT count(*)::int FROM tenant.payment_refunds refund WHERE ${scope("refund")}
          AND refund.status IN ('awaiting_approval', 'authorized', 'processing', 'partially_refunded', 'failed_action_required', 'reconciliation_required')) AS open_refunds,
       (SELECT count(*)::int FROM tenant.pos_cash_differences difference WHERE ${scope("difference")} AND difference.case_status IN ('OPEN', 'INVESTIGATING')) AS open_cash_differences,
       (SELECT count(*)::int FROM tenant.pos_payment_exceptions exception WHERE exception.organization_id = $1
          AND ($2::uuid[] IS NULL OR exception.store_id IS NULL OR exception.store_id = ANY($2::uuid[])) AND exception.status = 'open') AS open_payment_exceptions,
       (SELECT count(*)::int FROM tenant.pos_carts cart WHERE ${scope("cart")} AND cart.status = 'held') AS held_carts`,
    values)).rows[0];
  const days = (await client.query(
    `SELECT DISTINCT ON (day.store_id) day.store_id, store.name AS store_name, day.business_date, day.status, day.z_report_id
       FROM tenant.pos_business_days day JOIN tenant.pos_stores store ON store.id = day.store_id
      WHERE ${scope("day")}
      ORDER BY day.store_id, day.business_date DESC`, values)).rows;
  const dateText = (value) => (value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value);
  return {
    sales_today: sales.sales_today,
    revenue_today: sales.revenue_today,
    open_shifts: shifts.length,
    returns_today: counts.returns_today,
    tenders,
    activeShifts: shifts.map((row) => ({ id: row.id, number: row.shift_number, status: row.status, openedAt: row.opened_at, terminal: `${row.terminal_code} · ${row.terminal_name}`,
      outlet: row.store_name, cashier: row.cashier_name })),
    attention: {
      pendingPayments: counts.pending_payments, pendingCheckouts: counts.pending_checkouts, openRefunds: counts.open_refunds, openCashDifferences: counts.open_cash_differences,
      openPaymentExceptions: counts.open_payment_exceptions, heldCarts: counts.held_carts,
    },
    businessDays: days.map((row) => ({ outletId: row.store_id, outlet: row.store_name, businessDate: dateText(row.business_date), status: row.status, zReportId: row.z_report_id })),
  };
}
