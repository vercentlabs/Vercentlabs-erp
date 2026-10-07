// An item's barcodes and other identifiers: one primary barcode and any number of alternates (UPC / EAN / GTIN values or the company's own
// internal codes), each optionally tied to one of the item's units (a carton barcode). A value belongs to one item in the organization; the
// database enforces it. Vercentlabs stores the values it is given and never issues GS1 numbers. Removing an identifier keeps it in the item's
// history; the item's barcode column always mirrors the primary.
import { requireProductPermission } from "./access.js";
import { IDENTIFIER_TYPES, PRODUCT_PERMISSIONS, ProductError } from "./constants.js";
import { recordProductHistory } from "./history.js";
import { IDENTIFIER_PATTERN, requireUuid, text } from "./validation.js";
import { findItemByPreviousSku } from "./sku.js";
import { resolveItemUnit } from "./uom.js";

const TYPES = new Set(IDENTIFIER_TYPES.map((entry) => entry.code));
const TYPE_LABELS = new Map(IDENTIFIER_TYPES.map((entry) => [entry.code, entry.label]));
const issue = (field, message, code = "PRODUCT_IDENTIFIER_INVALID", status = 400) => new ProductError(status, message, code, { issues: [{ field, message }] });

const toIdentifier = (row) => ({
  id: row.id, type: row.identifier_type, typeLabel: TYPE_LABELS.get(row.identifier_type) ?? row.identifier_type, value: row.value, uomId: row.uom_id, uom: row.uom_code ?? null,
  isPrimary: row.is_primary, createdAt: row.created_at, createdByName: row.created_by_name ?? null,
});

async function loadItem(client, context, itemId, { lock = false } = {}) {
  const row = (await client.query(
    `SELECT id, code, name, item_type, uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(itemId, "Item")])).rows[0];
  if (!row) throw new ProductError(404, "Item not found.", "PRODUCT_NOT_FOUND");
  return row;
}

// The item that already owns `value`, if any.
export async function identifierOwner(client, context, value, exceptItemId = null) {
  return (await client.query(
    `SELECT item.id, item.code, item.name FROM tenant.item_identifiers identifier
       JOIN tenant.items item ON item.organization_id = identifier.organization_id AND item.id = identifier.item_id
      WHERE identifier.organization_id = $1 AND upper(identifier.value) = upper($2) AND identifier.status = 'active' AND ($3::uuid IS NULL OR identifier.item_id <> $3) LIMIT 1`,
    [context.organizationId, value, exceptItemId])).rows[0] ?? null;
}

async function insert(client, context, item, { type, value, uomId, primary }) {
  await client.query("SAVEPOINT item_identifier");
  try {
    const row = (await client.query(
      `INSERT INTO tenant.item_identifiers (organization_id, item_id, identifier_type, value, uom_id, is_primary, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [context.organizationId, item.id, type, value, uomId, primary, context.userId ?? null])).rows[0];
    await client.query("RELEASE SAVEPOINT item_identifier");
    return row.id;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT item_identifier");
    if (error?.code === "23505") throw issue("value", `${value} was just given to another item.`, "PRODUCT_DUPLICATE", 409);
    throw error;
  }
}

// Barcodes given on the new-item form: the first is primary. Uniqueness was checked by the caller.
export async function addIdentifiersForNewItem(client, context, itemId, values) {
  for (const [index, value] of values.entries())
    await client.query(`INSERT INTO tenant.item_identifiers (organization_id, item_id, identifier_type, value, is_primary, created_by) VALUES ($1, $2, 'barcode', $3, $4, $5)`,
      [context.organizationId, itemId, value, index === 0, context.userId ?? null]);
}

export async function listItemIdentifiers(client, context, itemId, { includeRemoved = false } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const item = await loadItem(client, context, itemId);
  const { rows } = await client.query(
    `SELECT identifier.*, uom.code AS uom_code, creator.full_name AS created_by_name FROM tenant.item_identifiers identifier
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = identifier.organization_id AND uom.id = identifier.uom_id
       LEFT JOIN public.users creator ON creator.id = identifier.created_by
      WHERE identifier.organization_id = $1 AND identifier.item_id = $2${includeRemoved ? "" : " AND identifier.status = 'active'"}
      ORDER BY identifier.is_primary DESC, identifier.created_at`, [context.organizationId, item.id]);
  return rows.map(toIdentifier);
}

// input: { value, type ("barcode" | "gtin" | "internal"), uomId (the base unit or one the item converts), isPrimary }.
// The item's first barcode becomes its primary.
export async function addItemIdentifier(client, context, itemId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.manageIdentifiers, "You do not have permission to manage barcodes.");
  const item = await loadItem(client, context, itemId, { lock: true });
  if (item.item_type === "service") throw issue("value", "A service has no barcode.", "PRODUCT_IDENTIFIER_SERVICE", 409);
  const value = text(input.value).replace(/\s/g, "");
  const type = text(input.type || "barcode").toLowerCase();
  if (!TYPES.has(type)) throw issue("type", "Choose Barcode, GTIN or Internal code.");
  if (!IDENTIFIER_PATTERN.test(value)) throw issue("value", "Enter 3 to 64 letters, digits, dots, dashes or slashes.");
  if (type === "gtin" && !/^\d{8}$|^\d{12,14}$/.test(value)) throw issue("value", "A GTIN has 8, 12, 13 or 14 digits.");
  const uomId = input.uomId ? requireUuid(input.uomId, "Unit") : null;
  if (uomId && uomId !== item.uom_id && !(await resolveItemUnit(client, context.organizationId, item.id, uomId)).ok) throw issue("uomId", "Choose the base unit or one of this item's units.");
  const owner = await identifierOwner(client, context, value);
  if (owner) throw issue("value", owner.id === item.id ? `${value} is already on this item.` : `${value} already belongs to ${owner.name} (${owner.code}).`, "PRODUCT_DUPLICATE", 409);
  const hasPrimary = (await client.query(`SELECT 1 FROM tenant.item_identifiers WHERE organization_id = $1 AND item_id = $2 AND is_primary`, [context.organizationId, item.id])).rows[0];
  const primary = type !== "internal" && (input.isPrimary === true || !hasPrimary);
  if (primary && hasPrimary) await client.query(`UPDATE tenant.item_identifiers SET is_primary = false WHERE organization_id = $1 AND item_id = $2 AND is_primary`, [context.organizationId, item.id]);
  const id = await insert(client, context, item, { type, value, uomId, primary });
  await touch(client, context, item.id);
  await recordProductHistory(client, context, item.id, "updated", `${TYPE_LABELS.get(type)} ${value} added${primary ? " as the primary barcode" : ""}`,
    { identifier: { label: "Identifier", from: null, to: value, type, primary } });
  return { id, identifiers: await listItemIdentifiers(client, context, item.id) };
}

// Removes an identifier; when it was the primary, the oldest remaining barcode becomes primary.
export async function removeItemIdentifier(client, context, itemId, identifierId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.manageIdentifiers, "You do not have permission to manage barcodes.");
  const item = await loadItem(client, context, itemId, { lock: true });
  const row = (await client.query(`SELECT * FROM tenant.item_identifiers WHERE organization_id = $1 AND item_id = $2 AND id = $3 AND status = 'active'`,
    [context.organizationId, item.id, requireUuid(identifierId, "Identifier")])).rows[0];
  if (!row) throw new ProductError(404, "Identifier not found.", "PRODUCT_IDENTIFIER_NOT_FOUND");
  await client.query(`UPDATE tenant.item_identifiers SET status = 'removed', is_primary = false, removed_at = now(), removed_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  let promoted = null;
  if (row.is_primary) {
    promoted = (await client.query(
      `UPDATE tenant.item_identifiers SET is_primary = true WHERE id = (SELECT id FROM tenant.item_identifiers WHERE organization_id = $1 AND item_id = $2 AND status = 'active'
          AND identifier_type <> 'internal' ORDER BY created_at LIMIT 1) RETURNING value`, [context.organizationId, item.id])).rows[0]?.value ?? null;
  }
  await touch(client, context, item.id);
  await recordProductHistory(client, context, item.id, "updated", `${TYPE_LABELS.get(row.identifier_type)} ${row.value} removed${promoted ? `; ${promoted} is now primary` : ""}`,
    { identifier: { label: "Identifier", from: row.value, to: null, promoted } });
  return { identifiers: await listItemIdentifiers(client, context, item.id) };
}

export async function setPrimaryBarcode(client, context, itemId, identifierId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.manageIdentifiers, "You do not have permission to manage barcodes.");
  const item = await loadItem(client, context, itemId, { lock: true });
  const row = (await client.query(`SELECT * FROM tenant.item_identifiers WHERE organization_id = $1 AND item_id = $2 AND id = $3 AND status = 'active'`,
    [context.organizationId, item.id, requireUuid(identifierId, "Identifier")])).rows[0];
  if (!row) throw new ProductError(404, "Identifier not found.", "PRODUCT_IDENTIFIER_NOT_FOUND");
  if (row.identifier_type === "internal") throw issue("identifierId", "An internal code cannot be the primary barcode.");
  if (row.is_primary) return { identifiers: await listItemIdentifiers(client, context, item.id) };
  const previous = (await client.query(`UPDATE tenant.item_identifiers SET is_primary = false WHERE organization_id = $1 AND item_id = $2 AND is_primary RETURNING value`,
    [context.organizationId, item.id])).rows[0]?.value ?? null;
  await client.query(`UPDATE tenant.item_identifiers SET is_primary = true WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  await touch(client, context, item.id);
  await recordProductHistory(client, context, item.id, "updated", `Primary barcode changed to ${row.value}`, { barcode: { label: "Primary barcode", from: previous, to: row.value } });
  return { identifiers: await listItemIdentifiers(client, context, item.id) };
}

// Resolves a scanned or typed value to its item: the SKU, any live identifier, or a SKU the item had before.
export async function findItemByIdentifier(client, context, value) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const scanned = text(value).replace(/\s/g, "");
  if (!scanned) return null;
  const row = (await client.query(
    `SELECT item.id, item.code, item.name, identifier.identifier_type, identifier.uom_id, uom.code AS uom_code
       FROM tenant.items item
       LEFT JOIN tenant.item_identifiers identifier ON identifier.organization_id = item.organization_id AND identifier.item_id = item.id AND identifier.status = 'active'
            AND upper(identifier.value) = upper($2)
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = identifier.organization_id AND uom.id = identifier.uom_id
      WHERE item.organization_id = $1 AND (upper(item.code) = upper($2) OR identifier.id IS NOT NULL)
      ORDER BY (identifier.id IS NOT NULL) DESC LIMIT 1`, [context.organizationId, scanned])).rows[0];
  if (!row) {
    const previous = await findItemByPreviousSku(client, context, scanned);
    return previous ? { ...previous, uomId: null, uom: null } : null;
  }
  return { itemId: row.id, code: row.code, name: row.name, matchedBy: row.identifier_type ?? "sku", uomId: row.uom_id ?? null, uom: row.uom_code ?? null };
}

// The item changed: its version moves so an open form knows.
async function touch(client, context, itemId) {
  await client.query(`UPDATE tenant.items SET updated_by = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, itemId, context.userId ?? null]);
}
