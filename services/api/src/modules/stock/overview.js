// Inventory Overview: the operational home — what needs attention today. Every figure is read from its own feature (balances, low-stock
// alerts, quality holds, reservations, negative stock, counts, transfers, receipts, issues, movement history); nothing is computed twice.
// Each part shows only to those who may see its feature, and only for the warehouses they may see. Also: the sidebar's attention badges and
// the Inventory search (items, warehouses, locations, batches, serials and every stock document, each opening its own page).
import { visibleWarehouseIds, getReservationExceptions } from "./balances.js";
import { getLowStockAlertCounts } from "./low-stock-alerts.js";
import { getMovementGroups } from "./movement-history.js";
import { restrictedStockSql } from "./rules.js";

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const count = (row) => Number(row?.n ?? 0);

// Stock summary across the warehouses the user may see (the in-transit warehouse is In transit, never on hand at a warehouse).
async function stockSummary(client, c, visible) {
  const row = (await client.query(
    `SELECT COALESCE(sum(balance.quantity) FILTER (WHERE warehouse.system_role IS NULL), 0) AS on_hand,
            COALESCE(sum(balance.reserved_quantity) FILTER (WHERE warehouse.system_role IS NULL), 0) AS reserved,
            COALESCE(sum(balance.quantity) FILTER (WHERE warehouse.system_role IS NULL AND ${restrictedStockSql("location", "batch")} AND COALESCE(location.purpose, '') <> 'transit'), 0) AS restricted,
            COALESCE(sum(greatest(balance.quantity - balance.reserved_quantity, 0)) FILTER (WHERE warehouse.system_role IS NULL AND NOT ${restrictedStockSql("location", "batch")}), 0) AS available,
            COALESCE(sum(balance.quantity) FILTER (WHERE warehouse.system_role = 'in_transit' OR location.purpose = 'transit'), 0) AS in_transit,
            COALESCE(-sum(least(balance.quantity, 0)), 0) AS negative
       FROM tenant.stock_balances balance
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND ($2::uuid[] IS NULL OR balance.warehouse_id = ANY($2::uuid[]) OR warehouse.system_role = 'in_transit')`, [c.organizationId, visible])).rows[0];
  return { onHand: n(row.on_hand), available: n(row.available), reserved: n(row.reserved), restricted: n(row.restricted), inTransit: n(row.in_transit), negative: n(row.negative) };
}

const scoped = (column) => `($2::uuid[] IS NULL OR ${column} = ANY($2::uuid[]))`;

// What needs action: alert conditions, active holds, reservation exceptions, negative stock, counts in progress.
async function attention(client, c, visible) {
  const one = async (sql) => count((await client.query(sql, [c.organizationId, visible])).rows[0]);
  const alerts = can(c, "stock.alerts.view") ? await getLowStockAlertCounts(client, c) : null;
  return {
    outOfStock: alerts ? alerts.outOfStock : null,
    replenishmentRequired: alerts ? alerts.replenishmentRequired : null,
    lowStock: alerts ? alerts.lowStock : null,
    qualityHolds: can(c, "stock.holds.view") ? await one(`SELECT count(*) AS n FROM tenant.inventory_stock_holds WHERE organization_id = $1 AND status IN ('active', 'partially_resolved')
        AND ${scoped("origin_warehouse_id")}`) : null,
    reservationExceptions: can(c, "stock.reservations.view") ? (await getReservationExceptions(client, c).catch(() => ({ exceptions: [] }))).exceptions.length : null,
    negativeStock: can(c, "stock.negative.view_warnings") || can(c, "stock.negative.view_exceptions")
      ? await one(`SELECT count(*) AS n FROM tenant.negative_stock_exceptions WHERE organization_id = $1 AND status = 'open' AND ${scoped("warehouse_id")}`) : null,
    countsInProgress: can(c, "stock.counts.view") ? await one(`SELECT count(*) AS n FROM tenant.physical_inventory_counts WHERE organization_id = $1
        AND status IN ('in_progress', 'ready_for_review') AND ${scoped("warehouse_id")}`) : null,
  };
}

// Today's operations.
async function operations(client, c, visible) {
  const one = async (sql) => count((await client.query(sql, [c.organizationId, visible])).rows[0]);
  return {
    pendingTransfers: can(c, "stock.transfers.view") ? await one(`SELECT count(*) AS n FROM tenant.inventory_transfers WHERE organization_id = $1
        AND status IN ('confirmed', 'dispatched', 'partially_received') AND (${scoped("source_warehouse_id")} OR ${scoped("destination_warehouse_id")})`) : null,
    receiptsToday: can(c, "procurement.po.view") || can(c, "procurement.po.view_all") ? await one(`SELECT count(*) AS n FROM tenant.goods_receipts WHERE organization_id = $1
        AND status = 'posted' AND posted_at >= current_date AND ${scoped("warehouse_id")}`) : null,
    issuesToday: can(c, "stock.goods_issue.view") ? await one(`SELECT count(*) AS n FROM tenant.goods_issues WHERE organization_id = $1 AND status = 'posted'
        AND posted_at >= current_date AND ${scoped("warehouse_id")}`) : null,
    openCounts: can(c, "stock.counts.view") ? await one(`SELECT count(*) AS n FROM tenant.physical_inventory_counts WHERE organization_id = $1
        AND status IN ('draft', 'in_progress', 'ready_for_review') AND ${scoped("warehouse_id")}`) : null,
    holdsDue: can(c, "stock.holds.view") ? await one(`SELECT count(*) AS n FROM tenant.inventory_stock_holds WHERE organization_id = $1
        AND status IN ('active', 'partially_resolved') AND review_due_on IS NOT NULL AND review_due_on <= current_date AND ${scoped("origin_warehouse_id")}`) : null,
  };
}

export async function getInventoryOverview(client, c) {
  const visible = await visibleWarehouseIds(client, c);
  const recent = can(c, "stock.ledger.view") ? (await getMovementGroups(client, c, { sort: "posted", order: "desc", limit: 8 })).rows : null;
  return {
    stock: await stockSummary(client, c, visible), attention: await attention(client, c, visible), operations: await operations(client, c, visible),
    recent: recent?.map((row) => ({ id: row.id, label: row.label, source: row.source, item: row.item, items: row.items, quantity: row.quantity, uom: row.uom, from: row.from, to: row.to,
      postedAt: row.postedAt, href: `/inventory/movements/${row.id}` })) ?? null,
    actions: {
      goodsIssue: can(c, "stock.goods_issue.create"), transfer: can(c, "stock.transfers.create"), adjustment: can(c, "stock.adjustments.create"),
      stockCount: can(c, "stock.counts.create"), qualityHold: can(c, "stock.holds.create"),
    },
  };
}

// The sidebar's attention badges: counts that need action, never totals.
export async function getInventoryAttentionBadges(client, c) {
  const visible = await visibleWarehouseIds(client, c);
  const found = await attention(client, c, visible);
  return {
    replenishment: (found.outOfStock ?? 0) + (found.replenishmentRequired ?? 0) || null,
    qualityHolds: found.qualityHolds || null,
    stockCounts: found.countsInProgress || null,
    stock: found.negativeStock ? "!" : null,
  };
}

// ---------------------------------------------------------------- Inventory search
// One box for SKU, item, barcode, warehouse, location, batch, serial and stock documents (GRN, goods issue, transfer, adjustment, stock
// count, quality hold, PO, SO, delivery, purchase return). Each result opens its authoritative page. Warehouse-scoped documents follow the
// warehouses the user may see; another company's records are never searched.
export async function searchInventory(client, c, query) {
  const term = String(query ?? "").trim();
  if (term.length < 2) return { results: [] };
  const visible = await visibleWarehouseIds(client, c);
  const like = `%${term.toLowerCase()}%`;
  const results = [];
  const run = async (kind, label, sql, href, permission = null) => {
    if (permission && !can(c, permission)) return;
    const { rows } = await client.query(sql, sql.includes("$3") ? [c.organizationId, like, visible] : [c.organizationId, like]);
    for (const row of rows) results.push({ kind, kindLabel: label, id: row.id, title: row.title, subtitle: row.subtitle ?? null, href: href(row) });
  };
  const inScope = (column) => `($3::uuid[] IS NULL OR ${column} = ANY($3::uuid[]))`;
  await run("item", "Item", `SELECT id, code || ' · ' || name AS title, barcode AS subtitle FROM tenant.items WHERE organization_id = $1
      AND lower(concat_ws(' ', code, name, barcode)) LIKE $2 ORDER BY code LIMIT 6`, (row) => `/inventory/items/${row.id}`, "products.view");
  await run("warehouse", "Warehouse", `SELECT id, code || ' · ' || name AS title, NULL AS subtitle FROM tenant.warehouses WHERE organization_id = $1 AND system_role IS NULL
      AND lower(concat_ws(' ', code, name)) LIKE $2 AND ${inScope("id")} ORDER BY code LIMIT 4`, (row) => `/inventory/warehouses/${row.id}`);
  await run("location", "Location", `SELECT location.id, location.warehouse_id, warehouse.code || ' / ' || location.code AS title, location.name AS subtitle FROM tenant.warehouse_locations location
      JOIN tenant.warehouses warehouse ON warehouse.organization_id = location.organization_id AND warehouse.id = location.warehouse_id
      WHERE location.organization_id = $1 AND lower(concat_ws(' ', location.code, location.name)) LIKE $2 AND ${inScope("location.warehouse_id")} ORDER BY title LIMIT 4`,
    (row) => `/inventory/stock?warehouseId=${row.warehouse_id}&locationId=${row.id}`);
  await run("batch", "Batch", `SELECT batch.id, batch.batch_number AS title, item.code || ' · ' || item.name AS subtitle FROM tenant.stock_batches batch
      JOIN tenant.items item ON item.organization_id = batch.organization_id AND item.id = batch.item_id WHERE batch.organization_id = $1 AND lower(batch.batch_number) LIKE $2
      ORDER BY batch.batch_number LIMIT 4`, (row) => `/inventory/stock/batches/${row.id}`);
  await run("serial", "Serial", `SELECT serial.id, serial.serial_number AS title, item.code || ' · ' || item.name AS subtitle FROM tenant.stock_serials serial
      JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id WHERE serial.organization_id = $1 AND lower(serial.serial_number) LIKE $2
      ORDER BY serial.serial_number LIMIT 4`, (row) => `/inventory/stock/serials/${row.id}`);
  const document = (kind, label, table, number, href, permission, warehouse = "warehouse_id") => run(kind, label,
    `SELECT id, ${number} AS title, status AS subtitle FROM tenant.${table} WHERE organization_id = $1 AND lower(${number}) LIKE $2${warehouse ? ` AND ${inScope(warehouse)}` : ""}
      ORDER BY created_at DESC LIMIT 4`, href, permission);
  await document("goods_receipt", "Goods Receipt", "goods_receipts", "receipt_number", (row) => `/procurement/goods-receipts/${row.id}`, "procurement.po.view");
  await document("goods_issue", "Goods Issue", "goods_issues", "document_number", (row) => `/inventory/goods-issues/${row.id}`, "stock.goods_issue.view");
  await document("transfer", "Transfer", "inventory_transfers", "document_number", (row) => `/inventory/transfers/${row.id}`, "stock.transfers.view", "source_warehouse_id");
  await document("adjustment", "Stock Adjustment", "inventory_adjustments", "document_number", (row) => `/inventory/adjustments/${row.id}`, "stock.adjustments.view");
  await document("stock_count", "Stock Count", "physical_inventory_counts", "document_number", (row) => `/inventory/stock-counts/${row.id}`, "stock.counts.view");
  await document("quality_hold", "Quality Hold", "inventory_stock_holds", "document_number", (row) => `/inventory/quality-holds/${row.id}`, "stock.holds.view", "origin_warehouse_id");
  await document("purchase_order", "Purchase Order", "purchase_orders", "purchase_order_number", (row) => `/procurement/purchase-orders/${row.id}`, "procurement.po.view", null);
  await document("purchase_return", "Purchase Return", "purchase_returns", "return_number", (row) => `/procurement/purchase-returns/${row.id}`, "procurement.po.view", null);
  await run("sales_order", "Sales Order", `SELECT id, sales_order_number AS title, lifecycle_status AS subtitle FROM tenant.sales_orders WHERE organization_id = $1
      AND lower(sales_order_number) LIKE $2 ORDER BY created_at DESC LIMIT 4`, (row) => `/sales/orders/${row.id}`, "sales.view");
  await run("delivery", "Delivery", `SELECT id, request_number AS title, delivery_status AS subtitle FROM tenant.sales_fulfillment_requests WHERE organization_id = $1
      AND lower(request_number) LIKE $2 ORDER BY requested_at DESC LIMIT 4`, (row) => `/sales/deliveries/${row.id}`, "sales.view");
  return { results };
}
