// F289 -- receipt generation. Deterministic evidence built ONLY from
// already-persisted, immutable sale facts (tenant.pos_sales/
// pos_sale_lines/pos_payments/pos_returns) -- nothing here is computed
// fresh or trusted from a client; it is a read of what completePosCart
// already committed. getPosSaleReceipt itself has no side effects and can
// be called any number of times safely; recordPosReceiptPrintAttempt
// (below) is the actual audited action, backed by
// tenant.pos_receipt_print_events (migration 129) rather than the
// previous client-supplied `?original=1` URL parameter, which any viewer
// could set regardless of real print history.
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

export async function getPosSaleReceipt(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT sale.*, store.name AS store_name, store.timezone AS store_timezone, terminal.name AS terminal_name,
            party.display_name AS customer_display_name, cashier.full_name AS cashier_name
       FROM tenant.pos_sales sale
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=sale.organization_id AND terminal.id=sale.terminal_id
       LEFT JOIN tenant.business_parties party ON party.organization_id=sale.organization_id AND party.id=sale.customer_id
       LEFT JOIN public.users cashier ON cashier.id=sale.created_by
      WHERE sale.organization_id=$1 AND sale.company_id=$2 AND sale.id=$3`,
    [context.organizationId, context.companyId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const lines = await client.query(`SELECT * FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2 ORDER BY line_number`, [
    context.organizationId,
    saleId,
  ]);
  const payments = await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 ORDER BY captured_at`, [
    context.organizationId,
    saleId,
  ]);
  const returns = await client.query(
    `SELECT id,return_number,status,refund_total,created_at,completed_at FROM tenant.pos_returns WHERE organization_id=$1 AND sale_id=$2 ORDER BY created_at`,
    [context.organizationId, saleId],
  );
  const promotions = await client.query(
    `SELECT application.discount_amount, promotion.code, promotion.name
       FROM tenant.pos_promotion_applications application
       JOIN tenant.pos_promotions promotion ON promotion.organization_id=application.organization_id AND promotion.id=application.promotion_id
      WHERE application.organization_id=$1 AND application.sale_id=$2`,
    [context.organizationId, saleId],
  );
  const printEvents = await client.query(
    `SELECT print_event.id, print_event.print_type, print_event.requested_at, printer.full_name AS requested_by_name
       FROM tenant.pos_receipt_print_events print_event
       LEFT JOIN public.users printer ON printer.id = print_event.requested_by
      WHERE print_event.organization_id=$1 AND print_event.company_id=$2 AND print_event.sale_id=$3
      ORDER BY print_event.requested_at DESC`,
    [context.organizationId, context.companyId, saleId],
  );

  return {
    sale,
    lines: lines.rows,
    payments: payments.rows,
    returns: returns.rows,
    promotionEvidence: promotions.rows,
    printEvents: printEvents.rows,
  };
}

// F289 gap closure: records that a print was REQUESTED for this sale's
// receipt. print_type is derived server-side (never from client input) --
// the first ever recorded attempt for a sale is 'original', every
// subsequent one is 'reprint'. This can only ever claim the print DIALOG
// was invoked by an authenticated, store-access-checked user at a known
// time -- never that physical paper came out, which nothing in a browser
// can observe. Rows are immutable (migration 129's trigger) -- correcting
// a mistake means nothing here, since a print request is simply a fact
// that did or didn't happen.
export async function recordPosReceiptPrintAttempt(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT id, store_id FROM tenant.pos_sales WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const priorCount = await client.query(
    `SELECT count(*)::int AS count FROM tenant.pos_receipt_print_events WHERE organization_id=$1 AND company_id=$2 AND sale_id=$3`,
    [context.organizationId, context.companyId, saleId],
  );
  const printType = Number(priorCount.rows[0].count) === 0 ? "original" : "reprint";

  const result = await client.query(
    `INSERT INTO tenant.pos_receipt_print_events (organization_id,company_id,sale_id,print_type,requested_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [context.organizationId, context.companyId, saleId, printType, context.userId],
  );
  const response = result.rows[0];
  await event(client, context, "pos_sale", saleId, "pos.receipt.print_requested", { printType });
  return response;
}

export async function listPosReceiptPrintEvents(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT id, store_id FROM tenant.pos_sales WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const result = await client.query(
    `SELECT print_event.id, print_event.print_type, print_event.requested_at, printer.full_name AS requested_by_name
       FROM tenant.pos_receipt_print_events print_event
       LEFT JOIN public.users printer ON printer.id = print_event.requested_by
      WHERE print_event.organization_id=$1 AND print_event.company_id=$2 AND print_event.sale_id=$3
      ORDER BY print_event.requested_at DESC`,
    [context.organizationId, context.companyId, saleId],
  );
  return result.rows;
}
