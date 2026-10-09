// Inventory Movement History: the Stock Ledger made readable. Read-only, and never a second ledger: every row is read straight from the
// canonical movements (tenant.stock_movements) and their postings (tenant.stock_movement_groups), so there is nothing to keep in step and
// nothing that can drift — "rebuilding" it is re-reading the ledger.
//
//   Item Movements      one row per ledger leg: what moved, from where to where, in base units (and as entered), with its document
//   Transaction Events  one row per posting (a goods receipt posted, a transfer dispatched, a quality hold placed), its legs inside
//
// Reservations and drafts never appear: only posted physical movements and internal reclassifications (location and disposition moves).
// Quantities are signed in the item's base unit; direction, category, the from/to path and the warning flags are derived on read. Cost and
// value come from Inventory Valuation and are shown only with View Stock Ledger Valuation; the warehouses a user may see bound every query.
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { LEDGER_KINDS, LEDGER_TYPE_LABELS, ledgerKindSql } from "./ledger-posting.js";
import { ledgerSourceHref } from "./ledger.js";

const P = STOCK_LEDGER_PERMISSIONS;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const money = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100);
const text = (value, max = 120) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const invalid = (message) => new StockError(400, message, "MOVEMENT_HISTORY_FILTER_INVALID");
const uuidOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (!UUID.test(String(value))) throw invalid(`${label} is invalid.`);
  return String(value);
};
const dayOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw invalid(`${label} is not a valid date.`);
  return day;
};
const list = (value) => String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);

// ---------------------------------------------------------------- vocabulary (derived, never stored)
export const MOVEMENT_CATEGORIES = Object.freeze([
  { id: "opening", label: "Opening" }, { id: "inbound", label: "Inbound" }, { id: "outbound", label: "Outbound" }, { id: "transfer", label: "Transfer" },
  { id: "adjustment", label: "Adjustment" }, { id: "disposition", label: "Quality / disposition" }, { id: "reversal", label: "Reversal" },
]);
const CATEGORY_OF = Object.freeze({
  opening_stock: "opening", purchase_receipt: "inbound", sales_return: "inbound", production_receipt: "inbound",
  purchase_return: "outbound", sales_delivery: "outbound", goods_issue: "outbound", production_issue: "outbound",
  transfer_out: "transfer", transfer_in: "transfer", transfer_to_transit: "transfer", transfer_from_transit: "transfer", location_transfer_out: "transfer", location_transfer_in: "transfer",
  adjustment_in: "adjustment", adjustment_out: "adjustment", disposition_out: "disposition", disposition_in: "disposition", reversal: "reversal",
});
const KINDS_OF = (category) => Object.keys(CATEGORY_OF).filter((kind) => CATEGORY_OF[kind] === category);
// Legs that move stock the company keeps: their other side is another leg of the same posting.
const INTERNAL_KINDS = Object.freeze(["transfer_out", "transfer_in", "transfer_to_transit", "transfer_from_transit", "location_transfer_out", "location_transfer_in",
  "disposition_out", "disposition_in"]);
const DISPOSITIONS = Object.freeze({ available: "Available", quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged" });

// The saved views: presets of the same query, never separate pages or stores.
export const MOVEMENT_HISTORY_VIEWS = Object.freeze([
  { id: "all", label: "All movements" }, { id: "inbound", label: "Inbound", filters: { category: "inbound,opening" } },
  { id: "outbound", label: "Outbound", filters: { category: "outbound" } }, { id: "transfers", label: "Transfers", filters: { category: "transfer" } },
  { id: "adjustments", label: "Adjustments", filters: { category: "adjustment" } }, { id: "quality", label: "Quality / disposition", filters: { category: "disposition" } },
  { id: "reversals", label: "Reversals", filters: { status: "reversal_related" } }, { id: "today", label: "Today", filters: { today: true } },
  { id: "backdated", label: "Backdated", filters: { backdated: "true" } }, { id: "batches", label: "Batch movements", filters: { tracking: "batch" } },
  { id: "serials", label: "Serial movements", filters: { tracking: "serial" } },
]);

// A movement is backdated when it was posted more than a day after the moment it takes effect. Opening stock is dated to its cutoff by
// design (the migration of stock held before Vercentlabs), so it is never flagged.
const backdatedSql = (movement = "movement") => `(${movement}.ledger_type <> 'opening_stock' AND ${movement}.created_at > ${movement}.occurred_at + interval '1 day')`;
const groupBackdatedSql = (group = "movement_group") => `(${group}.operation_type <> 'opening_stock' AND ${group}.posted_at > ${group}.effective_at + interval '1 day')`;

// ---------------------------------------------------------------- filters
// filters: view (a saved view), itemId, warehouseId, locationId, batchId, serialId, disposition (the stock scope); categoryId (item category);
// category (movement categories, comma-separated); type (ledger kinds, comma-separated); direction (in | out); sourceType, sourceId,
// reference (document number); postedBy; status (active | reversed | reversal | reversal_related); backdated (true); tracking (batch |
// serial); from/to (effective dates); postedFrom/postedTo; search (SKU, item, barcode, movement or document number, PO / SO, supplier or
// customer reference, batch, serial); sort (effective | posted); order (asc | desc); limit (≤ 500); cursor.
function readFilters(filters = {}) {
  const view = MOVEMENT_HISTORY_VIEWS.find((entry) => entry.id === (filters.view || "all"));
  if (!view) throw invalid("Unknown saved view.");
  const preset = view.filters ?? {};
  const merged = { ...preset, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== "")) };
  const categories = list(merged.category);
  if (categories.some((entry) => !MOVEMENT_CATEGORIES.some((category) => category.id === entry))) throw invalid("Unknown movement category.");
  const types = list(merged.type ?? merged.ledgerType);
  if (types.some((type) => !LEDGER_KINDS.includes(type))) throw invalid("Unknown movement type.");
  const disposition = text(merged.disposition, 30);
  if (disposition && !DISPOSITIONS[disposition]) throw invalid("Unknown disposition.");
  const direction = text(merged.direction, 10);
  if (direction && !["in", "out"].includes(direction)) throw invalid("Direction is in or out.");
  const status = text(merged.status, 20);
  if (status && !["active", "reversed", "reversal", "reversal_related"].includes(status)) throw invalid("Unknown status.");
  const tracking = text(merged.tracking, 10);
  if (tracking && !["batch", "serial"].includes(tracking)) throw invalid("Tracking is batch or serial.");
  const today = new Date().toISOString().slice(0, 10);
  return {
    view: view.id, itemId: uuidOrNull(merged.itemId, "Item"), warehouseId: uuidOrNull(merged.warehouseId, "Warehouse"), locationId: uuidOrNull(merged.locationId, "Location"),
    batchId: uuidOrNull(merged.batchId, "Batch"), serialId: uuidOrNull(merged.serialId, "Serial number"), categoryId: uuidOrNull(merged.categoryId, "Category"),
    postedBy: uuidOrNull(merged.postedBy, "Posted by"), groupId: uuidOrNull(merged.groupId, "Movement"), sourceId: uuidOrNull(merged.sourceId, "Source document"), sourceType: text(merged.sourceType, 60),
    from: dayOrNull(merged.from, "From"), to: dayOrNull(merged.to, "To"),
    postedFrom: dayOrNull(merged.postedFrom ?? (merged.today ? today : null), "Posted from"), postedTo: dayOrNull(merged.postedTo ?? (merged.today ? today : null), "Posted to"),
    categories, types, disposition, direction, status, tracking, backdated: String(merged.backdated) === "true",
    reference: text(merged.reference, 60), search: text(merged.search, 120),
    sort: merged.sort === "posted" ? "posted" : "effective", order: merged.order === "asc" ? "asc" : "desc",
    limit: Math.min(Math.max(Number(merged.limit) || 100, 1), 500), cursor: text(merged.cursor, 40),
  };
}

// The warehouses this user may see; asking for another is refused, not quietly emptied.
async function warehouseScope(client, c, warehouseId) {
  const visible = await visibleWarehouseIds(client, c);
  if (warehouseId && visible && !visible.includes(warehouseId))
    throw new StockError(403, "You do not have access to that warehouse's movements.", "MOVEMENT_HISTORY_WAREHOUSE_FORBIDDEN");
  return visible;
}

// A search that is exactly a serial number shows that unit's journey; exactly a batch number, that batch's movements.
async function resolveSearch(client, c, f) {
  if (!f.search || f.serialId || f.batchId) return;
  const serial = (await client.query(`SELECT id, item_id FROM tenant.stock_serials WHERE organization_id = $1 AND lower(serial_number) = lower($2) LIMIT 2`, [c.organizationId, f.search])).rows;
  if (serial.length === 1) { f.serialId = serial[0].id; f.itemId ??= serial[0].item_id; f.exact = "serial"; f.search = null; return; }
  const batch = (await client.query(`SELECT id, item_id FROM tenant.stock_batches WHERE organization_id = $1 AND lower(batch_number) = lower($2) LIMIT 2`, [c.organizationId, f.search])).rows;
  if (batch.length === 1) { f.batchId = batch[0].id; f.itemId ??= batch[0].item_id; f.exact = "batch"; f.search = null; }
}

// The conditions every query shares. scope: the stock position the running balance runs over (item, warehouse, location, batch, serial,
// disposition — and the end date); listing: which of its rows show (everything else). bind() adds a parameter.
function conditions(f, visible, main, bind) {
  const scope = ["movement.organization_id = $1"];
  if (visible) scope.push(`movement.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (f.itemId) scope.push(`movement.item_id = ${bind(f.itemId)}`);
  if (f.warehouseId) scope.push(`movement.warehouse_id = ${bind(f.warehouseId)}`);
  if (main) scope.push(main.is_default_storage ? `movement.warehouse_location_id IS NULL AND movement.warehouse_id = ${bind(main.warehouse_id)}` : `movement.warehouse_location_id = ${bind(f.locationId)}`);
  if (f.batchId) scope.push(`movement.batch_id = ${bind(f.batchId)}`);
  if (f.serialId) scope.push(`movement.serial_id = ${bind(f.serialId)}`);
  if (f.disposition) scope.push(`movement.disposition = ${bind(f.disposition)}`);
  if (f.to) scope.push(`movement.occurred_at < ${bind(f.to)}::date + 1`);
  const listing = [];
  if (f.from) listing.push(`movement.occurred_at >= ${bind(f.from)}::date`);
  if (f.postedFrom) listing.push(`movement.created_at >= ${bind(f.postedFrom)}::date`);
  if (f.postedTo) listing.push(`movement.created_at < ${bind(f.postedTo)}::date + 1`);
  const kinds = [...new Set([...f.types, ...f.categories.flatMap(KINDS_OF)])];
  if (f.types.length && f.categories.length) {
    const both = f.types.filter((type) => f.categories.includes(CATEGORY_OF[type]));
    listing.push(`${ledgerKindSql()} = ANY(${bind(both)}::text[])`);
  } else if (kinds.length) listing.push(`${ledgerKindSql()} = ANY(${bind(kinds)}::text[])`);
  if (f.direction) listing.push(f.direction === "in" ? "movement.quantity > 0" : "movement.quantity < 0");
  if (f.categoryId) listing.push(`item.group_id = ${bind(f.categoryId)}`);
  if (f.postedBy) listing.push(`movement.created_by = ${bind(f.postedBy)}`);
  if (f.sourceType) listing.push(`movement_group.source_document_type = ${bind(f.sourceType)}`);
  if (f.sourceId) listing.push(`movement_group.source_document_id = ${bind(f.sourceId)}`);
  if (f.tracking === "batch") listing.push("movement.batch_id IS NOT NULL");
  if (f.tracking === "serial") listing.push("movement.serial_id IS NOT NULL");
  if (f.backdated) listing.push(backdatedSql());
  const reversedSql = "EXISTS (SELECT 1 FROM tenant.stock_movements later WHERE later.organization_id = movement.organization_id AND later.reversed_movement_id = movement.id)";
  if (f.status === "reversed") listing.push(reversedSql);
  if (f.status === "reversal") listing.push("movement.reversed_movement_id IS NOT NULL");
  if (f.status === "reversal_related") listing.push(`(movement.reversed_movement_id IS NOT NULL OR ${reversedSql})`);
  if (f.status === "active") listing.push(`(movement.reversed_movement_id IS NULL AND NOT ${reversedSql})`);
  if (f.reference) {
    const term = bind(`%${f.reference.toUpperCase()}%`);
    listing.push(`(upper(COALESCE(movement_group.source_document_number, '')) LIKE ${term} OR upper(movement.movement_number) LIKE ${term})`);
  }
  if (f.search) {
    const term = bind(`%${f.search.toLowerCase()}%`);
    listing.push(`(lower(concat_ws(' ', item.code, item.name, item.barcode, movement.item_code_snapshot, movement.item_name_snapshot, movement_group.source_document_number,
        movement.movement_number, batch.batch_number, serial.serial_number)) LIKE ${term} OR ${relatedSearchSql(term)})`);
  }
  return { scope, listing };
}

// The documents behind a posting that a user searches by: the purchase order and supplier delivery note of a receipt or return, the sales
// order and customer PO of a delivery or sales return, the reference of a transfer, adjustment or goods issue.
const relatedSearchSql = (term) => `EXISTS (
    SELECT 1 FROM tenant.goods_receipts gr JOIN tenant.purchase_orders po ON po.organization_id = gr.organization_id AND po.id = gr.purchase_order_id
     WHERE movement_group.source_document_type = 'goods_receipt' AND gr.organization_id = movement.organization_id AND gr.id = movement_group.source_document_id
       AND lower(concat_ws(' ', po.purchase_order_number, gr.supplier_delivery_note)) LIKE ${term}
    UNION ALL SELECT 1 FROM tenant.purchase_returns pr JOIN tenant.purchase_orders po ON po.organization_id = pr.organization_id AND po.id = pr.purchase_order_id
     WHERE movement_group.source_document_type = 'purchase_return' AND pr.organization_id = movement.organization_id AND pr.id = movement_group.source_document_id
       AND lower(concat_ws(' ', po.purchase_order_number, pr.supplier_rma_reference)) LIKE ${term}
    UNION ALL SELECT 1 FROM tenant.sales_fulfillment_requests delivery JOIN tenant.sales_orders so ON so.organization_id = delivery.organization_id AND so.id = delivery.sales_order_id
     WHERE movement_group.source_document_type = 'sales_delivery' AND delivery.organization_id = movement.organization_id AND delivery.id = movement_group.source_document_id
       AND lower(concat_ws(' ', so.sales_order_number, delivery.customer_po_number)) LIKE ${term}
    UNION ALL SELECT 1 FROM tenant.sales_returns sr LEFT JOIN tenant.sales_orders so ON so.organization_id = sr.organization_id AND so.id = sr.sales_order_id
     WHERE movement_group.source_document_type = 'sales_return' AND sr.organization_id = movement.organization_id AND sr.id = movement_group.source_document_id
       AND lower(concat_ws(' ', so.sales_order_number, sr.customer_po_number)) LIKE ${term}
    UNION ALL SELECT 1 FROM tenant.inventory_transfers tr WHERE movement_group.source_document_type = 'inventory_transfer' AND tr.organization_id = movement.organization_id
       AND tr.id = movement_group.source_document_id AND lower(concat_ws(' ', tr.reference, tr.transport_reference)) LIKE ${term}
    UNION ALL SELECT 1 FROM tenant.inventory_adjustments adj WHERE movement_group.source_document_type = 'inventory_adjustment' AND adj.organization_id = movement.organization_id
       AND adj.id = movement_group.source_document_id AND lower(concat_ws(' ', adj.reference, adj.count_reference)) LIKE ${term}
    UNION ALL SELECT 1 FROM tenant.goods_issues gi WHERE movement_group.source_document_type = 'goods_issue' AND gi.organization_id = movement.organization_id
       AND gi.id = movement_group.source_document_id AND lower(concat_ws(' ', gi.external_reference, gi.issue_to_text)) LIKE ${term})`;

// ---------------------------------------------------------------- one leg, read
const LEG_FROM = `
    FROM tenant.stock_movements movement
    JOIN tenant.stock_movement_groups movement_group ON movement_group.organization_id = movement.organization_id AND movement_group.id = movement.movement_group_id
    JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
    LEFT JOIN tenant.units_of_measure base_uom ON base_uom.organization_id = movement.organization_id AND base_uom.id = movement.base_uom_id
    LEFT JOIN tenant.units_of_measure entered_uom ON entered_uom.organization_id = movement.organization_id AND entered_uom.id = movement.entered_uom_id
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
    LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
    LEFT JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id
    LEFT JOIN tenant.stock_serials serial ON serial.organization_id = movement.organization_id AND serial.id = movement.serial_id
    LEFT JOIN public.users poster ON poster.id = movement.created_by`;
// The other side of an internal leg: the leg of the same posting that moved the same unit the other way (same item, batch and serial).
const COUNTERPART = `
    LEFT JOIN LATERAL (
      SELECT other.warehouse_id, other.warehouse_location_id, other.disposition, other_warehouse.code AS warehouse_code, other_warehouse.system_role,
             COALESCE(other_location.code, 'MAIN') AS location_code
        FROM tenant.stock_movements other
        JOIN tenant.warehouses other_warehouse ON other_warehouse.organization_id = other.organization_id AND other_warehouse.id = other.warehouse_id
        LEFT JOIN tenant.warehouse_locations other_location ON other_location.organization_id = other.organization_id AND other_location.id = other.warehouse_location_id
       WHERE other.organization_id = movement.organization_id AND other.movement_group_id = movement.movement_group_id AND other.item_id = movement.item_id
         AND sign(other.quantity) = -sign(movement.quantity) AND other.batch_id IS NOT DISTINCT FROM movement.batch_id AND other.serial_id IS NOT DISTINCT FROM movement.serial_id
       ORDER BY abs(other.quantity + movement.quantity), other.ledger_sequence LIMIT 1) counterpart ON true`;
const LEG_COLUMNS = (cost) => `movement.id, movement.movement_number, movement.ledger_sequence, movement.ledger_type, ${ledgerKindSql()} AS kind, movement.quantity, movement.occurred_at,
    movement.created_at, movement.created_by, movement.reason, movement.disposition, movement.source_line_id, movement.reversed_movement_id, movement.movement_group_id,
    movement.entered_quantity, movement.entered_conversion_factor, movement.item_id, movement.warehouse_id, movement.warehouse_location_id, movement.batch_id, movement.serial_id,
    movement.item_code_snapshot, movement.item_name_snapshot,
    movement_group.source_document_type, movement_group.source_document_id, movement_group.source_document_number, movement_group.operation_type, movement_group.reversal_of_group_id,
    item.code AS sku, item.name AS item_name, item.tracking_type, base_uom.code AS base_uom, entered_uom.code AS entered_uom,
    warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, warehouse.system_role, COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number, serial.serial_number,
    poster.full_name AS posted_by_name, ${backdatedSql()} AS backdated,
    counterpart.warehouse_code AS other_warehouse, counterpart.system_role AS other_system_role, counterpart.location_code AS other_location, counterpart.disposition AS other_disposition,
    (SELECT reversal.id FROM tenant.stock_movements reversal WHERE reversal.organization_id = movement.organization_id AND reversal.reversed_movement_id = movement.id) AS reversed_by_id,
    (SELECT reversal.movement_group_id FROM tenant.stock_movements reversal WHERE reversal.organization_id = movement.organization_id AND reversal.reversed_movement_id = movement.id) AS reversed_by_group_id,
    NOT EXISTS (SELECT 1 FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = movement.organization_id AND entry.movement_id = movement.id AND entry.entry_kind = 'movement') AS valuation_missing,
    EXISTS (SELECT 1 FROM tenant.negative_stock_overrides override WHERE override.organization_id = movement.organization_id AND override.movement_id = movement.id) AS negative_override,
    ((item.tracking_type = 'batch' AND movement.batch_id IS NULL) OR (item.tracking_type = 'serial' AND movement.serial_id IS NULL)) AS tracking_exception
    ${cost ? `, (SELECT sum(entry.value_delta) + COALESCE((SELECT sum(restatement.value_delta) FROM tenant.inventory_valuation_entries restatement
               WHERE restatement.organization_id = movement.organization_id AND restatement.restates_entry_id = ANY(array_agg(entry.id))), 0)
          FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = movement.organization_id AND entry.movement_id = movement.id AND entry.entry_kind = 'movement') AS value,
        (SELECT entry.base_unit_cost FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = movement.organization_id AND entry.movement_id = movement.id
          AND entry.entry_kind = 'movement' LIMIT 1) AS unit_cost` : ""}`;

const SOURCE_LABEL = Object.freeze({
  opening_stock: "Opening Stock", goods_receipt: "Goods Receipt", purchase_return: "Purchase Return", sales_delivery: "Sales Delivery", sales_return: "Sales Return",
  stock_transfer: "Stock Transfer", stock_count: "Stock Count", stock_adjustment: "Manual adjustment", receiving_rejection: "Receiving Rejection",
  manufacturing_work_order: "Production Order", pos_sale: "POS Sale", pos_return: "POS Return", goods_issue: "Goods Issue", inventory_transfer: "Transfer",
  inventory_adjustment: "Stock Adjustment", inventory_stock_hold: "Quality Hold",
});
// Where stock was: "PUN-01 / RACK-A", with its disposition when it is not available stock, or "In transit".
const position = (warehouse, location, disposition, systemRole) => {
  if (systemRole === "in_transit") return "In transit";
  const place = `${warehouse} / ${location}`;
  return disposition && disposition !== "available" ? `${place} · ${DISPOSITIONS[disposition] ?? disposition}` : place;
};
// The outside party a one-sided leg came from or went to.
function party(kind, sourceType, names, sourceId) {
  const named = names.get(sourceId);
  switch (kind) {
    case "opening_stock": return "Opening balance";
    case "purchase_receipt": return named ? `Supplier · ${named}` : "Supplier";
    case "purchase_return": return named ? `Supplier · ${named}` : "Supplier";
    case "sales_delivery": return named ? `Customer · ${named}` : "Customer";
    case "sales_return": return named ? `Customer · ${named}` : "Customer";
    case "goods_issue": return named ?? "Internal consumption";
    case "production_receipt": case "production_issue": return "Production";
    case "adjustment_in": case "adjustment_out": return sourceType === "inventory_transfer" ? "Transit loss" : named ?? "Stock adjustment";
    case "reversal": return "Reversal";
    default: return "—";
  }
}

// The names the paths show: the supplier of a receipt or purchase return, the customer of a delivery or sales return, the recipient of a goods
// issue, and whether an adjustment came from a physical count.
async function partyNames(client, organizationId, rows) {
  const by = (type) => [...new Set(rows.filter((row) => row.source_document_type === type).map((row) => row.source_document_id))];
  const names = new Map();
  const add = (result) => result.rows.forEach((row) => names.set(row.id, row.name));
  if (by("goods_receipt").length) add(await client.query(`SELECT gr.id, party.display_name AS name FROM tenant.goods_receipts gr
      JOIN tenant.purchase_orders po ON po.organization_id = gr.organization_id AND po.id = gr.purchase_order_id
      JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id WHERE gr.organization_id = $1 AND gr.id = ANY($2::uuid[])`, [organizationId, by("goods_receipt")]));
  if (by("purchase_return").length) add(await client.query(`SELECT pr.id, party.display_name AS name FROM tenant.purchase_returns pr
      JOIN tenant.purchase_orders po ON po.organization_id = pr.organization_id AND po.id = pr.purchase_order_id
      JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id WHERE pr.organization_id = $1 AND pr.id = ANY($2::uuid[])`, [organizationId, by("purchase_return")]));
  if (by("sales_delivery").length) add(await client.query(`SELECT id, customer_snapshot->>'displayName' AS name FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [organizationId, by("sales_delivery")]));
  if (by("sales_return").length) add(await client.query(`SELECT id, customer_snapshot->>'displayName' AS name FROM tenant.sales_returns WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [organizationId, by("sales_return")]));
  if (by("goods_issue").length) add(await client.query(`SELECT gi.id, COALESCE(NULLIF(gi.issue_to_text, ''), reason.name) AS name FROM tenant.goods_issues gi
      LEFT JOIN tenant.goods_issue_reasons reason ON reason.organization_id = gi.organization_id AND reason.id = gi.reason_id WHERE gi.organization_id = $1 AND gi.id = ANY($2::uuid[])`,
    [organizationId, by("goods_issue")]));
  if (by("inventory_adjustment").length) add(await client.query(`SELECT id, CASE WHEN physical_count_id IS NOT NULL OR stock_count_id IS NOT NULL THEN 'Physical count' ELSE 'Stock adjustment' END AS name
      FROM tenant.inventory_adjustments WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, by("inventory_adjustment")]));
  return names;
}

function toLeg(row, { cost, names, balance = false }) {
  const quantity = n(row.quantity);
  const kind = row.kind;
  const here = position(row.warehouse_code, row.location_code, row.disposition, row.system_role);
  const internal = INTERNAL_KINDS.includes(kind) || (kind === "reversal" && row.other_warehouse);
  const there = row.other_warehouse ? position(row.other_warehouse, row.other_location, row.other_disposition, row.other_system_role) : null;
  const outside = party(kind === "reversal" ? "reversal" : kind, row.source_document_type, names, row.source_document_id);
  const flags = [
    row.reversed_by_id && "reversed", row.reversed_movement_id && "reversal", row.backdated && "backdated", row.valuation_missing && "valuation_missing",
    row.negative_override && "negative_stock_override", row.tracking_exception && "tracking_exception",
  ].filter(Boolean);
  return {
    id: row.id, number: row.movement_number, sequence: Number(row.ledger_sequence), groupId: row.movement_group_id,
    type: kind, typeLabel: LEDGER_TYPE_LABELS[kind] ?? kind, category: CATEGORY_OF[kind] ?? "adjustment",
    direction: internal ? "internal" : quantity > 0 ? "in" : "out", flow: quantity > 0 ? "in" : "out",
    effectiveAt: row.occurred_at, postedAt: row.created_at, postedBy: row.posted_by_name ?? null, backdated: Boolean(row.backdated),
    source: { type: row.source_document_type, label: SOURCE_LABEL[row.source_document_type] ?? row.source_document_type, id: row.source_document_id,
      number: row.source_document_number, lineId: row.source_line_id, href: ledgerSourceHref(row.source_document_type, row.source_document_id, row.id) },
    itemId: row.item_id, sku: row.sku, itemName: row.item_name, trackingType: row.tracking_type,
    atPosting: row.item_code_snapshot && (row.item_code_snapshot !== row.sku || row.item_name_snapshot !== row.item_name) ? { sku: row.item_code_snapshot, itemName: row.item_name_snapshot } : null,
    warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name, locationId: row.warehouse_location_id, location: row.location_code,
    disposition: row.disposition, dispositionLabel: DISPOSITIONS[row.disposition] ?? row.disposition,
    from: quantity < 0 ? here : internal && there ? there : outside, to: quantity > 0 ? here : internal && there ? there : outside,
    batchId: row.batch_id, batch: row.batch_number ?? null, serialId: row.serial_id, serial: row.serial_number ?? null,
    quantity, baseUom: row.base_uom,
    entered: row.entered_quantity === null ? null : { quantity: n(row.entered_quantity), uom: row.entered_uom, conversion: n(row.entered_conversion_factor) },
    balanceAfter: balance && row.running !== undefined && row.running !== null ? n(row.running) : null,
    reversesId: row.reversed_movement_id, reversedById: row.reversed_by_id ?? null, reversedByGroupId: row.reversed_by_group_id ?? null, reason: row.reason, flags,
    ...(cost ? { unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : n(row.unit_cost), value: money(row.value) } : {}),
  };
}

// The stock position the running balance is of, when the filters name one: an item (company-wide, or in one warehouse, location, batch,
// serial number or disposition). Across items there is no single balance, so none is shown.
async function balanceScope(client, c, f, main) {
  if (!f.itemId) return null;
  const item = (await client.query(`SELECT code, name FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.itemId])).rows[0];
  if (!item) throw new StockError(404, "Item not found.", "MOVEMENT_HISTORY_ITEM_NOT_FOUND");
  const parts = [item.code];
  if (f.warehouseId) parts.push((await client.query(`SELECT code FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.warehouseId])).rows[0]?.code ?? "warehouse");
  else parts.push("all warehouses");
  if (main) parts.push((await client.query(`SELECT code FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.locationId])).rows[0]?.code ?? "location");
  if (f.batchId) parts.push(`batch ${(await client.query(`SELECT batch_number FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.batchId])).rows[0]?.batch_number ?? ""}`);
  if (f.serialId) parts.push(`serial ${(await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.serialId])).rows[0]?.serial_number ?? ""}`);
  if (f.disposition) parts.push(DISPOSITIONS[f.disposition]);
  return { itemId: f.itemId, warehouseId: f.warehouseId, locationId: f.locationId, batchId: f.batchId, serialId: f.serialId, disposition: f.disposition, label: parts.join(" / ") };
}

async function prepare(client, c, filters) {
  need(c, P.view, "You do not have permission to view inventory movement history.");
  const f = readFilters(filters);
  const visible = await warehouseScope(client, c, f.warehouseId);
  await resolveSearch(client, c, f);
  if (f.serialId && !f.itemId) f.itemId = (await client.query(`SELECT item_id FROM tenant.stock_serials WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.serialId])).rows[0]?.item_id ?? null;
  if (f.batchId && !f.itemId) f.itemId = (await client.query(`SELECT item_id FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.batchId])).rows[0]?.item_id ?? null;
  const main = f.locationId
    ? (await client.query(`SELECT warehouse_id, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.locationId])).rows[0]
    : null;
  if (f.locationId && !main) throw new StockError(404, "Location not found.", "MOVEMENT_HISTORY_FILTER_INVALID");
  if (main && visible && !visible.includes(main.warehouse_id)) throw new StockError(403, "You do not have access to that warehouse's movements.", "MOVEMENT_HISTORY_WAREHOUSE_FORBIDDEN");
  return { f, visible, main, cost: can(c, P.viewCost) };
}

const cursorOf = (row) => String(row.ledger_sequence);
const readCursor = (cursor) => {
  if (!cursor) return null;
  if (!/^\d{1,18}$/.test(cursor)) throw invalid("The page cursor is invalid.");
  return cursor;
};

// ---------------------------------------------------------------- Item Movements
// One row per ledger leg, a page at a time. With an item named the rows carry the balance after each movement in effective order, over the
// scope the filters name (other filters — type, document, user… — pick rows without changing it); posted-date order shows no running balance,
// because the balance after a movement is a fact of effective chronology.
export async function getInventoryMovementHistory(client, c, filters = {}) {
  const { f, visible, main, cost } = await prepare(client, c, filters);
  const scope = await balanceScope(client, c, f, main);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const { scope: scoped, listing } = conditions(f, visible, main, bind);
  const showBalance = Boolean(scope) && f.sort === "effective";
  const time = f.sort === "posted" ? "movement.created_at" : "movement.occurred_at";
  const direction = f.order === "asc" ? "ASC" : "DESC";
  const page = [...listing];
  const cursor = readCursor(f.cursor);
  if (cursor) {
    const after = bind(cursor);
    page.push(`(${time}, movement.ledger_sequence) ${f.order === "asc" ? ">" : "<"} ((SELECT ${f.sort === "posted" ? "created_at" : "occurred_at"} FROM tenant.stock_movements WHERE ledger_sequence = ${after}::bigint), ${after}::bigint)`);
  }
  const running = showBalance ? "sum(movement.quantity) OVER (ORDER BY movement.occurred_at, movement.ledger_sequence)" : "NULL::numeric";
  const { rows } = await client.query(
    `WITH scoped AS (SELECT movement.id, ${running} AS running FROM tenant.stock_movements movement WHERE ${scoped.join(" AND ")})
     SELECT ${LEG_COLUMNS(cost)}, scoped.running ${LEG_FROM} JOIN scoped ON scoped.id = movement.id ${COUNTERPART}
      WHERE true${page.map((entry) => ` AND ${entry}`).join("")}
      ORDER BY ${time} ${direction}, movement.ledger_sequence ${direction} LIMIT ${bind(f.limit + 1)}`, values);
  const more = rows.length > f.limit;
  const pageRows = more ? rows.slice(0, f.limit) : rows;
  const names = await partyNames(client, c.organizationId, pageRows);

  // Totals over everything the filters select (not just the page); quantities add up only within one unit of measure.
  const totalValues = [c.organizationId];
  const totalBind = (value) => { totalValues.push(value); return `$${totalValues.length}`; };
  const total = conditions(f, visible, main, totalBind);
  const summary = (await client.query(
    `SELECT count(*) AS movements, count(DISTINCT movement.base_uom_id) AS units, count(DISTINCT movement.item_id) AS items,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.quantity > 0 AND ${ledgerKindSql()} <> ALL($${totalValues.length + 1}::text[])), 0) AS inbound,
            COALESCE(-sum(movement.quantity) FILTER (WHERE movement.quantity < 0 AND ${ledgerKindSql()} <> ALL($${totalValues.length + 1}::text[])), 0) AS outbound,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.quantity > 0 AND ${ledgerKindSql()} = ANY($${totalValues.length + 1}::text[])), 0) AS internal,
            min(base_uom.code) AS uom
       ${LEG_FROM} WHERE ${[...total.scope, ...total.listing].join(" AND ")}`, [...totalValues, INTERNAL_KINDS])).rows[0];
  const comparable = Number(summary.units) <= 1;
  return {
    rows: pageRows.map((row) => toLeg(row, { cost, names, balance: showBalance })),
    scope, balanceShown: showBalance, exact: f.exact ?? null, serial: f.serialId ? await serialIdentity(client, c, f.serialId, visible) : null,
    summary: { movements: Number(summary.movements), items: Number(summary.items), comparable, uom: comparable ? summary.uom : null,
      inbound: comparable ? n(summary.inbound) : null, outbound: comparable ? n(summary.outbound) : null, internal: comparable ? n(summary.internal) : null },
    nextCursor: more ? cursorOf(pageRows[pageRows.length - 1]) : null, sort: f.sort, order: f.order, view: f.view,
    canSeeCost: cost, canExport: can(c, P.export), canReconcile: can(c, P.reconcile),
  };
}
export const searchInventoryMovements = (client, c, search, filters = {}) => getInventoryMovementHistory(client, c, { ...filters, search });
export const getItemMovementHistory = (client, c, itemId, filters = {}) => getInventoryMovementHistory(client, c, { ...filters, itemId });
export const getWarehouseMovementHistory = (client, c, warehouseId, filters = {}) => getInventoryMovementHistory(client, c, { ...filters, warehouseId });
export const getLocationMovementHistory = (client, c, warehouseId, locationId, filters = {}) => getInventoryMovementHistory(client, c, { ...filters, warehouseId, locationId });
export const getBatchMovementHistory = (client, c, batchId, filters = {}) => getInventoryMovementHistory(client, c, { ...filters, batchId, sort: "effective", order: "asc" });
export const getSourceDocumentMovements = (client, c, sourceType, sourceId, filters = {}) => getInventoryMovementHistory(client, c, { ...filters, sourceType, sourceId, order: "asc" });

// ---------------------------------------------------------------- Transaction Events
// What a posting is called: "Transfer Dispatch", "Transfer Receipt #2", "Quality Hold", "Quality Release", "Goods Issue Reversal"…
// A posting's first ledger sequence: its place in the ledger.
const FIRST_SEQUENCE = (alias) => `(SELECT min(first_leg.ledger_sequence) FROM tenant.stock_movements first_leg WHERE first_leg.organization_id = ${alias}.organization_id
    AND first_leg.movement_group_id = ${alias}.id)`;

function eventLabel(row) {
  const kinds = row.kinds ?? [];
  const from = new Set(row.out_dispositions ?? []);
  const to = new Set(row.in_dispositions ?? []);
  if (row.reverses_group_id || (kinds.length && kinds.every((kind) => kind === "reversal")))
    return `${SOURCE_LABEL[row.source_document_type] ?? "Stock"} Reversal`;
  switch (row.operation_type) {
    case "transfer_dispatch": return "Transfer Dispatch";
    case "transfer_receipt": return row.receipt_number > 1 || row.receipt_count > 1 ? `Transfer Receipt #${row.receipt_number}` : "Transfer Receipt";
    case "transit_loss": return "Transit Loss";
    case "transfer": return "Direct Transfer";
    case "location_move": return "Internal Location Move";
    case "disposition_move": {
      if (to.has("quarantined") && from.has("quality_hold")) return "Quarantine Escalation";
      if (to.has("quarantined")) return "Quarantine";
      if (to.has("damaged")) return "Moved to Damaged";
      if (to.has("quality_hold")) return "Quality Hold";
      if (to.has("available")) return "Quality Release";
      return "Disposition Change";
    }
    default:
      if (kinds.includes("adjustment_in") && kinds.includes("adjustment_out")) return "Stock Adjustment";
      return LEDGER_TYPE_LABELS[kinds[0]] ?? SOURCE_LABEL[row.source_document_type] ?? row.operation_type;
  }
}
const eventCategory = (row) => {
  if (row.reverses_group_id) return "reversal";
  const categories = [...new Set((row.kinds ?? []).map((kind) => CATEGORY_OF[kind]))];
  return categories.length === 1 ? categories[0] : categories.includes("transfer") ? "transfer" : "adjustment";
};

// One row per posting the filters touch (a posting shows when any of its legs matches), with its legs summarised: items, the quantity that
// went in and out (internal postings: the quantity moved), from and to.
export async function getMovementGroups(client, c, filters = {}) {
  const { f, visible, main, cost } = await prepare(client, c, filters);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const { scope, listing } = conditions({ ...f, from: null, postedFrom: null, postedTo: null, backdated: false, to: null }, visible, main, bind);
  const groupConditions = [];
  if (f.from) groupConditions.push(`posting.effective_at >= ${bind(f.from)}::date`);
  if (f.to) groupConditions.push(`posting.effective_at < ${bind(f.to)}::date + 1`);
  if (f.postedFrom) groupConditions.push(`posting.posted_at >= ${bind(f.postedFrom)}::date`);
  if (f.postedTo) groupConditions.push(`posting.posted_at < ${bind(f.postedTo)}::date + 1`);
  if (f.backdated) groupConditions.push(groupBackdatedSql("posting"));
  if (f.groupId) groupConditions.push(`posting.id = ${bind(f.groupId)}`);
  const time = f.sort === "posted" ? "posting.posted_at" : "posting.effective_at";
  const direction = f.order === "asc" ? "ASC" : "DESC";
  if (f.cursor) {
    if (!UUID.test(f.cursor)) throw invalid("The page cursor is invalid.");
    const after = bind(f.cursor);
    groupConditions.push(`(${time}, ${FIRST_SEQUENCE("posting")}) ${f.order === "asc" ? ">" : "<"} ((SELECT ${f.sort === "posted" ? "posted_at" : "effective_at"} FROM tenant.stock_movement_groups WHERE id = ${after}::uuid),
      (SELECT min(ledger_sequence) FROM tenant.stock_movements WHERE movement_group_id = ${after}::uuid))`);
  }
  const visibleLegs = visible ? `AND leg.warehouse_id = ANY(${bind(visible)}::uuid[])` : "";
  const { rows } = await client.query(
    `SELECT posting.*, poster.full_name AS posted_by_name, ${groupBackdatedSql("posting")} AS backdated, legs.*,
            COALESCE((SELECT later.id FROM tenant.stock_movement_groups later WHERE later.organization_id = posting.organization_id AND later.reversal_of_group_id = posting.id LIMIT 1),
              (SELECT reversal.movement_group_id FROM tenant.stock_movements original JOIN tenant.stock_movements reversal ON reversal.organization_id = original.organization_id
                 AND reversal.reversed_movement_id = original.id WHERE original.organization_id = posting.organization_id AND original.movement_group_id = posting.id LIMIT 1)) AS reversed_by_group_id,
            COALESCE(posting.reversal_of_group_id, (SELECT original.movement_group_id FROM tenant.stock_movements reversal JOIN tenant.stock_movements original
                 ON original.organization_id = reversal.organization_id AND original.id = reversal.reversed_movement_id
               WHERE reversal.organization_id = posting.organization_id AND reversal.movement_group_id = posting.id LIMIT 1)) AS reverses_group_id,
            CASE WHEN posting.operation_type = 'transfer_receipt' THEN (SELECT count(*) FROM tenant.stock_movement_groups earlier WHERE earlier.organization_id = posting.organization_id
              AND earlier.source_document_id = posting.source_document_id AND earlier.operation_type = 'transfer_receipt'
              AND (earlier.posted_at, ${FIRST_SEQUENCE("earlier")}) <= (posting.posted_at, ${FIRST_SEQUENCE("posting")})) END AS receipt_number,
            CASE WHEN posting.operation_type = 'transfer_receipt' THEN (SELECT count(*) FROM tenant.stock_movement_groups every_receipt WHERE every_receipt.organization_id = posting.organization_id
              AND every_receipt.source_document_id = posting.source_document_id AND every_receipt.operation_type = 'transfer_receipt') END AS receipt_count
       FROM tenant.stock_movement_groups posting
       LEFT JOIN public.users poster ON poster.id = posting.posted_by
       JOIN LATERAL (
         SELECT count(*) AS leg_count, count(DISTINCT leg.item_id) AS item_count, count(DISTINCT leg.base_uom_id) AS unit_count, min(leg_uom.code) AS uom,
                min(leg_item.code) AS first_sku, min(leg_item.name) AS first_item,
                COALESCE(sum(leg.quantity) FILTER (WHERE leg.quantity > 0), 0) AS quantity_in, COALESCE(-sum(leg.quantity) FILTER (WHERE leg.quantity < 0), 0) AS quantity_out,
                array_agg(DISTINCT ${ledgerKindSql("leg", "posting")}) AS kinds,
                array_agg(DISTINCT leg.disposition) FILTER (WHERE leg.quantity < 0) AS out_dispositions, array_agg(DISTINCT leg.disposition) FILTER (WHERE leg.quantity > 0) AS in_dispositions,
                array_agg(DISTINCT CASE WHEN leg_warehouse.system_role = 'in_transit' THEN 'In transit' ELSE leg_warehouse.code || ' / ' || COALESCE(leg_location.code, 'MAIN') END) FILTER (WHERE leg.quantity < 0) AS out_positions,
                array_agg(DISTINCT CASE WHEN leg_warehouse.system_role = 'in_transit' THEN 'In transit' ELSE leg_warehouse.code || ' / ' || COALESCE(leg_location.code, 'MAIN') END) FILTER (WHERE leg.quantity > 0) AS in_positions,
                bool_or(EXISTS (SELECT 1 FROM tenant.negative_stock_overrides override WHERE override.organization_id = leg.organization_id AND override.movement_id = leg.id)) AS negative_override,
                bool_or(NOT EXISTS (SELECT 1 FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = leg.organization_id AND entry.movement_id = leg.id AND entry.entry_kind = 'movement')) AS valuation_missing
                ${cost ? `, (SELECT COALESCE(sum(entry.value_delta), 0) FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = posting.organization_id
                    AND entry.movement_id = ANY(array_agg(leg.id))) AS value` : ""}
           FROM tenant.stock_movements leg
           JOIN tenant.items leg_item ON leg_item.organization_id = leg.organization_id AND leg_item.id = leg.item_id
           JOIN tenant.warehouses leg_warehouse ON leg_warehouse.organization_id = leg.organization_id AND leg_warehouse.id = leg.warehouse_id
           LEFT JOIN tenant.warehouse_locations leg_location ON leg_location.organization_id = leg.organization_id AND leg_location.id = leg.warehouse_location_id
           LEFT JOIN tenant.units_of_measure leg_uom ON leg_uom.organization_id = leg.organization_id AND leg_uom.id = leg.base_uom_id
          WHERE leg.organization_id = posting.organization_id AND leg.movement_group_id = posting.id ${visibleLegs}) legs ON legs.leg_count > 0
      WHERE posting.organization_id = $1
        AND EXISTS (SELECT 1 ${LEG_FROM} WHERE movement.movement_group_id = posting.id AND ${[...scope, ...listing].join(" AND ")})
        ${groupConditions.map((entry) => ` AND ${entry}`).join("")}
      ORDER BY ${time} ${direction}, ${FIRST_SEQUENCE("posting")} ${direction} LIMIT ${bind(f.limit + 1)}`, values);
  const more = rows.length > f.limit;
  const pageRows = more ? rows.slice(0, f.limit) : rows;
  const names = await partyNames(client, c.organizationId, pageRows);
  return {
    rows: pageRows.map((row) => toEvent(row, { cost, names })),
    nextCursor: more ? pageRows[pageRows.length - 1].id : null, sort: f.sort, order: f.order, view: f.view, exact: f.exact ?? null,
    canSeeCost: cost, canExport: can(c, P.export),
  };
}

function toEvent(row, { cost, names }) {
  const kinds = row.kinds ?? [];
  const category = eventCategory(row);
  const internal = ["transfer", "disposition"].includes(category) || (category === "reversal" && (row.out_positions?.length ?? 0) > 0 && (row.in_positions?.length ?? 0) > 0);
  const outside = party(kinds[0], row.source_document_type, names, row.source_document_id);
  const single = Number(row.unit_count) <= 1;
  const flags = [row.reversed_by_group_id && "reversed", row.reverses_group_id && "reversal", row.backdated && "backdated", row.valuation_missing && "valuation_missing",
    row.negative_override && "negative_stock_override"].filter(Boolean);
  return {
    id: row.id, label: eventLabel(row), category, operation: row.operation_type, direction: internal ? "internal" : Number(row.quantity_in) > 0 && Number(row.quantity_out) === 0 ? "in"
      : Number(row.quantity_out) > 0 && Number(row.quantity_in) === 0 ? "out" : "mixed",
    effectiveAt: row.effective_at, postedAt: row.posted_at, postedBy: row.posted_by_name ?? null, backdated: Boolean(row.backdated), reason: row.reason,
    source: { type: row.source_document_type, label: SOURCE_LABEL[row.source_document_type] ?? row.source_document_type, id: row.source_document_id,
      number: row.source_document_number, href: ledgerSourceHref(row.source_document_type, row.source_document_id, null) },
    items: Number(row.item_count), legs: Number(row.leg_count), item: Number(row.item_count) === 1 ? { sku: row.first_sku, name: row.first_item } : null,
    uom: single ? row.uom : null, quantityIn: single ? n(row.quantity_in) : null, quantityOut: single ? n(row.quantity_out) : null,
    quantity: single ? n(internal ? row.quantity_in || row.quantity_out : Math.max(Number(row.quantity_in), Number(row.quantity_out))) : null,
    from: row.out_positions?.length ? row.out_positions.join(", ") : outside, to: row.in_positions?.length ? row.in_positions.join(", ") : outside,
    reversalOfGroupId: row.reverses_group_id ?? null, reversedByGroupId: row.reversed_by_group_id ?? null, flags,
    ...(cost ? { value: money(row.value) } : {}),
  };
}

// ---------------------------------------------------------------- one event, in full
// A posting with its legs (each with the balance of its exact stock position after it), the document chain it belongs to, the other postings
// of the same document (dispatch ↔ receipts, hold ↔ release, original ↔ reversal), the reservation it consumed, its valuation and journals.
export async function getMovementHistoryDetail(client, c, groupId) {
  need(c, P.view, "You do not have permission to view inventory movement history.");
  const id = uuidOrNull(groupId, "Movement");
  const visible = await visibleWarehouseIds(client, c);
  const cost = can(c, P.viewCost);
  const head = (await client.query(`SELECT movement_group.id FROM tenant.stock_movement_groups movement_group WHERE movement_group.organization_id = $1 AND movement_group.id = $2`,
    [c.organizationId, id])).rows[0];
  if (!head) throw new StockError(404, "Movement not found.", "MOVEMENT_NOT_FOUND");
  const legsRaw = (await client.query(
    `SELECT ${LEG_COLUMNS(cost)},
            (SELECT sum(position.quantity) FROM tenant.stock_movements position WHERE position.organization_id = movement.organization_id AND position.item_id = movement.item_id
               AND position.warehouse_id = movement.warehouse_id AND position.warehouse_location_id IS NOT DISTINCT FROM movement.warehouse_location_id
               AND position.batch_id IS NOT DISTINCT FROM movement.batch_id AND position.serial_id IS NOT DISTINCT FROM movement.serial_id
               AND (position.occurred_at, position.ledger_sequence) <= (movement.occurred_at, movement.ledger_sequence)) AS running,
            (SELECT sum(stock.quantity) FROM tenant.stock_movements stock WHERE stock.organization_id = movement.organization_id AND stock.item_id = movement.item_id
               AND stock.warehouse_id = movement.warehouse_id AND (stock.occurred_at, stock.ledger_sequence) <= (movement.occurred_at, movement.ledger_sequence)) AS warehouse_after
       ${LEG_FROM} ${COUNTERPART} WHERE movement.organization_id = $1 AND movement.movement_group_id = $2 ORDER BY movement.ledger_sequence`, [c.organizationId, id])).rows;
  const legs = legsRaw.filter((leg) => !visible || visible.includes(leg.warehouse_id));
  if (!legs.length) throw new StockError(404, "Movement not found.", "MOVEMENT_NOT_FOUND");
  const event = (await getMovementGroups(client, c, { groupId: id, limit: 1 })).rows[0] ?? null;
  const names = await partyNames(client, c.organizationId, legs);
  const related = (await getMovementGroups(client, c, { sourceType: legs[0].source_document_type, sourceId: legs[0].source_document_id, limit: 200, order: "asc", sort: "posted" })).rows
    .filter((row) => row.id !== id);
  const reversalOf = event?.reversalOfGroupId ? (await getMovementGroups(client, c, { groupId: event.reversalOfGroupId, limit: 1 })).rows[0] ?? null : null;
  const reversedBy = event?.reversedByGroupId ? (await getMovementGroups(client, c, { groupId: event.reversedByGroupId, limit: 1 })).rows[0] ?? null : null;
  // The reservation this posting consumed (a delivery that shipped reserved stock): shown as context, never as a movement.
  const reservations = (await client.query(
    `SELECT reservation.id, reservation.reservation_number, event.quantity, event.created_at FROM tenant.stock_reservation_events event
       JOIN tenant.stock_reservations reservation ON reservation.organization_id = event.organization_id AND reservation.id = event.reservation_id
      WHERE event.organization_id = $1 AND event.event_type = 'consumed' AND event.details->>'movementId' = ANY($2::text[]) ORDER BY event.created_at`,
    [c.organizationId, legs.map((leg) => leg.id)])).rows.map((row) => ({ id: row.id, number: row.reservation_number, quantity: n(row.quantity), at: row.created_at, href: `/inventory/reservations/${row.id}` }));
  const finance = cost || can(c, "accounting.view") ? await financeOf(client, c, legs[0], legs) : null;
  return {
    event, legs: legs.map((leg) => ({ ...toLeg(leg, { cost, names }), positionAfter: n(leg.running), warehouseAfter: n(leg.warehouse_after) })),
    hiddenLegs: legsRaw.length - legs.length, origin: await originOf(client, c, legs[0]), related, reversalOf, reversedBy,
    transfer: legs[0].source_document_type === "inventory_transfer" ? await getTransferMovementHistory(client, c, legs[0].source_document_id) : null,
    reservations, finance,
    links: { source: ledgerSourceHref(legs[0].source_document_type, legs[0].source_document_id, legs[0].id), stockLedger: `/inventory/stock-ledger?sourceId=${legs[0].source_document_id}`,
      reconciliation: "/inventory/stock-ledger" },
  };
}

// The documents around a posting: the order a receipt or delivery fulfilled, the count an adjustment came from, the recipient of an issue, the
// case a quality move belongs to. Read from the documents themselves, never copied.
async function originOf(client, c, leg) {
  const org = c.organizationId;
  const id = leg.source_document_id;
  const one = async (sql) => (await client.query(sql, [org, id])).rows[0] ?? null;
  switch (leg.source_document_type) {
    case "goods_receipt": {
      const row = await one(`SELECT gr.receipt_number, po.id AS po_id, po.purchase_order_number, party.display_name AS supplier, gr.supplier_delivery_note FROM tenant.goods_receipts gr
          JOIN tenant.purchase_orders po ON po.organization_id = gr.organization_id AND po.id = gr.purchase_order_id
          JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id WHERE gr.organization_id = $1 AND gr.id = $2`);
      return row && { chain: [{ label: "Purchase Order", number: row.purchase_order_number, href: `/procurement/purchase-orders/${row.po_id}` },
        { label: "Goods Receipt", number: row.receipt_number, href: `/procurement/goods-receipts/${id}` }], party: row.supplier, reference: row.supplier_delivery_note };
    }
    case "purchase_return": {
      const row = await one(`SELECT pr.return_number, po.id AS po_id, po.purchase_order_number, party.display_name AS supplier, pr.goods_receipt_id, gr.receipt_number FROM tenant.purchase_returns pr
          JOIN tenant.purchase_orders po ON po.organization_id = pr.organization_id AND po.id = pr.purchase_order_id
          JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
          LEFT JOIN tenant.goods_receipts gr ON gr.organization_id = pr.organization_id AND gr.id = pr.goods_receipt_id WHERE pr.organization_id = $1 AND pr.id = $2`);
      return row && { chain: [{ label: "Purchase Order", number: row.purchase_order_number, href: `/procurement/purchase-orders/${row.po_id}` },
        ...(row.goods_receipt_id ? [{ label: "Goods Receipt", number: row.receipt_number, href: `/procurement/goods-receipts/${row.goods_receipt_id}` }] : []),
        { label: "Purchase Return", number: row.return_number, href: `/procurement/purchase-returns/${id}` }], party: row.supplier };
    }
    case "sales_delivery": {
      const row = await one(`SELECT delivery.request_number, so.id AS so_id, so.sales_order_number, delivery.customer_snapshot->>'displayName' AS customer, delivery.customer_po_number
          FROM tenant.sales_fulfillment_requests delivery JOIN tenant.sales_orders so ON so.organization_id = delivery.organization_id AND so.id = delivery.sales_order_id
         WHERE delivery.organization_id = $1 AND delivery.id = $2`);
      return row && { chain: [{ label: "Sales Order", number: row.sales_order_number, href: `/sales/orders/${row.so_id}` },
        { label: "Delivery", number: row.request_number, href: `/sales/deliveries/${id}` }], party: row.customer, reference: row.customer_po_number };
    }
    case "sales_return": {
      const row = await one(`SELECT sr.return_number, so.id AS so_id, so.sales_order_number, sr.delivery_id, delivery.request_number, sr.customer_snapshot->>'displayName' AS customer
          FROM tenant.sales_returns sr LEFT JOIN tenant.sales_orders so ON so.organization_id = sr.organization_id AND so.id = sr.sales_order_id
          LEFT JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = sr.organization_id AND delivery.id = sr.delivery_id WHERE sr.organization_id = $1 AND sr.id = $2`);
      return row && { chain: [...(row.so_id ? [{ label: "Sales Order", number: row.sales_order_number, href: `/sales/orders/${row.so_id}` }] : []),
        ...(row.delivery_id ? [{ label: "Delivery", number: row.request_number, href: `/sales/deliveries/${row.delivery_id}` }] : []),
        { label: "Sales Return", number: row.return_number, href: `/sales/returns/${id}` }], party: row.customer };
    }
    case "inventory_adjustment": {
      const row = await one(`SELECT adj.document_number, adj.physical_count_id, count.document_number AS count_number, reason.name AS reason FROM tenant.inventory_adjustments adj
          LEFT JOIN tenant.physical_inventory_counts count ON count.organization_id = adj.organization_id AND count.id = adj.physical_count_id
          LEFT JOIN tenant.inventory_adjustment_reasons reason ON reason.organization_id = adj.organization_id AND reason.id = adj.reason_id WHERE adj.organization_id = $1 AND adj.id = $2`);
      return row && { chain: [...(row.physical_count_id ? [{ label: "Physical Count", number: row.count_number, href: `/inventory/stock-counts/${row.physical_count_id}` }] : []),
        { label: "Stock Adjustment", number: row.document_number, href: `/inventory/adjustments/${id}` }], reason: row.reason };
    }
    case "goods_issue": {
      const row = await one(`SELECT gi.document_number, reason.name AS reason, gi.issue_to_type, gi.issue_to_text, gi.project_id, gi.cost_center_id, gi.external_reference FROM tenant.goods_issues gi
          LEFT JOIN tenant.goods_issue_reasons reason ON reason.organization_id = gi.organization_id AND reason.id = gi.reason_id WHERE gi.organization_id = $1 AND gi.id = $2`);
      return row && { chain: [{ label: "Goods Issue", number: row.document_number, href: `/inventory/goods-issues/${id}` }], reason: row.reason, party: row.issue_to_text,
        reference: row.external_reference, projectId: row.project_id, costCenterId: row.cost_center_id };
    }
    case "inventory_stock_hold": {
      const row = await one(`SELECT hold.document_number, hold.hold_type, reason.name AS reason FROM tenant.inventory_stock_holds hold
          LEFT JOIN tenant.inventory_hold_reasons reason ON reason.organization_id = hold.organization_id AND reason.id = hold.reason_id WHERE hold.organization_id = $1 AND hold.id = $2`);
      return row && { chain: [{ label: row.hold_type === "quarantine" ? "Quarantine" : "Quality Hold", number: row.document_number, href: `/inventory/quality-holds/${id}` }], reason: row.reason };
    }
    case "inventory_transfer": {
      const row = await one(`SELECT document_number FROM tenant.inventory_transfers WHERE organization_id = $1 AND id = $2`);
      return row && { chain: [{ label: "Transfer", number: row.document_number, href: `/inventory/transfers/${id}` }] };
    }
    case "opening_stock": {
      const row = await one(`SELECT document_number, migration_reference FROM tenant.opening_stocks WHERE organization_id = $1 AND id = $2`);
      return row && { chain: [{ label: "Opening Stock", number: row.document_number, href: `/inventory/opening-stock/${id}` }], reference: row.migration_reference };
    }
    default: return null;
  }
}

// The money side, read from Inventory Valuation and Finance: the value the posting carried and the journals of its document. A
// value-carrying posting of a document that journals stock, without its journal, is flagged; nothing is estimated.
const DOCUMENT_JOURNAL = Object.freeze({
  opening_stock: ["opening_stocks", "journal_entry_id"], goods_issue: ["goods_issues", "journal_entry_id"], inventory_adjustment: ["inventory_adjustments", "journal_entry_id"],
  sales_delivery: ["sales_fulfillment_requests", "cogs_journal_entry_id"], sales_return: ["sales_returns", "cogs_journal_entry_id"],
  goods_receipt: ["goods_receipts", "accrual_journal_entry_id"], purchase_return: ["purchase_returns", "accrual_journal_entry_id"],
});
async function financeOf(client, c, head, legs) {
  const cost = can(c, P.viewCost);
  const entries = cost ? (await client.query(
    `SELECT entry.movement_id, entry.value_delta, entry.base_unit_cost, entry.source_cost_type, entry.valuation_method, entry.balance_value_after, entry.journal_entry_id
       FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = $1 AND entry.movement_id = ANY($2::uuid[]) AND entry.entry_kind = 'movement'`,
    [c.organizationId, legs.map((leg) => leg.id)])).rows : [];
  const value = cost ? money(entries.reduce((sum, entry) => sum + Number(entry.value_delta), 0)) : null;
  const journals = can(c, "accounting.view")
    ? (await client.query(`SELECT id, entry_number, entry_date, status, source_type FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND (source_id = $2 OR id = ANY($3::uuid[]))
        ORDER BY entry_date, entry_number`, [c.organizationId, head.source_document_id, entries.map((entry) => entry.journal_entry_id).filter(Boolean)])).rows
      .map((row) => ({ id: row.id, number: row.entry_number, date: row.entry_date, status: row.status, sourceType: row.source_type, href: "/accounting/journals" }))
    : null;
  const document = DOCUMENT_JOURNAL[head.source_document_type];
  let journalExpected = false;
  let journalPosted = null;
  if (document && !head.reversal_of_group_id && !head.reversed_movement_id) {
    const row = (await client.query(`SELECT ${document[1]} AS journal FROM tenant.${document[0]} WHERE organization_id = $1 AND id = $2`, [c.organizationId, head.source_document_id])).rows[0];
    const carried = legs.some((leg) => !["location_transfer_in", "location_transfer_out", "disposition_in", "disposition_out"].includes(leg.ledger_type));
    journalExpected = carried;
    journalPosted = carried ? Boolean(row?.journal) : null;
  }
  return {
    value, valuationStatus: legs.some((leg) => leg.valuation_missing) ? "exception" : "valued",
    entries: cost ? entries.map((entry) => ({ movementId: entry.movement_id, value: money(entry.value_delta), unitCost: n(entry.base_unit_cost), costSource: entry.source_cost_type,
      method: entry.valuation_method, inventoryValueAfter: money(entry.balance_value_after) })) : null,
    journals, journalExpected, financeStatus: journalExpected ? (journalPosted ? "posted" : "not_posted") : "not_applicable",
    valuationHref: `/inventory/valuation?itemId=${head.item_id}`,
  };
}

// ---------------------------------------------------------------- journeys and lifecycles
// A serial number, identity first: the item, where it is now (warehouse, location, disposition), its reservation, then every movement of
// that unit in effective order, wherever it went.
async function serialIdentity(client, c, serialId, visible) {
  const row = (await client.query(
    `SELECT serial.id, serial.serial_number, serial.status, serial.item_id, item.code AS sku, item.name AS item_name, warehouse.code AS warehouse, warehouse.id AS warehouse_id,
            COALESCE(location.code, 'MAIN') AS location, COALESCE(location.disposition, 'available') AS disposition, batch.batch_number,
            (SELECT reservation.reservation_number FROM tenant.stock_reservations reservation WHERE reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id
               AND reservation.status = 'active' LIMIT 1) AS reservation
       FROM tenant.stock_serials serial JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = serial.organization_id AND warehouse.id = serial.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
      WHERE serial.organization_id = $1 AND serial.id = $2`, [c.organizationId, serialId])).rows[0];
  if (!row) return null;
  const inStock = row.status === "available";
  const shown = inStock && (!visible || visible.includes(row.warehouse_id));
  return { id: row.id, serialNumber: row.serial_number, itemId: row.item_id, sku: row.sku, itemName: row.item_name, status: row.status, inStock,
    warehouse: shown ? row.warehouse : null, location: shown ? row.location : null, disposition: shown ? row.disposition : null, batch: row.batch_number, reservation: row.reservation };
}
export async function getSerialMovementHistory(client, c, { serialId = null, serialNumber = null } = {}) {
  need(c, P.view, "You do not have permission to view inventory movement history.");
  const serial = (await client.query(`SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND (id = $2 OR lower(serial_number) = lower($3)) ORDER BY created_at LIMIT 1`,
    [c.organizationId, uuidOrNull(serialId, "Serial number"), text(serialNumber) ?? ""])).rows[0];
  if (!serial) throw new StockError(404, "Serial number not found.", "MOVEMENT_HISTORY_SERIAL_NOT_FOUND");
  const history = await getInventoryMovementHistory(client, c, { serialId: serial.id, sort: "effective", order: "asc", limit: 500 });
  return { serial: history.serial, movements: history.rows };
}

// A transfer's lifecycle from its lines and its postings: requested, dispatched, received, lost and still in transit, and each dispatch and
// receipt as its own event.
export async function getTransferMovementHistory(client, c, transferId) {
  need(c, P.view, "You do not have permission to view inventory movement history.");
  const id = uuidOrNull(transferId, "Transfer");
  const transfer = (await client.query(
    `SELECT transfer.id, transfer.document_number, transfer.status, transfer.transfer_mode, source.code AS source, destination.code AS destination,
            COALESCE(sum(line.base_quantity), 0) AS requested, COALESCE(sum(line.dispatched_base_quantity), 0) AS dispatched, COALESCE(sum(line.received_base_quantity), 0) AS received,
            COALESCE(sum(line.lost_base_quantity), 0) AS lost
       FROM tenant.inventory_transfers transfer
       JOIN tenant.warehouses source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_warehouse_id
       JOIN tenant.warehouses destination ON destination.organization_id = transfer.organization_id AND destination.id = transfer.destination_warehouse_id
       LEFT JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
      WHERE transfer.organization_id = $1 AND transfer.id = $2 GROUP BY transfer.id, source.code, destination.code`, [c.organizationId, id])).rows[0];
  if (!transfer) throw new StockError(404, "Transfer not found.", "MOVEMENT_HISTORY_TRANSFER_NOT_FOUND");
  const events = (await getMovementGroups(client, c, { sourceType: "inventory_transfer", sourceId: id, sort: "posted", order: "asc", limit: 500 })).rows;
  return {
    id: transfer.id, number: transfer.document_number, status: transfer.status, mode: transfer.transfer_mode, from: transfer.source, to: transfer.destination,
    requested: n(transfer.requested), dispatched: n(transfer.dispatched), received: n(transfer.received), lost: n(transfer.lost),
    inTransit: n(Number(transfer.dispatched) - Number(transfer.received) - Number(transfer.lost)), events, href: `/inventory/transfers/${id}`,
  };
}

// The stock of a position as of a moment (or as of one movement: up to and including it), by disposition, from the ledger.
export async function getMovementHistoryAsOf(client, c, { itemId, warehouseId = null, locationId = null, batchId = null, serialId = null, at = null, movementId = null } = {}) {
  need(c, P.view, "You do not have permission to view inventory movement history.");
  const visible = await warehouseScope(client, c, uuidOrNull(warehouseId, "Warehouse"));
  let item = uuidOrNull(itemId, "Item");
  let until = null;
  const movement = uuidOrNull(movementId, "Movement");
  if (movement) {
    const row = (await client.query(`SELECT item_id, occurred_at, ledger_sequence, warehouse_id FROM tenant.stock_movements WHERE organization_id = $1 AND id = $2`, [c.organizationId, movement])).rows[0];
    if (!row || (visible && !visible.includes(row.warehouse_id))) throw new StockError(404, "Movement not found.", "MOVEMENT_NOT_FOUND");
    item ??= row.item_id;
    until = row;
  }
  if (!item) throw invalid("Choose the item.");
  const moment = at ? new Date(at) : new Date();
  if (Number.isNaN(moment.getTime())) throw invalid("The date is invalid.");
  const { rows } = await client.query(
    `SELECT movement.disposition, COALESCE(sum(movement.quantity), 0) AS quantity FROM tenant.stock_movements movement
      WHERE movement.organization_id = $1 AND movement.item_id = $2 AND ($3::uuid IS NULL OR movement.warehouse_id = $3) AND ($4::uuid[] IS NULL OR movement.warehouse_id = ANY($4::uuid[]))
        AND ($5::uuid IS NULL OR movement.warehouse_location_id = $5) AND ($6::uuid IS NULL OR movement.batch_id = $6) AND ($7::uuid IS NULL OR movement.serial_id = $7)
        AND ${until ? "(movement.occurred_at, movement.ledger_sequence) <= ((SELECT occurred_at FROM tenant.stock_movements WHERE organization_id = $1 AND id = $8::uuid), $9::bigint)" : "movement.occurred_at <= $8::timestamptz"}
      GROUP BY movement.disposition`,
    [c.organizationId, item, uuidOrNull(warehouseId, "Warehouse"), visible, uuidOrNull(locationId, "Location"), uuidOrNull(batchId, "Batch"), uuidOrNull(serialId, "Serial number"),
      until ? movement : moment.toISOString(), ...(until ? [until.ledger_sequence] : [])]);
  const by = Object.fromEntries(rows.map((row) => [row.disposition, n(row.quantity)]));
  const onHand = n(rows.reduce((sum, row) => sum + Number(row.quantity), 0));
  return { itemId: item, at: until ? until.occurred_at : moment.toISOString(), movementId: movement, onHand, available: by.available ?? 0, qualityHold: by.quality_hold ?? 0,
    quarantined: by.quarantined ?? 0, damaged: by.damaged ?? 0 };
}
export async function getMovementBalanceAfter(client, c, movementId) {
  const row = (await client.query(`SELECT item_id, warehouse_id, warehouse_location_id, batch_id, serial_id FROM tenant.stock_movements WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, uuidOrNull(movementId, "Movement")])).rows[0];
  if (!row) throw new StockError(404, "Movement not found.", "MOVEMENT_NOT_FOUND");
  const [position, warehouse] = await Promise.all([
    getMovementHistoryAsOf(client, c, { movementId, itemId: row.item_id, warehouseId: row.warehouse_id, locationId: row.warehouse_location_id, batchId: row.batch_id, serialId: row.serial_id }),
    getMovementHistoryAsOf(client, c, { movementId, itemId: row.item_id, warehouseId: row.warehouse_id })]);
  return { position, warehouse };
}
export const getMovementValuation = async (client, c, groupId) => (await getMovementHistoryDetail(client, c, groupId)).finance;
export const getRelatedMovements = async (client, c, groupId) => (await getMovementHistoryDetail(client, c, groupId)).related;

// ---------------------------------------------------------------- integrity
// Movement History is the ledger read, so there is no projection to rebuild; this proves every posted movement is explainable: each belongs
// to a posting with a source document, each posting has legs, internal postings net to zero, and no posting key repeats.
export async function checkMovementHistoryIntegrity(client, c) {
  need(c, P.reconcile, "You do not have permission to reconcile the stock ledger.");
  const one = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  const [counts] = await one(`SELECT (SELECT count(*) FROM tenant.stock_movements WHERE organization_id = $1) AS movements,
      (SELECT count(*) FROM tenant.stock_movement_groups WHERE organization_id = $1) AS postings`);
  const unexplained = await one(`SELECT movement.id, movement.movement_number FROM tenant.stock_movements movement
      LEFT JOIN tenant.stock_movement_groups movement_group ON movement_group.organization_id = movement.organization_id AND movement_group.id = movement.movement_group_id
     WHERE movement.organization_id = $1 AND (movement_group.id IS NULL OR movement_group.source_document_type IS NULL OR movement_group.source_document_id IS NULL) LIMIT 50`);
  const empty = await one(`SELECT movement_group.id FROM tenant.stock_movement_groups movement_group WHERE movement_group.organization_id = $1
      AND NOT EXISTS (SELECT 1 FROM tenant.stock_movements movement WHERE movement.organization_id = movement_group.organization_id AND movement.movement_group_id = movement_group.id) LIMIT 50`);
  const unbalanced = await one(`SELECT movement_group.id, movement_group.source_document_number, sum(movement.quantity) AS net FROM tenant.stock_movement_groups movement_group
      JOIN tenant.stock_movements movement ON movement.organization_id = movement_group.organization_id AND movement.movement_group_id = movement_group.id
     WHERE movement_group.organization_id = $1 AND movement_group.operation_type IN ('location_move', 'disposition_move', 'transfer_dispatch', 'transfer_receipt', 'transfer')
     GROUP BY movement_group.id HAVING abs(sum(movement.quantity)) > 0.000001 LIMIT 50`);
  const duplicates = await one(`SELECT idempotency_key, count(*) AS times FROM tenant.stock_movements WHERE organization_id = $1 AND idempotency_key IS NOT NULL
      GROUP BY idempotency_key HAVING count(*) > 1 LIMIT 50`);
  return {
    movements: Number(counts.movements), postings: Number(counts.postings),
    unexplained: unexplained.map((row) => ({ id: row.id, number: row.movement_number })), emptyPostings: empty.map((row) => row.id),
    unbalanced: unbalanced.map((row) => ({ groupId: row.id, document: row.source_document_number, net: n(row.net) })), duplicates: duplicates.map((row) => ({ key: row.idempotency_key, times: Number(row.times) })),
    consistent: !unexplained.length && !empty.length && !unbalanced.length && !duplicates.length,
  };
}

// ---------------------------------------------------------------- export and options
export async function exportInventoryMovementHistory(client, c, filters = {}, format = "csv") {
  need(c, P.export, "You do not have permission to export inventory movement history.");
  const rows = [];
  let cursor = null;
  let first = null;
  do {
    const page = await getInventoryMovementHistory(client, c, { ...filters, limit: 500, cursor });
    first ??= page;
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor && rows.length < 50000);
  const cost = first.canSeeCost;
  const columns = [
    { key: "id", label: "Movement ID" }, { key: "groupId", label: "Movement Group ID" }, { key: "number", label: "Movement" }, { key: "effective", label: "Effective date" },
    { key: "posted", label: "Posted at" }, { key: "category", label: "Movement category" }, { key: "type", label: "Movement type" }, { key: "source", label: "Source document" },
    { key: "sourceType", label: "Source document type" }, { key: "sku", label: "SKU" }, { key: "item", label: "Item" },
    { key: "fromWarehouse", label: "From warehouse" }, { key: "fromLocation", label: "From location" }, { key: "toWarehouse", label: "To warehouse" }, { key: "toLocation", label: "To location" },
    { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "sourceDisposition", label: "Source disposition" }, { key: "destinationDisposition", label: "Destination disposition" },
    { key: "enteredQuantity", label: "Transaction qty" }, { key: "enteredUom", label: "Transaction UOM" }, { key: "quantity", label: "Base qty" }, { key: "baseUom", label: "Base UOM" },
    ...(first.balanceShown ? [{ key: "balance", label: "Balance after" }] : []), { key: "batch", label: "Batch" }, { key: "serial", label: "Serial" },
    { key: "postedBy", label: "Posted by" }, { key: "status", label: "Reversal status" }, { key: "flags", label: "Flags" },
    ...(cost ? [{ key: "unitCost", label: "Unit cost" }, { key: "value", label: "Movement value" }] : []),
  ];
  const data = rows.map((row) => {
    const outbound = row.quantity < 0;
    return {
      id: row.id, groupId: row.groupId, number: row.number, effective: new Date(row.effectiveAt).toISOString().slice(0, 10), posted: new Date(row.postedAt).toISOString(),
      category: MOVEMENT_CATEGORIES.find((entry) => entry.id === row.category)?.label ?? row.category, type: row.typeLabel, source: row.source.number ?? row.number,
      sourceType: row.source.label, sku: row.sku, item: row.itemName,
      fromWarehouse: outbound ? row.warehouse : null, fromLocation: outbound ? row.location : null, toWarehouse: outbound ? null : row.warehouse, toLocation: outbound ? null : row.location,
      from: row.from, to: row.to, sourceDisposition: outbound ? row.dispositionLabel : null, destinationDisposition: outbound ? null : row.dispositionLabel,
      enteredQuantity: row.entered?.quantity ?? Math.abs(row.quantity), enteredUom: row.entered?.uom ?? row.baseUom, quantity: row.quantity, baseUom: row.baseUom, balance: row.balanceAfter,
      batch: row.batch, serial: row.serial, postedBy: row.postedBy, status: row.reversedById ? "Reversed" : row.reversesId ? "Reversal" : "Posted", flags: row.flags.join(" "),
      unitCost: row.unitCost, value: row.value,
    };
  });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx")
    return { fileName: `movement-history-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsxWorkbook({ sheetName: "Movement history", columns, rows: data }), rowCount: data.length };
  return { fileName: `movement-history-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(columns, data), rowCount: data.length };
}

// What the page offers: saved views, categories, movement types, dispositions, source document types, the warehouses this user may see (with
// their locations), item categories and the people who posted movements.
export async function getMovementHistoryOptions(client, c) {
  need(c, P.view, "You do not have permission to view inventory movement history.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name, system_role FROM tenant.warehouses WHERE organization_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY system_role NULLS FIRST, is_default DESC, code`, [c.organizationId, visible])).rows;
  const locations = (await client.query(`SELECT id, warehouse_id, code, name FROM tenant.warehouse_locations WHERE organization_id = $1 AND allow_stock AND warehouse_id = ANY($2::uuid[])
      ORDER BY is_default_storage DESC, code`, [c.organizationId, warehouses.map((row) => row.id)])).rows;
  const categories = (await client.query(`SELECT id, name FROM tenant.item_groups WHERE organization_id = $1 ORDER BY name LIMIT 500`, [c.organizationId])).rows;
  const posters = (await client.query(`SELECT DISTINCT poster.id, poster.full_name FROM tenant.stock_movement_groups movement_group JOIN public.users poster ON poster.id = movement_group.posted_by
      WHERE movement_group.organization_id = $1 ORDER BY poster.full_name LIMIT 200`, [c.organizationId])).rows;
  return {
    views: MOVEMENT_HISTORY_VIEWS.map(({ id, label }) => ({ id, label })), categories: MOVEMENT_CATEGORIES,
    movementTypes: LEDGER_KINDS.map((id) => ({ id, label: LEDGER_TYPE_LABELS[id], category: CATEGORY_OF[id] })),
    dispositions: Object.entries(DISPOSITIONS).map(([id, label]) => ({ id, label })),
    sourceTypes: Object.entries(SOURCE_LABEL).map(([id, label]) => ({ id, label })),
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name, system: Boolean(row.system_role),
      locations: locations.filter((location) => location.warehouse_id === row.id).map((location) => ({ id: location.id, code: location.code, name: location.name })) })),
    itemCategories: categories, postedBy: posters.map((row) => ({ id: row.id, name: row.full_name })),
    canSeeCost: can(c, P.viewCost), canExport: can(c, P.export), canReconcile: can(c, P.reconcile),
  };
}
