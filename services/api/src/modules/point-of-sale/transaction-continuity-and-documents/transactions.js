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
import { assertPosAction } from "../permissions/index.js";

const SORT_COLUMNS = Object.freeze({
  sale_date: "sale.sale_date",
  grand_total: "sale.grand_total",
  receipt_number: "sale.receipt_number",
  status: "sale.status",
});

export async function listPosTransactions(client, context, options = {}) {
  requirePermission(context, "pos.view");
  const administrator = context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
    || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage") || context.permissions?.includes("pos.reports.view");
  if (!administrator) await assertPosAction(client, context, { permission: "TRANSACTION_LOOKUP" });
  const values = [context.organizationId];
  const clauses = [];

  // Receipt Reprinting (0097): one search box takes a receipt / invoice number (exact first, then numbers starting with it — leading zeros
  // kept, it is text), a sale reference (the sale's id), or a scanned receipt code (POSR…). An amount alone never picks a sale: it only filters.
  let exactRank = null;
  const search = String(options.search ?? "").trim();
  if (search) {
    if (/^POSR[0-9A-F]{10}$/i.test(search)) {
      values.push(search.toUpperCase());
      clauses.push(`sale.id IN (SELECT CASE WHEN document.source_type = 'pos_sale' THEN document.source_id ELSE (SELECT ret.sale_id FROM tenant.pos_returns ret WHERE ret.organization_id = document.organization_id AND ret.id = document.source_id) END
        FROM tenant.pos_document_snapshots document WHERE document.organization_id = sale.organization_id AND document.lookup_reference = $${values.length})`);
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) {
      values.push(search.toLowerCase());
      clauses.push(`sale.id = $${values.length}::uuid`);
    } else {
      values.push(search);
      exactRank = values.length;
      values.push(`${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      clauses.push(`(sale.receipt_number = $${exactRank} OR sale.receipt_number LIKE $${values.length} OR sale.invoice_number = $${exactRank} OR sale.invoice_number LIKE $${values.length})`);
    }
  }
  if (options.amount !== undefined && options.amount !== null && options.amount !== "") {
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(String(options.amount))) throw posError(400, "Enter the amount as a number, e.g. 2500 or 2500.00.", "POS_TRANSACTION_AMOUNT_INVALID");
    values.push(String(options.amount));
    clauses.push(`sale.grand_total = $${values.length}::numeric`);
  }
  // Customer search: by name (starting with), customer code, or the last digits of a phone number — for people allowed to select customers.
  const customer = String(options.customer ?? "").trim();
  if (customer) {
    if (!administrator) await assertPosAction(client, context, { permission: "CUSTOMER_SELECT" });
    values.push(`${customer.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    const name = values.length;
    values.push(customer);
    const code = values.length;
    const digits = customer.replace(/\D/g, "");
    values.push(digits.length >= 4 ? `%${digits}` : null);
    const phone = values.length;
    clauses.push(`(lower(sale.buyer_name_snapshot) LIKE $${name} OR lower(sale.customer_name) LIKE $${name} OR sale.customer_code_snapshot = $${code}
      OR ($${phone}::text IS NOT NULL AND EXISTS (SELECT 1 FROM tenant.business_parties party WHERE party.organization_id = sale.organization_id AND party.id = sale.customer_id
        AND regexp_replace(COALESCE(party.phone, ''), '\\D', '', 'g') LIKE $${phone})))`);
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
  if (options.customerMode === "walk_in" || options.customerMode === "registered") {
    values.push(options.customerMode);
    clauses.push(`sale.customer_mode=$${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    clauses.push(`sale.status=$${values.length}`);
  }
  // Whole days: the sale date is a timestamp, so "to" includes all of that day.
  if (options.dateFrom) {
    values.push(options.dateFrom);
    clauses.push(`sale.sale_date >= $${values.length}::date`);
  }
  if (options.dateTo) {
    values.push(options.dateTo);
    clauses.push(`sale.sale_date < $${values.length}::date + 1`);
  }
  if (options.paymentMethod === "split") {
    clauses.push(`(SELECT count(DISTINCT payment.payment_method) FROM tenant.pos_payments payment WHERE payment.organization_id=sale.organization_id AND payment.sale_id=sale.id
      AND payment.status NOT IN ('failed', 'voided')) > 1`);
  } else if (options.paymentMethod) {
    values.push(options.paymentMethod);
    clauses.push(
      `EXISTS (SELECT 1 FROM tenant.pos_payments payment WHERE payment.organization_id=sale.organization_id AND payment.sale_id=sale.id AND payment.payment_method=$${values.length})`,
    );
  }

  // Only sales at the outlets the person works at (everywhere for outlet administrators).
  const accessibleStoreIds = await accessiblePosStoreIds(client, context);
  if (accessibleStoreIds) {
    values.push(accessibleStoreIds);
    clauses.push(`sale.store_id=ANY($${values.length}::uuid[])`);
  }

  const whereSql = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const sortColumn = SORT_COLUMNS[options.sortBy] || SORT_COLUMNS.sale_date;
  const sortDir = options.sortDir === "asc" ? "ASC" : "DESC";
  const rankSql = exactRank ? `(sale.receipt_number = $${exactRank} OR sale.invoice_number = $${exactRank}) DESC, ` : "";
  const limit = Math.min(Number(options.limit) || 25, 100);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const countResult = await client.query(
    `SELECT count(*)::int AS count FROM tenant.pos_sales sale WHERE sale.organization_id=$1${whereSql}`,
    values,
  );

  const pagedValues = [...values, limit, offset];
  const result = await client.query(
    `SELECT sale.id, sale.receipt_number, sale.store_id, sale.terminal_id, sale.shift_id, sale.customer_id, sale.customer_name, sale.customer_mode,
            sale.sale_date, sale.completed_at, sale.status, sale.currency_code, sale.grand_total, sale.tax_total, sale.discount_total,
            sale.accounting_posting_status, sale.created_by, sale.buyer_name_snapshot, sale.invoice_number, sale.tax_document_type,
            COALESCE(sale.buyer_name_snapshot, sale.customer_name, CASE WHEN sale.customer_mode = 'walk_in' THEN 'Walk-in customer' END) AS customer_display,
            CASE WHEN length(regexp_replace(COALESCE(party.phone, ''), '\\D', '', 'g')) >= 4 THEN '••••••' || right(regexp_replace(party.phone, '\\D', '', 'g'), 4) END AS customer_phone_masked,
            (SELECT array_agg(DISTINCT payment.payment_method ORDER BY payment.payment_method) FROM tenant.pos_payments payment
              WHERE payment.organization_id = sale.organization_id AND payment.sale_id = sale.id AND payment.status NOT IN ('failed', 'voided')) AS payment_methods,
            EXISTS (SELECT 1 FROM tenant.pos_document_snapshots document WHERE document.organization_id = sale.organization_id AND document.source_type = 'pos_sale'
              AND document.source_id = sale.id) AS receipt_issued,
            store.name AS store_name, store.code AS store_code, terminal.name AS terminal_name, terminal.code AS terminal_code,
            cashier.full_name AS cashier_name
       FROM tenant.pos_sales sale
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=sale.organization_id AND terminal.id=sale.terminal_id
       LEFT JOIN public.users cashier ON cashier.id=sale.created_by
       LEFT JOIN tenant.business_parties party ON party.organization_id=sale.organization_id AND party.id=sale.customer_id
      WHERE sale.organization_id=$1${whereSql}
      ORDER BY ${rankSql}${sortColumn} ${sortDir}, sale.id DESC
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
      WHERE sale.organization_id=$1 AND sale.id=$2`,
    [context.organizationId, saleId],
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
      WHERE event.organization_id=$1
        AND ((event.aggregate_type IN ('sale','pos_sale') AND event.aggregate_id=$2)
          OR (event.aggregate_type='payment'
              AND event.aggregate_id IN (SELECT id FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2)))
      ORDER BY event.occurred_at DESC`,
    [context.organizationId, saleId],
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
