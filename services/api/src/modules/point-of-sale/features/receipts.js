// F289 -- receipt generation. Deterministic evidence built ONLY from
// already-persisted, immutable sale facts (tenant.pos_sales/
// pos_sale_lines/pos_payments/pos_returns) -- nothing here is computed
// fresh or trusted from a client; it is a read of what completePosCart
// already committed. "Original" vs "reprint" is derived from whether this
// is the first read after completion or not tracked at all here (a real
// print-audit-log would need its own table); this function itself has no
// side effects and can be called any number of times safely.
import { assertPosStoreAccess } from "./cart.js";

function posError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

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

  return {
    sale,
    lines: lines.rows,
    payments: payments.rows,
    returns: returns.rows,
    promotionEvidence: promotions.rows,
  };
}
