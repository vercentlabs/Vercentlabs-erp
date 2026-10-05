// How much of a product can be committed now, per warehouse, read from
// Inventory (its stock balances, reservations and quality holds). Sales keeps
// no stock figures of its own.
//
//   On hand    what is physically in the warehouse, in the product's base unit
//   Reserved   what active reservations hold (any demand)
//   Unusable   stock in quality locations or in blocked or expired batches
//   Held       what an active quality hold withholds
//   Available  on hand − reserved, without unusable or held stock; never negative
//
// Reservation lowers what is available, never what is on hand; a delivery
// lowers what is on hand. Only active warehouses that fulfil sales count
// (not transit, work in progress, virtual or returns warehouses), so stock
// in transit is never counted twice. Everything here only reads: checking
// availability never changes inventory or locks anything.
//
// One query covers every product and warehouse asked about, however many
// lines an order has.

const EPSILON = 1e-9;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

// Stock positions for the given products in every warehouse of the organization.
// Returns Map("itemId|warehouseId" → position), positions for ineligible warehouses included (flagged).
export async function stockPositions(client, organizationId, itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const [balances, holds] = [
    await client.query(
      `SELECT warehouse.id AS warehouse_id, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
              (warehouse.status = 'active' AND warehouse.sales_fulfillment) AS eligible, demand.item_id,
              COALESCE(sum(balance.quantity), 0) AS on_hand,
              COALESCE(sum(balance.reserved_quantity), 0) AS reserved,
              COALESCE(sum(balance.quantity) FILTER (WHERE location.location_type = 'quality' OR location.status = 'inactive' OR batch.status IN ('blocked', 'expired')), 0) AS unusable,
              COALESCE(sum(greatest(balance.quantity - balance.reserved_quantity, 0))
                FILTER (WHERE NOT (COALESCE(location.location_type = 'quality' OR location.status = 'inactive', false) OR COALESCE(batch.status IN ('blocked', 'expired'), false))), 0) AS free
         FROM unnest($2::uuid[]) AS demand(item_id)
         CROSS JOIN tenant.warehouses warehouse
         LEFT JOIN tenant.stock_balances balance ON balance.organization_id = warehouse.organization_id AND balance.warehouse_id = warehouse.id AND balance.item_id = demand.item_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
        WHERE warehouse.organization_id = $1
        GROUP BY warehouse.id, demand.item_id
        ORDER BY warehouse.name`, [organizationId, ids]),
    // A hold with no quantity withholds everything in its scope; one without a warehouse applies to every warehouse.
    await client.query(
      `SELECT item_id, warehouse_id, bool_or(quantity = 0) AS blocks_all, COALESCE(sum(CASE WHEN quantity = 0 THEN 0 ELSE greatest(quantity - released_quantity, 0) END), 0) AS held
         FROM tenant.quality_holds
        WHERE organization_id = $1 AND item_id = ANY($2::uuid[]) AND status = 'active' AND hold_type IN ('inventory', 'batch', 'serial')
        GROUP BY item_id, warehouse_id`, [organizationId, ids]),
  ];
  const holdsFor = (itemId, warehouseId) => holds.rows.filter((hold) => hold.item_id === itemId && (hold.warehouse_id === null || hold.warehouse_id === warehouseId));
  const positions = new Map();
  for (const row of balances.rows) {
    const applicable = holdsFor(row.item_id, row.warehouse_id);
    const blocked = applicable.some((hold) => hold.blocks_all);
    const held = applicable.reduce((total, hold) => total + Number(hold.held), 0);
    positions.set(`${row.item_id}|${row.warehouse_id}`, {
      itemId: row.item_id, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name, eligible: Boolean(row.eligible),
      onHand: round(row.on_hand), reserved: round(row.reserved), unusable: round(row.unusable), held: blocked ? null : round(held), qualityBlocked: blocked,
      available: calculateAvailableQuantity({ free: Number(row.free), held, blocked }),
    });
  }
  return positions;
}

// On hand − reserved, without unusable or held stock. Never negative, even
// when inventory allows a balance below zero.
export function calculateAvailableQuantity({ free, held = 0, blocked = false }) {
  if (blocked) return 0;
  return round(Math.max(0, Number(free) - Number(held)));
}

// What is still to be delivered on a line: ordered − delivered − cancelled,
// and of that, what is not yet reserved. In the line's selling unit.
export function calculateRemainingDemand({ ordered, delivered, cancelled, reserved }) {
  const remaining = round(Math.max(0, Number(ordered) - Number(delivered) - Number(cancelled)));
  return { remaining, unreserved: round(Math.max(0, remaining - Number(reserved))) };
}

// Available / Partially available / Unavailable for what is still required,
// counting what this demand has already reserved as its own.
export function availabilityResult({ remaining, ownReserved, reservable }) {
  if (remaining <= EPSILON) return "not_required";
  const covered = ownReserved + reservable;
  if (covered + EPSILON >= remaining) return "available";
  if (covered > EPSILON) return "partially_available";
  return "unavailable";
}

// Other eligible warehouses with stock of the product, most available first.
export function suggestAlternativeWarehouses(positions, itemId, exceptWarehouseId) {
  return [...positions.values()]
    .filter((position) => position.itemId === itemId && position.eligible && position.warehouseId !== exceptWarehouseId && position.available > EPSILON)
    .sort((a, b) => b.available - a.available)
    .map((position) => ({ warehouseId: position.warehouseId, warehouseCode: position.warehouseCode, warehouseName: position.warehouseName, available: position.available, onHand: position.onHand }));
}

export { round, EPSILON };
