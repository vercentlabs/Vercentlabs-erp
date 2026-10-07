// Duplicate item detection, used while typing, on save and on import.
//
// Strong (the save is refused): the same SKU, or a barcode / identifier another item already has.
// Possible (a warning only): the same or a similar name, or the same manufacturer and part number. Two items may legitimately share a name.
import { requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, productTypeOf } from "./constants.js";
import { isUuid, text } from "./validation.js";

const SIMILAR = 0.55;
const LABELS = Object.freeze({ sku: "Same SKU", barcode: "Same barcode", name: "Same name", similar_name: "Similar name", part_number: "Same manufacturer part number" });

// input: { code, name, barcode, manufacturerName, manufacturerPartNumber }
export async function findDuplicateProducts(client, context, input = {}, { excludeId = null, limit = 8 } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const code = text(input.code ?? input.sku).toUpperCase();
  const name = text(input.name);
  const barcode = text(input.barcode).replace(/\s/g, "");
  const partNumber = text(input.manufacturerPartNumber).toUpperCase();
  const manufacturer = text(input.manufacturerName).toLowerCase();
  if (!code && !name && !barcode && !partNumber) return { matches: [], hasBlockingMatch: false };
  const exclude = isUuid(excludeId) ? excludeId : null;
  const { rows } = await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.track_inventory, item.lifecycle_status,
            array_remove(ARRAY[
              CASE WHEN $2 <> '' AND upper(item.code) = $2 THEN 'sku' END,
              CASE WHEN $4 <> '' AND EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id
                   AND identifier.item_id = item.id AND identifier.status = 'active' AND upper(identifier.value) = upper($4)) THEN 'barcode' END,
              CASE WHEN $3 <> '' AND lower(item.name) = lower($3) THEN 'name' END,
              CASE WHEN $3 <> '' AND lower(item.name) <> lower($3) AND similarity(lower(item.name), lower($3)) >= $7 THEN 'similar_name' END,
              CASE WHEN $5 <> '' AND upper(item.manufacturer_part_number) = $5 AND ($8 = '' OR lower(COALESCE(item.manufacturer_name, '')) = $8) THEN 'part_number' END
            ], NULL) AS signals
       FROM tenant.items item
      WHERE item.organization_id = $1 AND ($6::uuid IS NULL OR item.id <> $6)
        AND (($2 <> '' AND upper(item.code) = $2)
             OR ($4 <> '' AND EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id AND identifier.item_id = item.id
                   AND identifier.status = 'active' AND upper(identifier.value) = upper($4)))
             OR ($3 <> '' AND (lower(item.name) = lower($3) OR lower(item.name) % lower($3)))
             OR ($5 <> '' AND upper(item.manufacturer_part_number) = $5))
      ORDER BY similarity(lower(item.name), lower($3)) DESC LIMIT ${Number(limit) * 2}`,
    [context.organizationId, code, name, barcode, partNumber, exclude, SIMILAR, manufacturer],
  );
  const matches = rows.filter((row) => row.signals.length).map((row) => {
    const strong = row.signals.some((signal) => ["sku", "barcode"].includes(signal));
    return {
      id: row.id, code: row.code, name: row.name, type: productTypeOf(row), status: row.lifecycle_status, strength: strong ? "strong" : "possible",
      reasons: row.signals.map((signal) => ({ signal, label: LABELS[signal], ...(signal === "barcode" ? { value: barcode } : {}) })), href: `/inventory/items/${row.id}`,
    };
  }).sort((left, right) => (left.strength === right.strength ? 0 : left.strength === "strong" ? -1 : 1)).slice(0, Number(limit));
  return { matches, hasBlockingMatch: matches.some((match) => match.strength === "strong") };
}
