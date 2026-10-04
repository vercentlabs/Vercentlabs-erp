// Duplicate product detection, used while typing, on save and on import.
//
// Strong (the save is refused): the same code, the same SKU, or the same
// barcode on another item or variant.
// Possible (a warning only): a similar name.
import { requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, productTypeOf } from "./constants.js";
import { isUuid, text } from "./validation.js";

const SIMILAR = 0.55;
const LABELS = Object.freeze({ code: "Same code", sku: "Same SKU", barcode: "Same barcode", name: "Same name", similar_name: "Similar name" });

// input: { code, name, sku, barcode }
export async function findDuplicateProducts(client, context, input = {}, { excludeId = null, limit = 8 } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const code = text(input.code).toUpperCase();
  const name = text(input.name);
  const sku = text(input.sku).toUpperCase();
  const barcode = text(input.barcode).replace(/\s/g, "");
  if (!code && !name && !sku && !barcode) return { matches: [], hasBlockingMatch: false };
  const exclude = isUuid(excludeId) ? excludeId : null;
  const { rows } = await client.query(
    `SELECT item.id, item.code, item.name, item.sku, item.barcode, item.item_type, item.track_inventory, item.status,
            array_remove(ARRAY[
              CASE WHEN $2 <> '' AND upper(item.code) = $2 THEN 'code' END,
              CASE WHEN $4 <> '' AND upper(item.sku) = $4 THEN 'sku' END,
              CASE WHEN $5 <> '' AND item.barcode = $5 THEN 'barcode' END,
              CASE WHEN $3 <> '' AND lower(item.name) = lower($3) THEN 'name' END,
              CASE WHEN $3 <> '' AND lower(item.name) <> lower($3) AND similarity(lower(item.name), lower($3)) >= $7 THEN 'similar_name' END
            ], NULL) AS signals
       FROM tenant.items item
      WHERE item.organization_id = $1 AND ($6::uuid IS NULL OR item.id <> $6)
        AND (($2 <> '' AND upper(item.code) = $2) OR ($4 <> '' AND upper(item.sku) = $4) OR ($5 <> '' AND item.barcode = $5)
             OR ($3 <> '' AND (lower(item.name) = lower($3) OR lower(item.name) % lower($3))))
      ORDER BY similarity(lower(item.name), lower($3)) DESC LIMIT ${Number(limit) * 2}`,
    [context.organizationId, code, name, sku, barcode, exclude, SIMILAR],
  );
  // A variant's barcode or SKU is as taken as an item's.
  const variants = barcode || sku ? (await client.query(
    `SELECT variant.id, variant.sku, variant.barcode, variant.name, item.id AS item_id, item.code AS item_code
       FROM tenant.item_variants variant JOIN tenant.items item ON item.organization_id = variant.organization_id AND item.id = variant.item_id
      WHERE variant.organization_id = $1 AND ($4::uuid IS NULL OR variant.item_id <> $4) AND (($2 <> '' AND variant.barcode = $2) OR ($3 <> '' AND upper(variant.sku) = $3)) LIMIT 3`,
    [context.organizationId, barcode, sku, exclude])).rows : [];
  const matches = [
    ...rows.filter((row) => row.signals.length).map((row) => {
      const strong = row.signals.some((signal) => ["code", "sku", "barcode"].includes(signal));
      return {
        id: row.id, code: row.code, name: row.name, type: productTypeOf(row), status: row.status, strength: strong ? "strong" : "possible",
        reasons: row.signals.map((signal) => ({ signal, label: LABELS[signal] })), href: `/sales/products/${row.id}`,
      };
    }),
    ...variants.map((variant) => ({
      id: variant.item_id, code: variant.item_code, name: `${variant.name} (variant)`, type: "stock", status: "active", strength: "strong",
      reasons: [barcode && variant.barcode === barcode ? { signal: "barcode", label: LABELS.barcode } : { signal: "sku", label: LABELS.sku }], href: `/sales/products/${variant.item_id}`,
    })),
  ].sort((left, right) => (left.strength === right.strength ? 0 : left.strength === "strong" ? -1 : 1)).slice(0, Number(limit));
  return { matches, hasBlockingMatch: matches.some((match) => match.strength === "strong") };
}
