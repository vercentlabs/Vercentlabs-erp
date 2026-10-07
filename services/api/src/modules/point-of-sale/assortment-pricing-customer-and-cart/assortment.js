import { requireOrganizationRecord } from "../../../core/references.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";

// POS-CAP-002 (F272-F281): assortment, pricing, customer and cart.
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_TERM_LENGTH = 100;

// The store's price list price for the item's base unit, valid today (what the cart will charge before customer rules), or null.
const STORE_PRICE = `(SELECT entry.rate FROM tenant.price_list_items entry WHERE entry.organization_id = item.organization_id AND entry.price_list_id = $PRICE_LIST
    AND entry.item_id = item.id AND entry.uom_id = item.uom_id AND entry.status = 'active' AND entry.minimum_quantity <= 1
    AND (entry.valid_from IS NULL OR entry.valid_from <= current_date) AND (entry.valid_to IS NULL OR entry.valid_to >= current_date)
  ORDER BY entry.valid_from DESC NULLS LAST LIMIT 1)`;

function toPosProduct(row, availableByItem) {
  return {
    itemId: row.item_id,
    name: row.name,
    code: row.code,
    barcode: row.barcode,
    salesPrice: row.sales_price === null || row.sales_price === undefined ? null : row.sales_price,
    trackingType: row.tracking_type || "none",
    availableQuantity: availableByItem.get(row.item_id) ?? 0,
  };
}

async function availableAt(client, context, warehouseId, itemIds) {
  if (!itemIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT item_id,coalesce(sum(quantity-reserved_quantity),0)::text AS available FROM tenant.stock_balances
      WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=ANY($3::uuid[]) GROUP BY item_id`,
    [context.organizationId, warehouseId, itemIds]);
  return new Map(rows.map((row) => [row.item_id, Number(row.available)]));
}

// F272: bounded product search by name, SKU or any barcode, scoped to the organization. Variants are items of their own and are found
// the same way; a variant template is never sold. Cost fields are never selected here (a cashier does not need margin visibility to
// ring up a sale); the price shown is the store's price list price.
export async function searchPointOfSalePosProducts(client, context, storeId, input = {}) {
  requirePermission(context, "pos.view");
  const store = await requireOrganizationRecord(client, context, "pos_store", storeId);
  await assertPosStoreAccess(client, context, store.id);
  const term = String(input.query || "").trim().slice(0, MAX_SEARCH_TERM_LENGTH);
  if (!term) throw posError(400, "A search term is required.", "POS_SEARCH_TERM_REQUIRED");
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), MAX_SEARCH_RESULTS);
  const like = `%${term.toLowerCase()}%`;
  const result = await client.query(
    `SELECT item.id AS item_id, item.name, item.code, item.barcode, item.uom_id, item.tracking_type, ${STORE_PRICE.replace("$PRICE_LIST", "$5")} AS sales_price
       FROM tenant.items item
      WHERE item.organization_id=$1 AND item.status='active' AND item.is_sellable
        AND (lower(item.name) LIKE $2 OR lower(item.code) LIKE $2
             OR EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id AND identifier.item_id = item.id
                         AND identifier.status = 'active' AND upper(identifier.value) = upper($3)))
      ORDER BY lower(item.name) LIMIT $4`,
    [context.organizationId, like, term, limit, store.price_list_id ?? null],
  );
  const availableByItem = await availableAt(client, context, store.warehouse_id, [...new Set(result.rows.map((row) => row.item_id))]);
  return result.rows.map((row) => toPosProduct(row, availableByItem));
}

// F273: exact barcode lookup for keyboard-wedge scanner input (the first-class path) — a scanner emits the barcode followed by an Enter
// keystroke, so this is a single exact-match lookup on the item's live identifiers (primary or alternate) or its SKU, not a substring
// search. Manual search (searchPointOfSalePosProducts above) remains the fallback for unknown or unreadable barcodes.
export async function lookupPointOfSaleBarcode(client, context, storeId, barcode) {
  requirePermission(context, "pos.view");
  const store = await requireOrganizationRecord(client, context, "pos_store", storeId);
  await assertPosStoreAccess(client, context, store.id);
  const normalized = String(barcode || "").trim();
  if (!normalized) throw posError(400, "A barcode is required.", "POS_BARCODE_REQUIRED");
  const row = (await client.query(
    `SELECT item.id AS item_id, item.name, item.code, item.barcode, item.uom_id, item.tracking_type, ${STORE_PRICE.replace("$PRICE_LIST", "$3")} AS sales_price
       FROM tenant.items item
      WHERE item.organization_id=$1 AND item.status='active' AND item.is_sellable
        AND (EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id AND identifier.item_id = item.id
                      AND identifier.status = 'active' AND upper(identifier.value) = upper($2)) OR upper(item.code) = upper($2))
      ORDER BY (upper(item.code) = upper($2)) LIMIT 1`,
    [context.organizationId, normalized, store.price_list_id ?? null],
  )).rows[0];
  if (!row) throw posError(404, "No product matches this barcode.", "POS_BARCODE_NOT_FOUND");
  return toPosProduct(row, await availableAt(client, context, store.warehouse_id, [row.item_id]));
}

