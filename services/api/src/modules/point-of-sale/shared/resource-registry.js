import { requirePermission, accessiblePosStoreIds, accessiblePosTerminalIds } from "./access-control.js";

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
// the same "permissive until configured" convention. pos_payments gained a
// real store_id column in migration 120 (F283-F286) and pos_reconciliations
// gained one in migration 127 (F304), closing the gap this comment used to
// describe for both. pos_cash_movements still has no store_id column of
// its own (only shift_id) -- filtered via a shift_id subquery below instead
// of a table-level column, since a join would require touching this
// function's `SELECT *` shape for every other resource too.
const STORE_SCOPED_TABLES = Object.freeze({
  pos_stores: "id",
  pos_terminals: "store_id",
  pos_shifts: "store_id",
  pos_sales: "store_id",
  pos_returns: "store_id",
  pos_payments: "store_id",
  pos_reconciliations: "store_id",
});

// Shifts/cash-movements history workspaces (F301/F300 UI) need real
// narrowing beyond the blanket store-access intersection above -- a
// specific store/terminal/cashier/status/date-range the caller asked for,
// on top of (never instead of) the access-control filtering. Kept as
// explicit, additive AND-clauses so every existing caller that never
// passes these keeps today's exact query shape and result set.
// `withTotal` is opt-in and changes the return shape from a bare array to
// `{ rows, total }` -- every pre-existing call site (stores/terminals/
// sales/returns/... admin screens, both integration test suites) never
// passes it and keeps getting a bare array back unchanged. Only the new
// shift-history/cash-movement-history workspaces ask for a total, since
// only they paginate server-side.
export async function listPointOfSaleResource(
  client,
  context,
  resource,
  {
    limit = 100,
    offset = 0,
    shiftId = null,
    customerId = null,
    storeId = null,
    terminalId = null,
    status = null,
    cashierUserId = null,
    movementType = null,
    dateFrom = null,
    dateTo = null,
    withTotal = false,
  } = {},
) {
  requirePermission(context, "pos.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (shiftId && ["pos_sales", "pos_payments", "pos_cash_movements", "pos_reconciliations"].includes(target)) {
    values.push(shiftId);
    filter += ` AND shift_id=$${values.length}`;
  }
  // POS-scoped "purchase history" for a customer (the Customers workspace) --
  // pos_returns has no customer_id column of its own (only reachable by
  // joining back to its sale), so this only applies to pos_sales.
  if (customerId && target === "pos_sales") {
    values.push(customerId);
    filter += ` AND customer_id=$${values.length}`;
  }
  const storeColumn = STORE_SCOPED_TABLES[target];
  if (storeColumn) {
    const accessibleStoreIds = await accessiblePosStoreIds(client, context);
    if (accessibleStoreIds) {
      values.push(accessibleStoreIds);
      filter += ` AND ${storeColumn}=ANY($${values.length}::uuid[])`;
    }
    // F270/F271: a further narrowing on top of store-level access -- only
    // meaningful (non-null) once this user holds at least one
    // terminal-specific grant somewhere; otherwise every terminal in an
    // accessible store is visible, the pre-existing behavior.
    if (target === "pos_terminals") {
      const accessibleTerminalIds = await accessiblePosTerminalIds(client, context);
      if (accessibleTerminalIds) {
        values.push(accessibleTerminalIds);
        filter += ` AND id=ANY($${values.length}::uuid[])`;
      }
    }
    if (storeId) {
      values.push(storeId);
      filter += ` AND ${storeColumn}=$${values.length}`;
    }
  } else if (target === "pos_cash_movements") {
    const accessibleStoreIds = await accessiblePosStoreIds(client, context);
    const shiftConds = ["organization_id=$1"];
    if (accessibleStoreIds) {
      values.push(accessibleStoreIds);
      shiftConds.push(`store_id=ANY($${values.length}::uuid[])`);
    }
    if (storeId) {
      values.push(storeId);
      shiftConds.push(`store_id=$${values.length}`);
    }
    if (terminalId) {
      values.push(terminalId);
      shiftConds.push(`terminal_id=$${values.length}`);
    }
    if (shiftConds.length > 1) {
      filter += ` AND shift_id IN (SELECT id FROM tenant.pos_shifts WHERE ${shiftConds.join(" AND ")})`;
    }
  }
  if (target === "pos_shifts") {
    if (terminalId) {
      values.push(terminalId);
      filter += ` AND terminal_id=$${values.length}`;
    }
    if (status) {
      values.push(status);
      filter += ` AND status=$${values.length}`;
    }
    if (cashierUserId) {
      values.push(cashierUserId);
      filter += ` AND cashier_user_id=$${values.length}`;
    }
    if (dateFrom) {
      values.push(dateFrom);
      filter += ` AND opened_at>=$${values.length}`;
    }
    if (dateTo) {
      values.push(dateTo);
      filter += ` AND opened_at<$${values.length}::date + interval '1 day'`;
    }
  }
  if (target === "pos_cash_movements") {
    if (movementType) {
      values.push(movementType);
      filter += ` AND movement_type=$${values.length}`;
    }
    if (cashierUserId) {
      values.push(cashierUserId);
      filter += ` AND created_by=$${values.length}`;
    }
    if (dateFrom) {
      values.push(dateFrom);
      filter += ` AND created_at>=$${values.length}`;
    }
    if (dateTo) {
      values.push(dateTo);
      filter += ` AND created_at<$${values.length}::date + interval '1 day'`;
    }
  }
  let total;
  if (withTotal) {
    const countResult = await client.query(`SELECT count(*)::int AS total FROM tenant.${target} WHERE organization_id=$1 AND company_id=$2${filter}`, values);
    total = countResult.rows[0]?.total ?? 0;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT * FROM tenant.${target}
     WHERE organization_id=$1 AND company_id=$2${filter}
     ORDER BY created_at DESC NULLS LAST,id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return withTotal ? { rows: result.rows, total } : result.rows;
}
