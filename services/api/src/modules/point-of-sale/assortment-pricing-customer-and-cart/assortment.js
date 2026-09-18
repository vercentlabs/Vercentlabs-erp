import { requireCompanyRecord } from "../../../core/references.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";

// POS-CAP-002 (F272-F281): assortment, pricing, customer and cart.
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_TERM_LENGTH = 100;

// F272: bounded product search by name/code/barcode, across both plain
// items and item variants, scoped to the active store's company and
// excluding cost fields entirely (no cost leakage to ordinary cashiers —
// standard_cost/purchase_price are never selected here, regardless of the
// caller's permissions; a cashier does not need margin visibility to ring
// up a sale).
export async function searchPointOfSalePosProducts(client, context, storeId, input = {}) {
  requirePermission(context, "pos.view");
  const store = await requireCompanyRecord(client, context, "pos_store", storeId);
  await assertPosStoreAccess(client, context, store.id);
  const term = String(input.query || "").trim().slice(0, MAX_SEARCH_TERM_LENGTH);
  if (!term) throw posError(400, "A search term is required.", "POS_SEARCH_TERM_REQUIRED");
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), MAX_SEARCH_RESULTS);
  const like = `%${term.toLowerCase()}%`;

  const result = await client.query(
    `(SELECT
        item.id AS item_id, NULL::uuid AS variant_id,
        item.name, item.code, item.barcode,
        item.sales_price, item.uom_id, item.tracking_type
      FROM tenant.items item
      WHERE item.organization_id=$1 AND (item.company_id IS NULL OR item.company_id=$2)
        AND item.status='active'
        AND (lower(item.name) LIKE $3 OR lower(item.code) LIKE $3 OR item.barcode=$4)
      LIMIT $5)
     UNION ALL
     (SELECT
        variant.item_id, variant.id AS variant_id,
        variant.name, variant.sku AS code, variant.barcode,
        coalesce(variant.sales_price, item.sales_price), item.uom_id, item.tracking_type
      FROM tenant.item_variants variant
      JOIN tenant.items item
        ON item.organization_id=variant.organization_id AND item.id=variant.item_id
      WHERE variant.organization_id=$1 AND (variant.company_id IS NULL OR variant.company_id=$2)
        AND variant.status='active' AND item.status='active'
        AND (lower(variant.name) LIKE $3 OR lower(variant.sku) LIKE $3 OR variant.barcode=$4)
      LIMIT $5)
     LIMIT $5`,
    [context.organizationId, context.companyId, like, term, limit],
  );

  const itemIds = [...new Set(result.rows.map((row) => row.item_id))];
  const availability = itemIds.length
    ? await client.query(
        `SELECT item_id,coalesce(sum(quantity-reserved_quantity),0)::text AS available
         FROM tenant.stock_balances
         WHERE organization_id=$1 AND company_id=$2 AND warehouse_id=$3 AND item_id=ANY($4::uuid[])
         GROUP BY item_id`,
        [context.organizationId, context.companyId, store.warehouse_id, itemIds],
      )
    : { rows: [] };
  const availableByItem = new Map(availability.rows.map((row) => [row.item_id, Number(row.available)]));

  return result.rows.map((row) => ({
    itemId: row.item_id,
    variantId: row.variant_id,
    name: row.name,
    code: row.code,
    barcode: row.barcode,
    salesPrice: row.sales_price,
    trackingType: row.tracking_type || "none",
    availableQuantity: availableByItem.get(row.item_id) ?? 0,
  }));
}

// F273: exact barcode lookup for keyboard-wedge scanner input (the
// dossier's first-class path) — a scanner emits the barcode followed by
// an Enter keystroke, so this is a single exact-match lookup, not a
// substring search. Manual search (searchPointOfSalePosProducts above)
// remains the fallback the dossier requires for unknown/unreadable
// barcodes, damaged labels, or a cashier simply typing an item's name.
export async function lookupPointOfSaleBarcode(client, context, storeId, barcode) {
  requirePermission(context, "pos.view");
  const store = await requireCompanyRecord(client, context, "pos_store", storeId);
  await assertPosStoreAccess(client, context, store.id);
  const normalized = String(barcode || "").trim();
  if (!normalized) throw posError(400, "A barcode is required.", "POS_BARCODE_REQUIRED");

  const itemMatch = await client.query(
    `SELECT id AS item_id, NULL::uuid AS variant_id, name, code, barcode, sales_price, uom_id, tracking_type
     FROM tenant.items
     WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2)
       AND status='active' AND barcode=$3
     LIMIT 1`,
    [context.organizationId, context.companyId, normalized],
  );
  const row =
    itemMatch.rows[0] ||
    (
      await client.query(
        `SELECT variant.item_id, variant.id AS variant_id, variant.name, variant.sku AS code,
                variant.barcode, coalesce(variant.sales_price, item.sales_price) AS sales_price, item.uom_id,
                item.tracking_type
         FROM tenant.item_variants variant
         JOIN tenant.items item ON item.organization_id=variant.organization_id AND item.id=variant.item_id
         WHERE variant.organization_id=$1 AND (variant.company_id IS NULL OR variant.company_id=$2)
           AND variant.status='active' AND item.status='active' AND variant.barcode=$3
         LIMIT 1`,
        [context.organizationId, context.companyId, normalized],
      )
    ).rows[0];

  if (!row) throw posError(404, "No product matches this barcode.", "POS_BARCODE_NOT_FOUND");

  const available = await client.query(
    `SELECT coalesce(sum(quantity-reserved_quantity),0)::text AS available
     FROM tenant.stock_balances
     WHERE organization_id=$1 AND company_id=$2 AND warehouse_id=$3 AND item_id=$4`,
    [context.organizationId, context.companyId, store.warehouse_id, row.item_id],
  );

  return {
    itemId: row.item_id,
    variantId: row.variant_id,
    name: row.name,
    code: row.code,
    barcode: row.barcode,
    salesPrice: row.sales_price,
    trackingType: row.tracking_type || "none",
    availableQuantity: Number(available.rows[0]?.available ?? 0),
  };
}
