import { StockError } from "./errors.js";

// The Stock Ledger's posting side: what a movement means (its ledger type), which document it belongs to (its movement group and source),
// and where in-transit stock sits. postStockMovement (index.js) is the only writer of tenant.stock_movements and uses these for every row.

// Inbound types are positive quantities, outbound negative; a reversal is the opposite of what it reverses.
export const INBOUND_LEDGER_TYPES = Object.freeze(["opening_stock", "purchase_receipt", "sales_return", "transfer_in", "transfer_to_transit", "adjustment_in",
  "location_transfer_in", "disposition_in", "production_receipt"]);
export const OUTBOUND_LEDGER_TYPES = Object.freeze(["purchase_return", "sales_delivery", "transfer_out", "transfer_from_transit", "adjustment_out", "location_transfer_out",
  "disposition_out", "production_issue"]);
export const LEDGER_TYPES = Object.freeze([...INBOUND_LEDGER_TYPES, ...OUTBOUND_LEDGER_TYPES, "reversal"]);
export const LEDGER_TYPE_LABELS = Object.freeze({
  opening_stock: "Opening Stock", purchase_receipt: "Purchase Receipt", purchase_return: "Purchase Return", sales_delivery: "Sales Delivery", sales_return: "Sales Return",
  transfer_out: "Transfer Out", transfer_in: "Transfer In", transfer_to_transit: "Transfer to Transit", transfer_from_transit: "Transfer from Transit",
  adjustment_in: "Adjustment In", adjustment_out: "Adjustment Out", location_transfer_out: "Location Transfer Out", location_transfer_in: "Location Transfer In",
  disposition_out: "Disposition Out", disposition_in: "Disposition In", production_issue: "Production Issue", production_receipt: "Production Receipt", reversal: "Reversal",
  goods_issue: "Goods Issue",
});
// Goods Issue is stored as Adjustment Out (the ledger type list is fixed in the database) and told apart by its source document: every reader
// presents and filters it as its own type through this expression.
export const ledgerKindSql = (movement = "movement", group = "movement_group") =>
  `(CASE WHEN ${movement}.ledger_type = 'adjustment_out' AND ${group}.source_document_type = 'goods_issue' THEN 'goods_issue' ELSE ${movement}.ledger_type END)`;
export const LEDGER_KINDS = Object.freeze([...LEDGER_TYPES, "goods_issue"]);
// Movement groups whose legs only move stock the company keeps: they always net to zero.
export const INTERNAL_OPERATIONS = Object.freeze(["transfer", "dispatch", "receive", "location_move", "disposition_move"]);

// The documents a movement can come from: the reference a module posts with, and the source document the ledger shows and opens.
// line: the reference is a line of the document (its document is found through the line).
const SOURCES = Object.freeze({
  opening_stock: { type: "opening_stock", table: "opening_stocks", number: "document_number" },
  opening_stock_reversal: { type: "opening_stock", table: "opening_stocks", number: "document_number" },
  goods_receipt: { type: "goods_receipt", table: "goods_receipts", number: "receipt_number" },
  goods_receipt_line: { type: "goods_receipt", table: "goods_receipts", number: "receipt_number", line: { table: "goods_receipt_lines", parent: "goods_receipt_id" } },
  goods_receipt_reversal: { type: "goods_receipt", table: "goods_receipts", number: "receipt_number", line: { table: "goods_receipt_lines", parent: "goods_receipt_id" } },
  receiving_rejection: { type: "goods_receipt", table: "goods_receipts", number: "receipt_number", line: { table: "goods_receipt_lines", parent: "goods_receipt_id" } },
  receiving_rejection_disposal: { type: "receiving_rejection", table: "receiving_rejections", number: "rejection_number" },
  receiving_rejection_release: { type: "receiving_rejection", table: "receiving_rejections", number: "rejection_number" },
  inventory_transfer_line: { type: "inventory_transfer", table: "inventory_transfers", number: "document_number", line: { table: "inventory_transfer_lines", parent: "transfer_id" } },
  purchase_return: { type: "purchase_return", table: "purchase_returns", number: "return_number" },
  purchase_return_reversal: { type: "purchase_return", table: "purchase_returns", number: "return_number" },
  sales_delivery: { type: "sales_delivery", table: "sales_fulfillment_requests", number: "request_number" },
  sales_return: { type: "sales_return", table: "sales_returns", number: "return_number" },
  stock_transfer: { type: "stock_transfer", table: "stock_transfers", number: "transfer_number" },
  stock_count: { type: "stock_count", table: "stock_counts", number: "count_number" },
  manufacturing_work_order: { type: "manufacturing_work_order", table: "manufacturing_work_orders", number: "work_order_number" },
  pos_sale: { type: "pos_sale", table: "pos_sales", number: "receipt_number" },
  pos_return: { type: "pos_return", table: "pos_returns", number: "return_number" },
  goods_issue_line: { type: "goods_issue", table: "goods_issues", number: "document_number", line: { table: "goods_issue_lines", parent: "goods_issue_id" } },
  goods_issue_reversal: { type: "goods_issue", table: "goods_issues", number: "document_number", line: { table: "goods_issue_lines", parent: "goods_issue_id" } },
  inventory_stock_hold: { type: "inventory_stock_hold", table: "inventory_stock_holds", number: "document_number" },
  inventory_adjustment_line: { type: "inventory_adjustment", table: "inventory_adjustments", number: "document_number", line: { table: "inventory_adjustment_lines", parent: "adjustment_id" } },
});

// What a reference type means when the module does not say: receipts in, deliveries out, the rest by direction.
function impliedLedgerType(referenceType, signed) {
  const inbound = signed > 0;
  switch (referenceType) {
    case "opening_stock": return "opening_stock";
    case "opening_stock_reversal": case "goods_receipt_reversal": case "purchase_return_reversal": case "goods_issue_reversal": return "reversal";
    case "goods_receipt": case "goods_receipt_line": return inbound ? "purchase_receipt" : "purchase_return";
    case "purchase_return": return inbound ? "adjustment_in" : "purchase_return";
    case "sales_delivery": case "pos_sale": return inbound ? "sales_return" : "sales_delivery";
    case "sales_return": case "pos_return": return inbound ? "sales_return" : "sales_delivery";
    case "manufacturing_work_order": return inbound ? "production_receipt" : "production_issue";
    case "receiving_rejection": return inbound ? "disposition_in" : "disposition_out";
    default: return inbound ? "adjustment_in" : "adjustment_out";
  }
}

export function resolveLedgerType(input, signed) {
  const type = input.ledgerType ? String(input.ledgerType) : impliedLedgerType(input.referenceType, signed);
  if (!LEDGER_TYPES.includes(type)) throw new StockError(400, `Unknown stock ledger type ${type}.`, "STOCK_LEDGER_TYPE_INVALID");
  if ((INBOUND_LEDGER_TYPES.includes(type) && signed < 0) || (OUTBOUND_LEDGER_TYPES.includes(type) && signed > 0))
    throw new StockError(400, `A ${LEDGER_TYPE_LABELS[type]} movement goes ${INBOUND_LEDGER_TYPES.includes(type) ? "in" : "out"}.`, "STOCK_LEDGER_DIRECTION_INVALID");
  return type;
}

// The source document behind a reference (null for a movement posted by hand: it is its own adjustment document).
export async function ledgerSourceOf(client, organizationId, referenceType, referenceId) {
  if (!referenceType) return null;
  const source = SOURCES[referenceType];
  if (!source) return { type: referenceType, id: referenceId, number: null, lineId: null };
  if (!referenceId) throw new StockError(400, "The document this movement is for is required.", "STOCK_SOURCE_REQUIRED");
  if (source.line) {
    const row = (await client.query(
      `SELECT document.id, document.${source.number} AS number FROM tenant.${source.line.table} line
         JOIN tenant.${source.table} document ON document.organization_id = line.organization_id AND document.id = line.${source.line.parent}
        WHERE line.organization_id = $1 AND line.id = $2`, [organizationId, referenceId])).rows[0];
    return { type: source.type, id: row?.id ?? referenceId, number: row?.number ?? null, lineId: referenceId };
  }
  const row = (await client.query(`SELECT ${source.number} AS number FROM tenant.${source.table} WHERE organization_id = $1 AND id = $2`, [organizationId, referenceId])).rows[0];
  return { type: source.type, id: referenceId, number: row?.number ?? null, lineId: null };
}

// One business posting: a goods receipt posted, a transfer dispatched, a delivery shipped. postingKey makes it idempotent (the same key is
// the same group); without one, the movements one transaction posts for one document and operation share a group.
// adjustment: a movement posted by hand, which is its own document (the group is its source).
export async function openMovementGroup(client, c, { adjustment = false, sourceType, sourceId = null, sourceNumber = null, operation, postingKey = null, effectiveAt = null, reason = null,
  reversalOfGroupId = null }) {
  const id = adjustment ? crypto.randomUUID() : null;
  if (adjustment) { sourceId = id; postingKey ??= `adjustment:${id}`; }
  if (!sourceType || !sourceId || !operation) throw new StockError(400, "A stock posting needs its source document and operation.", "STOCK_SOURCE_REQUIRED");
  if (postingKey) {
    const existing = (await client.query(`SELECT * FROM tenant.stock_movement_groups WHERE organization_id = $1 AND posting_key = $2`, [c.organizationId, postingKey])).rows[0];
    if (existing) return existing;
  } else {
    const current = (await client.query(
      `SELECT * FROM tenant.stock_movement_groups WHERE organization_id = $1 AND source_document_type = $2 AND source_document_id = $3 AND operation_type = $4
          AND transaction_id = txid_current() AND reversal_of_group_id IS NOT DISTINCT FROM $5 ORDER BY created_at DESC LIMIT 1`,
      [c.organizationId, sourceType, sourceId, operation, reversalOfGroupId])).rows[0];
    if (current) return current;
  }
  const base = postingKey ?? `${sourceType}:${sourceId}:${operation}`;
  const taken = postingKey ? null : (await client.query(`SELECT 1 FROM tenant.stock_movement_groups WHERE organization_id = $1 AND posting_key = $2`, [c.organizationId, base])).rows[0];
  const key = taken ? `${base}:${(await client.query(`SELECT txid_current()::text AS id`)).rows[0].id}` : base;
  const { rows } = await client.query(
    `INSERT INTO tenant.stock_movement_groups (id, organization_id, source_document_type, source_document_id, source_document_number, operation_type, posting_key, effective_at,
       posted_by, reversal_of_group_id, reason)
     VALUES (COALESCE($11::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10) RETURNING *`,
    [c.organizationId, sourceType, sourceId, sourceNumber, operation, key, effectiveAt, c.userId ?? null, reversalOfGroupId, reason, id]);
  return rows[0];
}

// The operation a group of one kind of movement is: transfers by their leg, everything else by its type.
export function operationOf(ledgerType) {
  if (["transfer_out", "transfer_in"].includes(ledgerType)) return "transfer";
  if (["location_transfer_out", "location_transfer_in"].includes(ledgerType)) return "location_move";
  if (["disposition_out", "disposition_in"].includes(ledgerType)) return "disposition_move";
  return ledgerType;
}

// The disposition stock has where it is: its location's (MAIN is always available).
export async function dispositionAt(client, organizationId, locationId) {
  if (!locationId) return "available";
  const row = (await client.query(`SELECT disposition, location_type, purpose FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [organizationId, locationId])).rows[0];
  if (!row) return "available";
  return row.disposition === "available" && (row.location_type === "quality" || row.purpose === "quality_hold") ? "quality_hold" : row.disposition;
}

// A move inside one warehouse is a location transfer, or a disposition change when the stock's disposition changes with it.
export function internalMoveTypes(fromDisposition, toDisposition) {
  return fromDisposition === toDisposition
    ? { out: "location_transfer_out", in: "location_transfer_in", operation: "location_move" }
    : { out: "disposition_out", in: "disposition_in", operation: "disposition_move" };
}

// The company's goods between warehouses: the system "Goods in transit" warehouse and its TRANSIT location (never allocated, never sold
// from, not a warehouse anyone picks). Created on the first dispatch.
export async function ensureTransitPosition(client, c) {
  const existing = (await client.query(
    `SELECT warehouse.id AS warehouse_id, location.id AS location_id FROM tenant.warehouses warehouse
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = warehouse.organization_id AND location.warehouse_id = warehouse.id AND location.code = 'TRANSIT'
      WHERE warehouse.organization_id = $1 AND warehouse.system_role = 'in_transit'`, [c.organizationId])).rows[0];
  let warehouseId = existing?.warehouse_id ?? null;
  if (!warehouseId) {
    const codes = new Set((await client.query(`SELECT upper(code) AS code FROM tenant.warehouses WHERE organization_id = $1 AND upper(code) LIKE 'IN-TRANSIT%'`, [c.organizationId])).rows.map((row) => row.code));
    let code = "IN-TRANSIT";
    for (let index = 2; codes.has(code); index += 1) code = `IN-TRANSIT-${index}`;
    warehouseId = (await client.query(
      `INSERT INTO tenant.warehouses (organization_id, code, name, description, warehouse_type, system_role, receiving_enabled, shipping_enabled, transfer_enabled, returns_enabled,
         status, created_by, updated_by)
       VALUES ($1, $2, 'Goods in transit', 'Stock dispatched from one warehouse and not yet received at another. Maintained by the system.', 'transit', 'in_transit',
         false, false, false, false, 'active', $3, $3) RETURNING id`, [c.organizationId, code, c.userId ?? null])).rows[0].id;
  }
  if (existing?.location_id) return { warehouseId, locationId: existing.location_id };
  const locationId = (await client.query(
    `INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, name, code, location_type, purpose, allow_stock, allow_allocation, disposition, status, created_by, updated_by)
     VALUES ($1, $2, 'In transit', 'TRANSIT', 'other', 'transit', true, false, 'available', 'active', $3, $3) RETURNING id`, [c.organizationId, warehouseId, c.userId ?? null])).rows[0].id;
  return { warehouseId, locationId };
}
