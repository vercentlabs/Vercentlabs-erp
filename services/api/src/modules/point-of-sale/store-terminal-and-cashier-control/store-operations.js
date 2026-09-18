import { requireCompanyRecord } from "../../../core/references.js";
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";

// F268 admin UI: dropdown data for the store create/edit form. Read-only,
// bounded to this org/company, reusing the same authoritative tables
// (public.branches, tenant.warehouses, tenant.price_lists) other modules
// already own -- not a parallel picker source of truth.
export async function listPosStoreSetupOptions(client, context) {
  requirePermission(context, "pos.store.manage");
  const [branches, warehouses, priceLists] = await Promise.all([
    client.query(`SELECT id,name,code FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY name`, [context.organizationId, context.companyId]),
    client.query(`SELECT id,name,code FROM tenant.warehouses WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY name`, [
      context.organizationId,
      context.companyId,
    ]),
    client.query(`SELECT id,name,code,currency_code FROM tenant.price_lists WHERE organization_id=$1 AND status='active' ORDER BY name`, [context.organizationId]),
  ]);
  return { branches: branches.rows, warehouses: warehouses.rows, priceLists: priceLists.rows };
}

export async function createStore(client, context, input) {
  requirePermission(context, "pos.store.manage");
  await requireCompanyRecord(client, context, "branch", input.branchId);
  await requireCompanyRecord(client, context, "warehouse", input.warehouseId);
  const result = await client.query(
    `INSERT INTO tenant.pos_stores
      (organization_id,company_id,branch_id,code,name,warehouse_id,
       price_list_id,currency_code,timezone,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId,
      input.code,
      input.name,
      input.warehouseId,
      input.priceListId || null,
      input.currencyCode || "INR",
      input.timezone || "Asia/Kolkata",
      context.userId,
    ],
  );
  return result.rows[0];
}

// F268: an edit that touches warehouse_id/currency_code is structural --
// it changes which warehouse stock decrements against and what currency
// every future sale is denominated in. Blocked while any shift is open on
// the store, so it can never happen mid-transaction; descriptive fields
// (name/branch/price list/timezone) are always safe to edit.
export async function updatePosStore(client, context, id, input) {
  requirePermission(context, "pos.store.manage");
  const fields = [];
  const values = [context.organizationId, context.companyId, id];
  function set(column, value) {
    values.push(value);
    fields.push(`${column}=$${values.length}`);
  }
  if (input.name != null) set("name", String(input.name).trim());
  if (input.branchId != null) {
    await requireCompanyRecord(client, context, "branch", input.branchId);
    set("branch_id", input.branchId);
  }
  if (input.priceListId !== undefined) set("price_list_id", input.priceListId || null);
  if (input.timezone != null) set("timezone", input.timezone);
  if (input.warehouseId != null || input.currencyCode != null) {
    const openShift = await client.query(
      `SELECT 1 FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND store_id=$3 AND status='open' LIMIT 1`,
      [context.organizationId, context.companyId, id],
    );
    if (openShift.rows[0]) throw posError(409, "Cannot change warehouse or currency while a shift is open on this store.", "POS_STORE_UNSAFE_TRANSITION");
    if (input.warehouseId != null) {
      await requireCompanyRecord(client, context, "warehouse", input.warehouseId);
      set("warehouse_id", input.warehouseId);
    }
    if (input.currencyCode != null) set("currency_code", input.currencyCode);
  }
  if (!fields.length) throw posError(400, "No fields to update.", "POS_STORE_UPDATE_EMPTY");
  fields.push("updated_at=now()");
  const result = await client.query(
    `UPDATE tenant.pos_stores SET ${fields.join(",")} WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw posError(404, "POS store was not found.", "POS_STORE_NOT_FOUND");
  return result.rows[0];
}

// F268: a store cannot be deactivated while it has an open shift or a
// live (draft/priced/held) cart -- those must be closed/completed/
// cancelled first, never silently orphaned by flipping a flag underneath
// them.
export async function setPosStoreActive(client, context, id, active) {
  requirePermission(context, "pos.store.manage");
  if (!active) {
    const openShift = await client.query(
      `SELECT 1 FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND store_id=$3 AND status='open' LIMIT 1`,
      [context.organizationId, context.companyId, id],
    );
    if (openShift.rows[0]) throw posError(409, "Cannot deactivate a store with an open shift.", "POS_STORE_HAS_OPEN_SHIFT");
    const activeCart = await client.query(
      `SELECT 1 FROM tenant.pos_carts WHERE organization_id=$1 AND company_id=$2 AND store_id=$3 AND status IN ('draft','priced','held') LIMIT 1`,
      [context.organizationId, context.companyId, id],
    );
    if (activeCart.rows[0]) throw posError(409, "Cannot deactivate a store with an active or held cart.", "POS_STORE_HAS_ACTIVE_CART");
  }
  const result = await client.query(`UPDATE tenant.pos_stores SET active=$4,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [
    context.organizationId,
    context.companyId,
    id,
    Boolean(active),
  ]);
  if (!result.rows[0]) throw posError(404, "POS store was not found.", "POS_STORE_NOT_FOUND");
  return result.rows[0];
}
