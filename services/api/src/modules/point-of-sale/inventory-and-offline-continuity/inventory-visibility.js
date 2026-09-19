// F294/F296 (POS-CAP-006) -- read-only POS visibility into Stock's own
// source-of-truth tables. POS never becomes a private source of truth for
// stock balances/valuation (see this capability's F294/F296 dossiers'
// [SPEC-INTENT] non-goal), so nothing here ever writes tenant.stock_balances
// or tenant.stock_movements -- every write still goes exclusively through
// Stock's own postStockMovement (see sale-completion.js/return-lifecycle.js,
// which already call it as postCanonicalStockMovement). This module only
// reads those same tables, scoped to a POS store's mapped warehouse, the
// same way Stock's own getStockDashboard/listStockResource read them for
// Stock's own screens.
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { posError } from "../shared/errors.js";

async function resolveStoreWarehouse(client, context, storeId) {
  requirePermission(context, "pos.view");
  if (!storeId) throw posError(400, "A store is required.", "POS_STORE_REQUIRED");
  await assertPosStoreAccess(client, context, storeId);
  const store = await client.query(
    `SELECT id, code, name, warehouse_id FROM tenant.pos_stores WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, storeId],
  );
  if (!store.rows[0]) throw posError(404, "POS store was not found.", "POS_STORE_NOT_FOUND");
  return store.rows[0];
}

// F296: per-item store availability, including lot/batch (F295) dimension
// and a real quality-hold indicator (the same hold concept
// postStockMovement's own assertQualityAllowsDecrease enforces at
// checkout) -- not a synthetic "in stock / out of stock" flag.
export async function listPosStoreInventory(client, context, { storeId, search = null, limit = 50, offset = 0 } = {}) {
  const store = await resolveStoreWarehouse(client, context, storeId);
  requirePermission(context, "stock.view");
  const values = [context.organizationId, context.companyId, store.warehouse_id];
  let filter = "";
  const trimmed = search ? String(search).trim() : "";
  if (trimmed) {
    values.push(`%${trimmed}%`);
    filter = ` AND (i.name ILIKE $${values.length} OR i.code ILIKE $${values.length} OR i.barcode ILIKE $${values.length})`;
  }
  values.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT b.item_id, i.code AS item_code, i.name AS item_name, i.barcode, i.tracking_type,
            b.warehouse_location_id, wl.code AS location_code, b.batch_id, bt.batch_number, bt.expires_on,
            b.quantity::text AS on_hand_quantity,
            b.reserved_quantity::text AS reserved_quantity,
            (b.quantity - b.reserved_quantity)::text AS available_quantity,
            b.updated_at,
            EXISTS (
              SELECT 1 FROM tenant.quality_holds qh
              WHERE qh.organization_id = b.organization_id AND qh.company_id = b.company_id
                AND qh.item_id = b.item_id AND qh.status = 'active'
                AND qh.hold_type IN ('inventory','batch','serial')
                AND (qh.warehouse_id IS NULL OR qh.warehouse_id = b.warehouse_id)
            ) AS quality_held
       FROM tenant.stock_balances b
       JOIN tenant.items i ON i.organization_id = b.organization_id AND i.id = b.item_id
       LEFT JOIN tenant.warehouse_locations wl ON wl.organization_id = b.organization_id AND wl.id = b.warehouse_location_id
       LEFT JOIN tenant.stock_batches bt ON bt.organization_id = b.organization_id AND bt.id = b.batch_id
      WHERE b.organization_id = $1 AND b.company_id = $2 AND b.warehouse_id = $3${filter}
      ORDER BY i.name, wl.code NULLS FIRST
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { store, rows: result.rows };
}

// F294/F296: the real-time feed of stock movements Stock's own ledger
// recorded as a DIRECT, atomic consequence of a completed POS sale or
// return at this store (reference_type/reference_id set by
// sale-completion.js/return-lifecycle.js when they call
// postCanonicalStockMovement) -- never a POS-maintained duplicate log.
// Scoped by warehouse_id (the store's own mapped warehouse) so a transfer
// or manufacturing movement that happens to touch the same warehouse from
// a different origin module never appears here as if POS caused it.
export async function listPosStoreStockActivity(client, context, { storeId, limit = 50, offset = 0 } = {}) {
  const store = await resolveStoreWarehouse(client, context, storeId);
  requirePermission(context, "stock.view");
  const values = [context.organizationId, context.companyId, store.warehouse_id, Math.min(Number(limit) || 50, 200), Number(offset) || 0];
  const result = await client.query(
    `SELECT m.id, m.movement_number, m.movement_type, m.item_id, i.code AS item_code, i.name AS item_name,
            m.quantity::text AS quantity, m.unit_cost::text AS unit_cost, m.reference_type, m.reference_id, m.occurred_at,
            s.id AS sale_id, s.receipt_number AS sale_receipt_number,
            r.id AS return_id, r.return_number
       FROM tenant.stock_movements m
       JOIN tenant.items i ON i.organization_id = m.organization_id AND i.id = m.item_id
       LEFT JOIN tenant.pos_sales s ON m.reference_type = 'pos_sale' AND s.organization_id = m.organization_id AND s.id = m.reference_id
       LEFT JOIN tenant.pos_returns r ON m.reference_type = 'pos_return' AND r.organization_id = m.organization_id AND r.id = m.reference_id
      WHERE m.organization_id = $1 AND m.company_id = $2 AND m.warehouse_id = $3
        AND m.reference_type IN ('pos_sale','pos_return')
      ORDER BY m.occurred_at DESC, m.id DESC
      LIMIT $4 OFFSET $5`,
    values,
  );
  return { store, rows: result.rows };
}
