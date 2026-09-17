// F291/F292 -- "find the original transaction" step of the returns UI.
// createPointOfSaleReturn/approvePointOfSaleReturn/completePointOfSaleReturn
// (services/api/src/modules/point-of-sale/index.js) already own the real
// return lifecycle; this is the one missing piece -- looking a sale up by
// its receipt number and reporting exactly how much of each line is still
// returnable, using the SAME eligibility rule (status IN ('completed',
// 'partially_returned')) and remaining-quantity math
// (quantity - returned_quantity) createPointOfSaleReturn itself already
// enforces, so the UI can never show a quantity the backend would reject.
import { decimal, sub, asDatabaseDecimal } from "../../../core/decimal.js";
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

export async function findPosSaleForReturn(client, context, { receiptNumber }) {
  requirePermission(context, "pos.return.create");
  const normalized = String(receiptNumber || "").trim();
  if (!normalized) throw posError(400, "A receipt number is required.", "POS_RETURN_RECEIPT_REQUIRED");
  const saleResult = await client.query(
    `SELECT * FROM tenant.pos_sales
      WHERE organization_id=$1 AND company_id=$2 AND receipt_number=$3 AND status IN ('completed','partially_returned')`,
    [context.organizationId, context.companyId, normalized],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "No eligible sale found for that receipt number.", "POS_RETURN_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const lines = await client.query(`SELECT * FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2 ORDER BY line_number`, [
    context.organizationId,
    sale.id,
  ]);
  return {
    sale,
    lines: lines.rows.map((line) => ({
      ...line,
      remaining_quantity: asDatabaseDecimal(sub(decimal(line.quantity), decimal(line.returned_quantity || 0))),
    })),
  };
}
