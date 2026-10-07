// An item's units: its base unit (the one Inventory counts in) and its alternate units, each "1 BOX = 20 PCS" — always from the alternate
// unit to the base — enabled for purchasing, sales and inventory entry, optionally with a stricter precision. Units of the base's dimension
// with a standard conversion (G for an item in KG) need no conversion of their own. Documents keep the unit, quantity and factor they
// were entered with, so a changed or deactivated conversion only affects what is entered afterwards: stock is never recounted. All
// conversion arithmetic lives in uom.js.
import { formatDecimal, decimal } from "../../core/decimal.js";
import { requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS as P, ProductError } from "./constants.js";
import { recordProductHistory } from "./history.js";
import { conversionText, decimalsUsed, itemUnits, resolveItemUnit, validateUomDimension } from "./uom.js";
import { has, requireUuid, text } from "./validation.js";

const FACTOR = /^\d{1,14}(\.\d{1,10})?$/;
const issue = (field, message, code = "PRODUCT_CONVERSION_INVALID", status = 400) => new ProductError(status, message, code, { issues: [{ field, message }] });
const flag = (value, fallback) => (value === undefined || value === null ? fallback : value === true || value === "true");
// Transactions that mean the item's stock or documents already count in its units.
const USED = `EXISTS (SELECT 1 FROM tenant.stock_movements WHERE organization_id = $1::uuid AND item_id = $2::uuid)
  OR EXISTS (SELECT 1 FROM tenant.purchase_order_lines WHERE organization_id = $1::uuid AND product_id = $2::uuid)
  OR EXISTS (SELECT 1 FROM tenant.sales_order_lines WHERE organization_id = $1::uuid AND item_id = $2::uuid)
  OR EXISTS (SELECT 1 FROM tenant.sales_quotation_lines WHERE organization_id = $1::uuid AND item_id = $2::uuid)`;

async function loadItem(client, context, itemId, { lock = false } = {}) {
  const row = (await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.uom_id, item.sales_uom_id, item.purchase_uom_id, item.tracking_type, item.is_variant_template, item.version,
            base.code AS base_code, base.name AS base_name, base.symbol AS base_symbol, base.category AS base_category, base.decimal_places AS base_decimals
       FROM tenant.items item JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = $2${lock ? " FOR UPDATE OF item" : ""}`,
    [context.organizationId, requireUuid(itemId, "Item")])).rows[0];
  if (!row) throw new ProductError(404, "Item not found.", "PRODUCT_NOT_FOUND");
  return row;
}

export async function recordUomHistory(client, context, itemId, eventType, { uomId = null, uomCode = null, from = null, to = null, reason = null } = {}) {
  await client.query(
    `INSERT INTO tenant.item_uom_history (organization_id, item_id, event_type, uom_id, uom_code, old_value, new_value, reason, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [context.organizationId, itemId, eventType, uomId, uomCode, from === null ? null : JSON.stringify(from), to === null ? null : JSON.stringify(to), reason, context.userId ?? null]);
}

async function touch(client, context, itemId) {
  await client.query(`UPDATE tenant.items SET updated_by = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, itemId, context.userId ?? null]);
}

const usedOnTransactions = async (client, context, itemId) => Boolean((await client.query(`SELECT ${USED} AS used`, [context.organizationId, itemId])).rows[0].used);

// ------------------------------------------------------------------ read

// Every unit the item can be counted in (base, its own conversions, standard units of its dimension), with usage and defaults.
async function loadUnits(client, context, itemId, { includeInactive = true } = {}) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const item = await loadItem(client, context, itemId);
  const units = await itemUnits(client, context.organizationId, item, { includeInactive });
  return {
    item: { id: item.id, code: item.code, baseUomId: item.uom_id, baseUom: item.base_code, baseUomName: item.base_name, baseDecimals: Number(item.base_decimals),
      purchaseUomId: item.purchase_uom_id ?? item.uom_id, salesUomId: item.sales_uom_id ?? item.uom_id, serialTracked: item.tracking_type === "serial" },
    units, used: await usedOnTransactions(client, context, item.id),
  };
}

// Every unit with, for screens and callers that read them, the item's own active conversions in their list shape.
export async function getItemUnits(client, context, itemId, options = {}) {
  const result = await loadUnits(client, context, itemId, options);
  return { ...result, conversions: conversionsOf(result) };
}

const conversionsOf = ({ item, units }) => units.filter((unit) => unit.source === "item" && unit.isActive).map((unit) => ({
  id: unit.conversionId, uomId: unit.uomId, uom: unit.code, uomName: unit.name, factor: unit.factor, baseUomId: item.baseUomId, baseUom: item.baseUom,
  isSalesDefault: unit.isSalesDefault, isPurchaseDefault: unit.isPurchaseDefault, purchasing: unit.purchasing, sales: unit.sales, inventory: unit.inventory,
  decimals: unit.decimals, version: unit.version, text: unit.text,
}));

// The item's own conversions (the alternate units it was given).
export async function listItemUomConversions(client, context, itemId) {
  return conversionsOf(await loadUnits(client, context, itemId, { includeInactive: false }));
}

export async function getItemUomHistory(client, context, itemId) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.item_uom_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.item_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`, [context.organizationId, requireUuid(itemId, "Item")]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, uomCode: row.uom_code, from: row.old_value, to: row.new_value, reason: row.reason, actorName: row.actor_name, createdAt: row.created_at }));
}

// ------------------------------------------------------------------ checks

// A conversion fits the item: positive, a unit other than the base, an active unit, the right dimension (with a reason where only a
// business conversion makes sense), whole for a serial-numbered item, and within the base unit's decimals (12.5 PCS cannot be when pieces
// are whole). Returns { uomId, uomCode, factor, precision }.
async function checkConversion(client, context, item, input, { existing = null } = {}) {
  const uomId = existing?.from_uom_id ?? requireUuid(input.uomId, "Unit");
  if (uomId === item.uom_id) throw issue("uomId", `${item.base_code} is the base unit; it needs no conversion.`);
  const uom = (await client.query(`SELECT code, name, category, decimal_places, status FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [context.organizationId, uomId])).rows[0];
  if (!uom) throw issue("uomId", "Choose a unit of measure from this organization.");
  if (uom.status !== "active" && !existing) throw issue("uomId", "Choose an active unit of measure.");
  const raw = has(input, "factor") ? text(input.factor).replace(/,/g, "") : existing ? formatDecimal(decimal(String(existing.conversion_factor).match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "0")) : "";
  if (!FACTOR.test(raw) || Number(raw) <= 0) throw issue("factor", `Enter how many ${item.base_code} one ${uom.code} holds, such as 20. It must be more than zero.`);
  const factor = decimal(raw.match(/^\d+(?:\.\d{1,6})?/)[0]);
  if (factor <= 0n || decimalsUsed(factor) !== (raw.split(".")[1] ?? "").replace(/0+$/, "").length) throw issue("factor", "Use at most six decimal places.");
  const used = decimalsUsed(factor);
  if (used > Number(item.base_decimals))
    throw issue("factor", `${item.base_code} allows ${Number(item.base_decimals)} decimal place${Number(item.base_decimals) === 1 ? "" : "s"}, so 1 ${uom.code} cannot be ${formatDecimal(factor).replace(/\.?0+$/, "")} ${item.base_code}.`);
  if (item.tracking_type === "serial" && used > 0) throw issue("factor", "A serial-numbered item converts in whole units: 1 BOX holds a whole number of serial-numbered pieces.");
  if (!existing) {
    const dimension = await validateUomDimension(client, uom, { code: item.base_code, category: item.base_category });
    if (dimension.problem) throw issue("uomId", dimension.problem, "PRODUCT_CONVERSION_DIMENSION");
    if (dimension.needsReason && !text(input.reason)) throw issue("reason", dimension.needsReason, "PRODUCT_CONVERSION_REASON_REQUIRED");
  }
  const precisionInput = has(input, "quantityPrecision") ? input.quantityPrecision : existing?.quantity_precision ?? null;
  const precision = precisionInput === null || precisionInput === "" ? null : Number(precisionInput);
  if (precision !== null && (!Number.isInteger(precision) || precision < 0 || precision > Number(uom.decimal_places)))
    throw issue("quantityPrecision", `Choose 0 to ${Number(uom.decimal_places)} decimal places (${uom.code} allows ${Number(uom.decimal_places)}).`);
  return { uomId, uomCode: uom.code, factor, precision };
}

export async function validateUomConversion(client, context, itemId, input = {}) {
  const item = await loadItem(client, context, itemId);
  const checked = await checkConversion(client, context, item, input);
  return { ...checked, factor: formatDecimal(checked.factor).replace(/\.?0+$/, "") };
}

const factorString = (factor) => formatDecimal(factor).replace(/\.?0+$/, "");
const usage = (row) => ({ purchasing: row.purchasing_enabled, sales: row.sales_enabled, inventory: row.inventory_enabled });

// ------------------------------------------------------------------ write

// input: { uomId, factor, purchasingEnabled, salesEnabled, inventoryEnabled, quantityPrecision, reason } — adds "1 uom = factor base
// units", or brings a deactivated one back with these settings.
export async function addItemUomConversion(client, context, itemId, input = {}) {
  requireProductPermission(context, P.manageUnits, "You do not have permission to change an item's units.");
  const item = await loadItem(client, context, itemId, { lock: true });
  const { uomId, uomCode, factor, precision } = await checkConversion(client, context, item, input);
  const flags = { purchasing: flag(input.purchasingEnabled, true), sales: flag(input.salesEnabled, true), inventory: flag(input.inventoryEnabled, true) };
  if (!flags.purchasing && !flags.sales && !flags.inventory) throw issue("purchasingEnabled", "Enable the unit for purchasing, sales or inventory entry.");
  const existing = (await client.query(`SELECT id, status, conversion_factor FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2 AND from_uom_id = $3 AND to_uom_id = $4`,
    [context.organizationId, item.id, uomId, item.uom_id])).rows[0];
  if (existing?.status === "active") throw issue("uomId", `${uomCode} is already a unit of this item. Change its conversion instead.`, "PRODUCT_CONVERSION_EXISTS", 409);
  // Bringing a unit back with another factor is a conversion change: on an item in use it must be confirmed like one.
  if (existing && Number(existing.conversion_factor) !== Number(factorString(factor))) {
    requireProductPermission(context, P.changeUomConversions, "You do not have permission to change unit conversions.");
    if (await usedOnTransactions(client, context, item.id) && input.acknowledgeHistory !== true)
      throw new ProductError(409, `${uomCode} was 1 ${uomCode} = ${Number(existing.conversion_factor)} ${item.base_code} on documents already entered; they keep that. Confirm to bring it back as ${factorString(factor)} ${item.base_code} for new documents.`,
        "PRODUCT_CONVERSION_CONFIRM", { requiresAcknowledgement: true });
  }
  const params = [context.organizationId, item.id, uomId, item.uom_id, factorString(factor), flags.purchasing, flags.sales, flags.inventory, precision, context.userId ?? null];
  const id = existing
    ? (await client.query(`UPDATE tenant.item_uom_conversions SET conversion_factor = $3, purchasing_enabled = $4, sales_enabled = $5, inventory_enabled = $6, quantity_precision = $7,
         status = 'active', version = version + 1, updated_by = $8, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
        [context.organizationId, existing.id, factorString(factor), flags.purchasing, flags.sales, flags.inventory, precision, context.userId ?? null])).rows[0].id
    : (await client.query(`INSERT INTO tenant.item_uom_conversions (organization_id, item_id, from_uom_id, to_uom_id, conversion_factor, purchasing_enabled, sales_enabled, inventory_enabled,
         quantity_precision, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $10) RETURNING id`, params)).rows[0].id;
  await touch(client, context, item.id);
  const shown = conversionText(uomCode, factor, item.base_code);
  await recordUomHistory(client, context, item.id, existing ? "unit_reactivated" : "unit_added", { uomId, uomCode, to: { conversion: shown, ...flags, precision }, reason: text(input.reason) || null });
  await recordProductHistory(client, context, item.id, "updated", `Unit ${existing ? "brought back" : "added"}: ${shown}`, { conversion: { label: "Unit conversion", from: null, to: shown } });
  return { id, ...(await getItemUnits(client, context, item.id)) };
}

// input: { factor?, purchasingEnabled?, salesEnabled?, inventoryEnabled?, quantityPrecision?, reason?, expectedVersion?, acknowledgeHistory? }.
// A new factor applies to documents entered afterwards: documents keep the factor they were entered with and stock stays as counted. On an
// item already used, a new factor is refused until acknowledged (acknowledgeHistory) — the warning the screen shows first. Two packagings
// that circulate together are two units (BOX20, BOX24), not one changed BOX.
export async function updateItemUomConversion(client, context, itemId, conversionId, input = {}) {
  requireProductPermission(context, P.manageUnits, "You do not have permission to change an item's units.");
  const item = await loadItem(client, context, itemId, { lock: true });
  const row = (await client.query(
    `SELECT conversion.*, uom.code AS uom_code FROM tenant.item_uom_conversions conversion JOIN tenant.units_of_measure uom ON uom.organization_id = conversion.organization_id AND uom.id = conversion.from_uom_id
      WHERE conversion.organization_id = $1 AND conversion.item_id = $2 AND conversion.id = $3 AND conversion.status = 'active' FOR UPDATE OF conversion`,
    [context.organizationId, item.id, requireUuid(conversionId, "Conversion")])).rows[0];
  if (!row) throw new ProductError(404, "Conversion not found.", "PRODUCT_CONVERSION_NOT_FOUND");
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this unit after you opened it. Reload it and make your change again.", "PRODUCT_CONVERSION_VERSION_CONFLICT");
  const { factor, precision } = await checkConversion(client, context, item, input, { existing: row });
  const before = { factor: decimal(formatDecimal(decimal(String(row.conversion_factor).match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "0"))), ...usage(row), precision: row.quantity_precision };
  const flags = { purchasing: flag(input.purchasingEnabled, row.purchasing_enabled), sales: flag(input.salesEnabled, row.sales_enabled), inventory: flag(input.inventoryEnabled, row.inventory_enabled) };
  if (!flags.purchasing && !flags.sales && !flags.inventory) throw issue("purchasingEnabled", "Enable the unit for purchasing, sales or inventory entry, or deactivate it.");
  // The default purchase / sales unit must stay enabled for it.
  if (!flags.purchasing && row.from_uom_id === item.purchase_uom_id) throw issue("purchasingEnabled", `${row.uom_code} is the default purchase unit. Choose another default first.`, "PRODUCT_DEFAULT_UOM_DISABLED", 409);
  if (!flags.sales && row.from_uom_id === item.sales_uom_id) throw issue("salesEnabled", `${row.uom_code} is the default sales unit. Choose another default first.`, "PRODUCT_DEFAULT_UOM_DISABLED", 409);
  const factorChanged = factor !== before.factor;
  const usageChanged = ["purchasing", "sales", "inventory"].some((key) => flags[key] !== before[key]);
  const precisionChanged = (precision ?? null) !== (before.precision === null ? null : Number(before.precision));
  if (!factorChanged && !usageChanged && !precisionChanged) return getItemUnits(client, context, item.id);
  if (factorChanged) {
    requireProductPermission(context, P.changeUomConversions, "You do not have permission to change unit conversions.");
    if (await usedOnTransactions(client, context, item.id) && input.acknowledgeHistory !== true)
      throw new ProductError(409, `${item.code} is already on documents or in stock. Documents keep 1 ${row.uom_code} = ${factorString(before.factor)} ${item.base_code} and stock stays as counted; only what is entered from now on uses the new factor. If both packagings are in use, add a separate unit instead.`,
        "PRODUCT_CONVERSION_CONFIRM", { requiresAcknowledgement: true });
  }
  if (usageChanged || precisionChanged) requireProductPermission(context, P.changeUomConversions, "You do not have permission to change unit conversions.");
  await client.query(
    `UPDATE tenant.item_uom_conversions SET conversion_factor = $3, purchasing_enabled = $4, sales_enabled = $5, inventory_enabled = $6, quantity_precision = $7, version = version + 1,
            updated_by = $8, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, factorString(factor), flags.purchasing, flags.sales, flags.inventory, precision, context.userId ?? null]);
  await touch(client, context, item.id);
  const reason = text(input.reason) || null;
  if (factorChanged) {
    const from = conversionText(row.uom_code, before.factor, item.base_code);
    const to = conversionText(row.uom_code, factor, item.base_code);
    await recordUomHistory(client, context, item.id, "conversion_changed", { uomId: row.from_uom_id, uomCode: row.uom_code, from: { conversion: from }, to: { conversion: to }, reason });
    await recordProductHistory(client, context, item.id, "updated", `Unit conversion changed: ${to} (was ${factorString(before.factor)} ${item.base_code})`, { conversion: { label: `${row.uom_code} conversion`, from, to } });
  }
  if (usageChanged) await recordUomHistory(client, context, item.id, "usage_changed", { uomId: row.from_uom_id, uomCode: row.uom_code, from: usage(row), to: flags, reason });
  if (precisionChanged) await recordUomHistory(client, context, item.id, "precision_changed", { uomId: row.from_uom_id, uomCode: row.uom_code, from: { precision: before.precision }, to: { precision }, reason });
  return getItemUnits(client, context, item.id);
}

// A unit that is the item's default purchase or sales unit, or carries one of its barcodes, cannot be deactivated. Documents that used it
// keep it; it can be brought back with addItemUomConversion.
export async function removeItemUomConversion(client, context, itemId, conversionId, input = {}) {
  requireProductPermission(context, P.manageUnits, "You do not have permission to change an item's units.");
  const item = await loadItem(client, context, itemId, { lock: true });
  const row = (await client.query(
    `SELECT conversion.*, uom.code AS uom_code FROM tenant.item_uom_conversions conversion JOIN tenant.units_of_measure uom ON uom.organization_id = conversion.organization_id AND uom.id = conversion.from_uom_id
      WHERE conversion.organization_id = $1 AND conversion.item_id = $2 AND conversion.id = $3 AND conversion.status = 'active'`,
    [context.organizationId, item.id, requireUuid(conversionId, "Conversion")])).rows[0];
  if (!row) throw new ProductError(404, "Conversion not found.", "PRODUCT_CONVERSION_NOT_FOUND");
  if (row.from_uom_id === item.sales_uom_id || row.from_uom_id === item.purchase_uom_id)
    throw issue("uomId", `${row.uom_code} is the item's default ${row.from_uom_id === item.sales_uom_id ? "sales" : "purchase"} unit. Choose another default first.`, "PRODUCT_CONVERSION_IN_USE", 409);
  if ((await client.query(`SELECT 1 FROM tenant.item_identifiers WHERE organization_id = $1 AND item_id = $2 AND uom_id = $3 AND status = 'active' LIMIT 1`,
    [context.organizationId, item.id, row.from_uom_id])).rows[0]) throw issue("uomId", `A barcode of this item is for ${row.uom_code}. Remove it first.`, "PRODUCT_CONVERSION_IN_USE", 409);
  await client.query(`UPDATE tenant.item_uom_conversions SET status = 'inactive', version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  await touch(client, context, item.id);
  const shown = conversionText(row.uom_code, decimal(String(row.conversion_factor).match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "0"), item.base_code);
  await recordUomHistory(client, context, item.id, "unit_deactivated", { uomId: row.from_uom_id, uomCode: row.uom_code, from: { conversion: shown }, reason: text(input.reason) || null });
  await recordProductHistory(client, context, item.id, "updated", `Unit deactivated: ${row.uom_code}`, { conversion: { label: "Unit conversion", from: shown, to: null } });
  return getItemUnits(client, context, item.id);
}

// input: { purchaseUomId?, salesUomId?, reason? } — the units new purchase and sales documents start with. Each must be one of the item's
// units enabled for it. Documents already entered keep their unit.
export async function setItemDefaultUoms(client, context, itemId, input = {}) {
  requireProductPermission(context, P.changeDefaultUoms, "You do not have permission to change default units.");
  const item = await loadItem(client, context, itemId, { lock: true });
  const changes = [];
  for (const [field, column, purpose, event, label] of [["purchaseUomId", "purchase_uom_id", "purchase", "purchase_default_changed", "Default purchase unit"],
    ["salesUomId", "sales_uom_id", "sales", "sales_default_changed", "Default sales unit"]]) {
    if (!has(input, field)) continue;
    const wanted = input[field] ? requireUuid(input[field], label) : item.uom_id;
    if (wanted === (item[column] ?? item.uom_id)) continue;
    const resolved = await resolveItemUnit(client, context.organizationId, item, wanted, { purpose });
    if (!resolved.ok) throw issue(field, `${label}: ${resolved.message}`, "PRODUCT_DEFAULT_UOM_INVALID");
    changes.push({ field, column, event, label, wanted, unit: resolved.unit, before: (await resolveItemUnit(client, context.organizationId, item, item[column] ?? item.uom_id, { allowInactive: true })).unit });
  }
  if (!changes.length) return getItemUnits(client, context, item.id);
  await client.query(`UPDATE tenant.items SET ${changes.map((change, index) => `${change.column} = $${index + 3}`).join(", ")}, updated_by = $${changes.length + 3}, updated_at = now(), version = version + 1
     WHERE organization_id = $1 AND id = $2`, [context.organizationId, item.id, ...changes.map((change) => change.wanted), context.userId ?? null]);
  const reason = text(input.reason) || null;
  for (const change of changes) {
    await recordUomHistory(client, context, item.id, change.event, { uomId: change.wanted, uomCode: change.unit.code, from: { unit: change.before?.code ?? null }, to: { unit: change.unit.code }, reason });
    await recordProductHistory(client, context, item.id, "updated", `${change.label} changed to ${change.unit.code}`, { [change.field]: { label: change.label, from: change.before?.code ?? null, to: change.unit.code } });
  }
  return getItemUnits(client, context, item.id);
}
