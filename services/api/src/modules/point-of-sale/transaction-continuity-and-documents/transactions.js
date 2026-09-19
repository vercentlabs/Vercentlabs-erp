// Transactions workspace — the search/drill-down surface for a completed
// POS sale. This is a read-only view over facts other capabilities already
// own and persist (sale-completion.js's own tenant.pos_sales/
// pos_sale_lines/pos_payments, returns-refunds-and-exchanges's
// tenant.pos_returns, accounting-posting.js's journal_entry_id/
// accounting_posting_status columns already on pos_sales, and Stock's own
// tenant.stock_movements rows referenced from pos_sale_lines.
// stock_movement_id) — nothing here computes a total, recomputes a tax
// figure, or writes anything. Mirrors getPosSaleReceipt's (receipts.js)
// query shape and store-access enforcement, extended with the filters/
// pagination a manager/auditor's search screen needs and the additional
// evidence (payment provider status, stock movement references, GL
// posting status, audit trail) a receipt document doesn't carry.
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";

const SORT_COLUMNS = Object.freeze({
  sale_date: "sale.sale_date",
  grand_total: "sale.grand_total",
  receipt_number: "sale.receipt_number",
  status: "sale.status",
});

export async function listPosTransactions(client, context, options = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId, context.companyId];
  const clauses = [];

  if (options.search) {
    values.push(`%${options.search}%`);
    clauses.push(`sale.receipt_number ILIKE $${values.length}`);
  }
  if (options.storeId) {
    values.push(options.storeId);
    clauses.push(`sale.store_id=$${values.length}`);
  }
  if (options.terminalId) {
    values.push(options.terminalId);
    clauses.push(`sale.terminal_id=$${values.length}`);
  }
  if (options.cashierId) {
    values.push(options.cashierId);
    clauses.push(`sale.created_by=$${values.length}`);
  }
  if (options.shiftId) {
    values.push(options.shiftId);
    clauses.push(`sale.shift_id=$${values.length}`);
  }
  if (options.customerId) {
    values.push(options.customerId);
    clauses.push(`sale.customer_id=$${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    clauses.push(`sale.status=$${values.length}`);
  }
  if (options.dateFrom) {
    values.push(options.dateFrom);
    clauses.push(`sale.sale_date >= $${values.length}`);
  }
  if (options.dateTo) {
    values.push(options.dateTo);
    clauses.push(`sale.sale_date <= $${values.length}`);
  }
  if (options.paymentMethod) {
    values.push(options.paymentMethod);
    clauses.push(
      `EXISTS (SELECT 1 FROM tenant.pos_payments payment WHERE payment.organization_id=sale.organization_id AND payment.sale_id=sale.id AND payment.payment_method=$${values.length})`,
    );
  }

  // Same store-scoping convention as listPointOfSaleResource/
  // assertPosStoreAccess: permissive until an organization configures
  // tenant.pos_store_access, then a real row-level filter.
  const accessibleStoreIds = await accessiblePosStoreIds(client, context);
  if (accessibleStoreIds) {
    values.push(accessibleStoreIds);
    clauses.push(`sale.store_id=ANY($${values.length}::uuid[])`);
  }

  const whereSql = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const sortColumn = SORT_COLUMNS[options.sortBy] || SORT_COLUMNS.sale_date;
  const sortDir = options.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Number(options.limit) || 25, 100);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const countResult = await client.query(
    `SELECT count(*)::int AS count FROM tenant.pos_sales sale WHERE sale.organization_id=$1 AND sale.company_id=$2${whereSql}`,
    values,
  );

  const pagedValues = [...values, limit, offset];
  const result = await client.query(
    `SELECT sale.id, sale.receipt_number, sale.store_id, sale.terminal_id, sale.shift_id, sale.customer_id, sale.customer_name,
            sale.sale_date, sale.completed_at, sale.status, sale.currency_code, sale.grand_total, sale.tax_total, sale.discount_total,
            sale.accounting_posting_status, sale.created_by,
            store.name AS store_name, store.code AS store_code, terminal.name AS terminal_name, terminal.code AS terminal_code,
            cashier.full_name AS cashier_name
       FROM tenant.pos_sales sale
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=sale.organization_id AND terminal.id=sale.terminal_id
       LEFT JOIN public.users cashier ON cashier.id=sale.created_by
      WHERE sale.organization_id=$1 AND sale.company_id=$2${whereSql}
      ORDER BY ${sortColumn} ${sortDir}, sale.id DESC
      LIMIT $${pagedValues.length - 1} OFFSET $${pagedValues.length}`,
    pagedValues,
  );

  return { rows: result.rows, total: countResult.rows[0].count };
}

// The transaction detail: sale identity, every line, every payment leg
// (with its real provider/settlement status), return/refund history,
// accounting posting status (already columns on pos_sales — never
// recomputed), the stock movement each line produced, and this sale's own
// audit trail. Every field here is read from an already-persisted,
// already-authoritative row; the screen built on this must never compute a
// total client-side.
export async function getPosTransactionDetail(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT sale.*, store.name AS store_name, store.code AS store_code, terminal.name AS terminal_name, terminal.code AS terminal_code,
            shift.shift_number, shift.opened_at AS shift_opened_at, shift.closed_at AS shift_closed_at, shift.cashier_user_id,
            party.display_name AS customer_display_name, party.phone AS customer_phone, party.email AS customer_email,
            cashier.full_name AS cashier_name, cashier.email AS cashier_email
       FROM tenant.pos_sales sale
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=sale.organization_id AND terminal.id=sale.terminal_id
       JOIN tenant.pos_shifts shift ON shift.organization_id=sale.organization_id AND shift.id=sale.shift_id
       LEFT JOIN tenant.business_parties party ON party.organization_id=sale.organization_id AND party.id=sale.customer_id
       LEFT JOIN public.users cashier ON cashier.id=sale.created_by
      WHERE sale.organization_id=$1 AND sale.company_id=$2 AND sale.id=$3`,
    [context.organizationId, context.companyId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  // Enforced server-side, not just hidden in the UI: a user only assigned
  // to other stores gets a real 403 here, the same guard every other POS
  // detail read (receipts, invoices, accounting posting) already applies.
  await assertPosStoreAccess(client, context, sale.store_id);

  const lines = await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name
       FROM tenant.pos_sale_lines line
       LEFT JOIN tenant.items item ON item.organization_id=line.organization_id AND item.id=line.item_id
      WHERE line.organization_id=$1 AND line.sale_id=$2
      ORDER BY line.line_number`,
    [context.organizationId, saleId],
  );

  const payments = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 ORDER BY captured_at NULLS LAST, id`,
    [context.organizationId, saleId],
  );

  const returns = await client.query(
    `SELECT id, return_number, status, reason, refund_total, requested_by, approved_by, completed_by, created_at, approved_at, completed_at
       FROM tenant.pos_returns WHERE organization_id=$1 AND sale_id=$2
      ORDER BY created_at`,
    [context.organizationId, saleId],
  );

  const promotions = await client.query(
    `SELECT application.discount_amount, promotion.code, promotion.name
       FROM tenant.pos_promotion_applications application
       JOIN tenant.pos_promotions promotion ON promotion.organization_id=application.organization_id AND promotion.id=application.promotion_id
      WHERE application.organization_id=$1 AND application.sale_id=$2`,
    [context.organizationId, saleId],
  );

  const stockMovements = await client.query(
    `SELECT movement.id, movement.movement_number, movement.movement_type, movement.quantity, movement.unit_cost,
            movement.warehouse_id, movement.occurred_at, line.id AS sale_line_id, line.item_id, line.description
       FROM tenant.pos_sale_lines line
       JOIN tenant.stock_movements movement ON movement.organization_id=line.organization_id AND movement.id=line.stock_movement_id
      WHERE line.organization_id=$1 AND line.sale_id=$2
      ORDER BY movement.occurred_at`,
    [context.organizationId, saleId],
  );

  const auditTrail = await client.query(
    `SELECT event.id, event.event_type, event.payload, event.occurred_at, actor.full_name AS actor_name
       FROM tenant.pos_events event
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id=$1 AND event.company_id=$2
        AND ((event.aggregate_type IN ('sale','pos_sale') AND event.aggregate_id=$3)
          OR (event.aggregate_type='payment'
              AND event.aggregate_id IN (SELECT id FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$3)))
      ORDER BY event.occurred_at DESC`,
    [context.organizationId, context.companyId, saleId],
  );

  return {
    sale,
    lines: lines.rows,
    payments: payments.rows,
    returns: returns.rows,
    promotionEvidence: promotions.rows,
    stockMovements: stockMovements.rows,
    auditTrail: auditTrail.rows,
  };
}
