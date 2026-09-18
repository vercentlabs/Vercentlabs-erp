import { requirePermission, accessiblePosStoreIds } from "./access-control.js";

// Generic multi-resource listing (admin/reporting screens that list raw
// store/terminal/shift/sale/... rows). This is genuinely cross-cutting --
// it has no single POS-CAP-00x owner, the same way CRM's own equivalent
// (listCrmRecords/getCrmRecord) lives in a dedicated "data operations"
// capability rather than inside any one CRM business-object folder.
const TABLES = Object.freeze({
  stores: "pos_stores",
  terminals: "pos_terminals",
  shifts: "pos_shifts",
  sales: "pos_sales",
  payments: "pos_payments",
  returns: "pos_returns",
  "cash-movements": "pos_cash_movements",
  reconciliations: "pos_reconciliations",
});

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported POS resource.");
  return value;
}

// Phase 2 (F268-F273): tables that carry a store_id (or, for 'pos_stores'
// itself, are keyed by store id directly) get row-filtered to the caller's
// assigned stores once an organization has opted into pos_store_access --
// see accessiblePosStoreIds's doc comment in shared/access-control.js for
// the same "permissive until configured" convention. pos_payments/
// pos_cash_movements/pos_reconciliations have no store_id column (only
// shift_id) and are NOT yet filtered here -- a disclosed remaining gap,
// not an oversight: doing so would need a join through pos_shifts, which
// the loop below does not attempt.
const STORE_SCOPED_TABLES = Object.freeze({
  pos_stores: "id",
  pos_terminals: "store_id",
  pos_shifts: "store_id",
  pos_sales: "store_id",
  pos_returns: "store_id",
});

export async function listPointOfSaleResource(client, context, resource, { limit = 100, offset = 0, shiftId = null } = {}) {
  requirePermission(context, "pos.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (shiftId && ["pos_sales", "pos_payments", "pos_cash_movements", "pos_reconciliations"].includes(target)) {
    values.push(shiftId);
    filter = ` AND shift_id=$${values.length}`;
  }
  const storeColumn = STORE_SCOPED_TABLES[target];
  if (storeColumn) {
    const accessibleStoreIds = await accessiblePosStoreIds(client, context);
    if (accessibleStoreIds) {
      values.push(accessibleStoreIds);
      filter += ` AND ${storeColumn}=ANY($${values.length}::uuid[])`;
    }
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT * FROM tenant.${target}
     WHERE organization_id=$1 AND company_id=$2${filter}
     ORDER BY created_at DESC NULLS LAST,id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}
