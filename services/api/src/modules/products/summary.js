// The item page beyond the record: the Inventory, Units & Identifiers, Tracking, Purchasing, Sales and Tax & Accounting tabs, related
// documents and history. Every figure is read from the module that owns it and never stored on the item:
//   on hand, reserved, available   Inventory's balances and reservations (quality holds and unusable locations / batches excluded)
//   incoming                       what confirmed purchase orders still expect to receive
//   outgoing                       what confirmed sales orders still have to deliver
//   last purchase price            the latest confirmed purchase order line (cost permission)
//   valuation                      Inventory's balances (cost permission)
//   accounts                       Finance's account mappings for the item and its category
import { getAccountMapping, getPrimaryLedger } from "../accounting/core.js";
import { getStockAvailability } from "../stock/index.js";
import { canViewProductCost, canViewProductStock, productCan, requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, ProductError } from "./constants.js";
import { listItemUomConversions } from "./conversions.js";
import { listProductHistory } from "./history.js";
import { listItemIdentifiers } from "./identifiers.js";
import { loadProductRow, toProduct } from "./records.js";

const num = (value) => Number(value ?? 0);
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
// Reads on the item's behalf from modules whose own permission the viewer may not hold; the item permission was checked first.
const withPermission = (context, ...permissions) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), ...permissions])] });

// ------------------------------------------------------------------ inventory

const INCOMING_SQL = `
  SELECT line.receiving_warehouse_id AS warehouse_id, sum(status.remaining_to_receive * COALESCE(NULLIF(line.conversion_factor, 0), 1)) AS quantity
    FROM tenant.purchase_order_line_status status
    JOIN tenant.purchase_order_lines line ON line.organization_id = status.organization_id AND line.id = status.purchase_order_line_id
    JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
   WHERE status.organization_id = $1 AND line.product_id = $2 AND po.status = 'confirmed' AND status.receipt_required AND status.remaining_to_receive > 0
   GROUP BY line.receiving_warehouse_id`;

const OUTGOING_SQL = `
  SELECT COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id) AS warehouse_id,
         sum(GREATEST(line.quantity - progress.cancelled_quantity - COALESCE((SELECT sum(delivered.quantity) FROM tenant.sales_delivery_lines delivered
               JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = delivered.delivery_id AND delivery.status = 'completed'
              WHERE delivered.organization_id = line.organization_id AND delivered.sales_order_line_id = line.id), 0), 0) * COALESCE(NULLIF(line.conversion_factor, 0), 1)) AS quantity
    FROM tenant.sales_order_lines line
    JOIN tenant.sales_orders sales_order ON sales_order.organization_id = line.organization_id AND sales_order.current_version_id = line.sales_order_version_id
    JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
   WHERE line.organization_id = $1 AND line.item_id = $2 AND sales_order.lifecycle_status = 'confirmed'
   GROUP BY COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id)`;

// On hand, reserved, available, incoming and outgoing per warehouse and in total, in the base unit. Incoming and outgoing are shown
// beside physical stock, never folded into it.
export async function getItemInventorySummary(client, context, itemId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.viewStock, "You do not have permission to view item stock.");
  const product = toProduct(await loadProductRow(client, context, itemId));
  if (product.type !== "stock") return { tracked: false, uom: product.baseUom?.code ?? null, warehouses: [], totals: null };
  const cost = canViewProductCost(context);
  const organizationId = context.organizationId;
  const values = [organizationId, product.id];
  const balances = (await client.query(
    `SELECT warehouse_id, sum(quantity) AS on_hand, CASE WHEN sum(quantity) <> 0 THEN sum(quantity * average_cost) / sum(quantity) END AS average_cost, sum(quantity * average_cost) AS value
       FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 GROUP BY warehouse_id`, values)).rows;
  const incoming = new Map((await client.query(INCOMING_SQL, values)).rows.map((row) => [row.warehouse_id, num(row.quantity)]));
  const outgoing = new Map((await client.query(OUTGOING_SQL, values)).rows.map((row) => [row.warehouse_id, num(row.quantity)]));
  const ids = [...new Set([...balances.map((row) => row.warehouse_id), ...incoming.keys(), ...outgoing.keys()].filter(Boolean))];
  const names = new Map(ids.length ? (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, ids])).rows
    .map((row) => [row.id, row]) : []);
  const stockContext = withPermission(context, "stock.view");
  const warehouses = [];
  for (const id of ids) {
    const availability = balances.some((row) => row.warehouse_id === id) ? await getStockAvailability(client, stockContext, { itemId: product.id, warehouseId: id }) : null;
    const balance = balances.find((row) => row.warehouse_id === id);
    warehouses.push({
      warehouseId: id, code: names.get(id)?.code ?? null, name: names.get(id)?.name ?? "Unassigned",
      onHand: round(availability?.onHandQuantity ?? 0), reserved: round(availability?.reservedQuantity ?? 0), available: round(availability?.availableQuantity ?? 0),
      incoming: round(incoming.get(id) ?? 0), outgoing: round(outgoing.get(id) ?? 0),
      ...(cost ? { averageCost: balance?.average_cost === null || balance?.average_cost === undefined ? null : round(balance.average_cost), value: round(balance?.value ?? 0) } : {}),
    });
  }
  warehouses.sort((left, right) => String(left.name).localeCompare(String(right.name)));
  const sum = (field) => round(warehouses.reduce((total, entry) => total + entry[field], 0));
  // Warehouse-less expectations (an order line without a warehouse) still count in the total.
  const unassigned = (map) => round(map.get(null) ?? 0);
  const totals = {
    onHand: sum("onHand"), reserved: sum("reserved"), available: sum("available"), incoming: round(sum("incoming") + unassigned(incoming)), outgoing: round(sum("outgoing") + unassigned(outgoing)),
    ...(cost ? { value: sum("value") } : {}),
  };
  return { tracked: true, uom: product.baseUom?.code ?? null, warehouses, totals };
}

export async function getItemWarehouseBalances(client, context, itemId) {
  return (await getItemInventorySummary(client, context, itemId)).warehouses;
}

export async function getItemInventoryMovements(client, context, itemId, { limit = 50 } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.viewStock, "You do not have permission to view item stock.");
  const product = toProduct(await loadProductRow(client, context, itemId));
  const cost = canViewProductCost(context);
  const { rows } = await client.query(
    `SELECT movement.id, movement.movement_number, movement.movement_type, movement.quantity, movement.unit_cost, movement.reference_type, movement.occurred_at,
            warehouse.name AS warehouse_name, batch.batch_number, serial.serial_number
       FROM tenant.stock_movements movement
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = movement.organization_id AND serial.id = movement.serial_id
      WHERE movement.organization_id = $1 AND movement.item_id = $2 ORDER BY movement.occurred_at DESC, movement.created_at DESC LIMIT ${Math.min(Math.max(Number(limit) || 50, 1), 500)}`,
    [context.organizationId, product.id]);
  return rows.map((row) => ({
    id: row.id, number: row.movement_number, type: row.movement_type, quantity: num(row.quantity), uom: product.baseUom?.code ?? null, warehouse: row.warehouse_name,
    batch: row.batch_number ?? null, serial: row.serial_number ?? null, reference: row.reference_type, occurredAt: row.occurred_at, ...(cost ? { unitCost: num(row.unit_cost) } : {}),
  }));
}

// The item's batches, each with what Inventory holds of it now. Batches belong to Inventory; the item only says they are required.
export async function getItemBatches(client, context, itemId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.viewStock, "You do not have permission to view item stock.");
  const product = toProduct(await loadProductRow(client, context, itemId));
  const { rows } = await client.query(
    `SELECT batch.id, batch.batch_number, batch.manufactured_on::text AS manufactured_on, batch.expires_on::text AS expires_on, batch.status, COALESCE(sum(balance.quantity), 0) AS on_hand,
            batch.expires_on < (now() AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM public.organizations WHERE id = batch.organization_id), ''), 'UTC'))::date AS expired
       FROM tenant.stock_batches batch
       LEFT JOIN tenant.stock_balances balance ON balance.organization_id = batch.organization_id AND balance.batch_id = batch.id
      WHERE batch.organization_id = $1 AND batch.item_id = $2
      GROUP BY batch.id ORDER BY batch.expires_on NULLS LAST, batch.batch_number LIMIT 500`, [context.organizationId, product.id]);
  // Dates as calendar dates; expired against the company's local date.
  return rows.map((row) => ({ id: row.id, batchNumber: row.batch_number, manufacturedOn: row.manufactured_on, expiresOn: row.expires_on, status: row.status, onHand: num(row.on_hand), expired: Boolean(row.expired) }));
}

export async function getItemSerials(client, context, itemId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.viewStock, "You do not have permission to view item stock.");
  const product = toProduct(await loadProductRow(client, context, itemId));
  const { rows } = await client.query(
    `SELECT serial.id, serial.serial_number, serial.status, warehouse.name AS warehouse_name, batch.batch_number
       FROM tenant.stock_serials serial
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = serial.organization_id AND warehouse.id = serial.warehouse_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
      WHERE serial.organization_id = $1 AND serial.item_id = $2 ORDER BY serial.serial_number LIMIT 1000`, [context.organizationId, product.id]);
  return rows.map((row) => ({ id: row.id, serialNumber: row.serial_number, status: row.status, warehouse: row.warehouse_name, batch: row.batch_number ?? null }));
}

// ------------------------------------------------------------------ purchasing, sales, accounting

// The latest price paid: the most recent confirmed purchase order line, per base unit.
export async function getItemLastPurchasePrice(client, context, itemId) {
  const row = (await client.query(
    `SELECT line.unit_price, COALESCE(NULLIF(line.conversion_factor, 0), 1) AS factor, po.currency_code, po.order_date, po.purchase_order_number, po.id
       FROM tenant.purchase_order_lines line JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
      WHERE line.organization_id = $1 AND line.product_id = $2 AND po.status IN ('confirmed', 'closed') AND line.unit_price IS NOT NULL
      ORDER BY po.order_date DESC, po.created_at DESC LIMIT 1`, [context.organizationId, itemId])).rows[0];
  if (!row) return null;
  return { unitPrice: num(row.unit_price), perBaseUnit: round(num(row.unit_price) / num(row.factor)), currencyCode: row.currency_code?.trim() ?? null, date: row.order_date,
    purchaseOrderId: row.id, purchaseOrderNumber: row.purchase_order_number };
}

const ACCOUNT_KEYS = Object.freeze([
  ["inventory", "Inventory asset"], ["grni", "Goods received not invoiced"], ["purchase_price_variance", "Purchase price variance"], ["cogs", "Cost of goods sold"],
  ["expense", "Expense"], ["revenue", "Revenue"],
]);

// The accounts Finance posts this item to — exactly as a posting resolves them: an item-specific mapping, then the item's profiles, then the
// company default.
async function accountingProfile(client, context, product) {
  const keys = product.type === "service" ? ACCOUNT_KEYS.filter(([key]) => ["expense", "revenue"].includes(key))
    : product.type === "stock" ? ACCOUNT_KEYS.filter(([key]) => key !== "expense") : ACCOUNT_KEYS.filter(([key]) => ["expense", "revenue", "grni"].includes(key));
  let ledger;
  try { ledger = await getPrimaryLedger(client, withPermission(context, "accounting.view")); } catch { return []; }
  const accounts = [];
  for (const [key, label] of keys) {
    try {
      const account = await getAccountMapping(client, withPermission(context, "accounting.view"), ledger.id, key, { itemId: product.id });
      accounts.push({ key, label, code: account.code, name: account.name });
    } catch { accounts.push({ key, label, code: null, name: null }); }
  }
  return accounts;
}

export async function getProductDetails(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const row = await loadProductRow(client, context, productId);
  const cost = canViewProductCost(context);
  const stock = canViewProductStock(context);
  const product = toProduct(row, { cost });
  const values = [context.organizationId, row.id];
  const access = {
    sales: productCan(context, "sales.view"), procurement: productCan(context, "procurement.view"), inventory: productCan(context, "stock.view") || stock, stock, cost,
    accounting: productCan(context, "accounting.view") || productCan(context, PRODUCT_PERMISSIONS.configureAccounting),
  };
  const details = { product, access };

  const priceLists = await client.query(
    `SELECT list.id, list.name, list.currency_code, list.tax_inclusive, entry.rate, entry.minimum_quantity, entry.valid_from, entry.valid_to, uom.code AS uom_code
       FROM tenant.price_list_items entry
       JOIN tenant.price_lists list ON list.organization_id = entry.organization_id AND list.id = entry.price_list_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = entry.organization_id AND uom.id = entry.uom_id
      WHERE entry.organization_id = $1 AND entry.item_id = $2 AND entry.status = 'active' AND list.status = 'active' AND list.price_list_type = 'sales'
      ORDER BY list.name, entry.minimum_quantity`, values);
  details.sales = {
    sellable: product.isSellable, uom: product.salesUom?.code ?? null,
    priceLists: priceLists.rows.map((entry) => ({
      id: entry.id, name: entry.name, currencyCode: entry.currency_code?.trim() ?? null, taxInclusive: entry.tax_inclusive, rate: num(entry.rate), minimumQuantity: num(entry.minimum_quantity),
      uom: entry.uom_code, validFrom: entry.valid_from, validTo: entry.valid_to,
    })),
  };
  details.purchasing = { purchasable: product.isPurchasable, uom: product.purchaseUom?.code ?? null, ...(cost ? { lastPurchase: await getItemLastPurchasePrice(client, context, row.id) } : {}) };
  details.identifiers = product.isService ? [] : await listItemIdentifiers(client, context, row.id);
  details.conversions = await listItemUomConversions(client, context, row.id);
  details.accounting = { valuationMethod: product.valuationMethod, valuationLabel: product.valuationLabel, categoryName: product.categoryName,
    inventoryProfileName: product.inventoryProfileName, accountingProfileName: product.accountingProfileName,
    accounts: access.accounting ? await accountingProfile(client, context, product) : [] };
  if (product.type === "stock" && stock) details.inventory = await getItemInventorySummary(client, context, row.id);
  return details;
}

// ------------------------------------------------------------------ related documents

// The documents an item appears on, newest first.
const RELATED = Object.freeze({
  quotations: {
    needs: "sales.view",
    sql: `SELECT quotation.id, quotation.quotation_number AS code, party.display_name AS party, quotation.lifecycle_status AS status, line.quantity, line.uom_snapshot AS uom,
                 line.line_total AS amount, version.currency_code, quotation.created_at AS date
            FROM tenant.sales_quotation_lines line
            JOIN tenant.sales_quotation_versions version ON version.organization_id = line.organization_id AND version.id = line.quotation_version_id
            JOIN tenant.sales_quotations quotation ON quotation.organization_id = version.organization_id AND quotation.current_version_id = version.id
            LEFT JOIN tenant.business_parties party ON party.organization_id = quotation.organization_id AND party.id = quotation.party_id
           WHERE line.organization_id = $1 AND line.item_id = $2 ORDER BY quotation.created_at DESC LIMIT 100`,
    href: (row) => `/sales/quotations/${row.id}`,
  },
  orders: {
    needs: "sales.view",
    sql: `SELECT sales_order.id, sales_order.sales_order_number AS code, party.display_name AS party, sales_order.lifecycle_status AS status, line.quantity, line.uom_snapshot AS uom,
                 line.line_total AS amount, version.currency_code, sales_order.order_date AS date
            FROM tenant.sales_order_lines line
            JOIN tenant.sales_order_versions version ON version.organization_id = line.organization_id AND version.id = line.sales_order_version_id
            JOIN tenant.sales_orders sales_order ON sales_order.organization_id = version.organization_id AND sales_order.current_version_id = version.id
            LEFT JOIN tenant.business_parties party ON party.organization_id = sales_order.organization_id AND party.id = sales_order.party_id
           WHERE line.organization_id = $1 AND line.item_id = $2 ORDER BY sales_order.order_date DESC NULLS LAST LIMIT 100`,
    href: (row) => `/sales/orders/${row.id}`,
  },
  deliveries: {
    needs: "sales.view",
    sql: `SELECT delivery.id, delivery.request_number AS code, party.display_name AS party, delivery.status, delivered.quantity, delivered.uom_snapshot AS uom,
                 NULL::numeric AS amount, NULL::text AS currency_code, delivery.created_at AS date
            FROM tenant.sales_delivery_lines delivered
            JOIN tenant.sales_order_lines line ON line.organization_id = delivered.organization_id AND line.id = delivered.sales_order_line_id
            JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = delivered.organization_id AND delivery.id = delivered.delivery_id
            LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = delivery.organization_id AND sales_order.id = delivery.sales_order_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = sales_order.organization_id AND party.id = sales_order.party_id
           WHERE delivered.organization_id = $1 AND line.item_id = $2 ORDER BY delivery.created_at DESC LIMIT 100`,
    href: (row) => `/sales/deliveries/${row.id}`,
  },
  invoices: {
    needs: "accounting.view",
    sql: `SELECT invoice.id, invoice.invoice_number AS code, party.display_name AS party, invoice.status, line.quantity, uom.code AS uom, line.line_total AS amount,
                 invoice.currency_code, invoice.invoice_date AS date
            FROM tenant.accounting_customer_invoice_lines line
            JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.customer_invoice_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = invoice.organization_id AND party.id = invoice.party_id
            LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
           WHERE line.organization_id = $1 AND line.item_id = $2 ORDER BY invoice.invoice_date DESC LIMIT 100`,
    href: (row) => `/sales/invoices/${row.id}`,
  },
  sales_returns: {
    needs: "sales.view",
    sql: `SELECT sales_return.id, sales_return.return_number AS code, party.display_name AS party, sales_return.status, line.quantity, line.uom_snapshot AS uom,
                 NULL::numeric AS amount, NULL::text AS currency_code, sales_return.created_at AS date
            FROM tenant.sales_return_lines line
            JOIN tenant.sales_returns sales_return ON sales_return.organization_id = line.organization_id AND sales_return.id = line.sales_return_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = sales_return.organization_id AND party.id = sales_return.party_id
           WHERE line.organization_id = $1 AND line.item_id = $2 ORDER BY sales_return.created_at DESC LIMIT 100`,
    href: (row) => `/sales/returns/${row.id}`,
  },
  purchases: {
    needs: "procurement.view",
    sql: `SELECT po.id, po.purchase_order_number AS code, party.display_name AS party, po.status, line.ordered_quantity AS quantity, line.uom_snapshot->>'code' AS uom,
                 line.line_total AS amount, po.currency_code, po.order_date AS date
            FROM tenant.purchase_order_lines line
            JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
           WHERE line.organization_id = $1 AND line.product_id = $2 ORDER BY po.order_date DESC, po.created_at DESC LIMIT 100`,
    href: (row) => `/procurement/purchase-orders/${row.id}`,
  },
  receipts: {
    needs: "procurement.view",
    sql: `SELECT receipt.id, receipt.receipt_number AS code, party.display_name AS party, receipt.status, line.accepted_quantity AS quantity, line.uom_snapshot->>'code' AS uom,
                 NULL::numeric AS amount, NULL::text AS currency_code, receipt.receipt_date AS date
            FROM tenant.goods_receipt_lines line
            JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
            JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
           WHERE line.organization_id = $1 AND line.product_id = $2 ORDER BY receipt.receipt_date DESC, receipt.created_at DESC LIMIT 100`,
    href: (row) => `/procurement/goods-receipts/${row.id}`,
  },
  purchase_returns: {
    needs: "procurement.view",
    sql: `SELECT purchase_return.id, purchase_return.return_number AS code, party.display_name AS party, purchase_return.document_status AS status, line.quantity,
                 line.uom_snapshot->>'code' AS uom, NULL::numeric AS amount, NULL::text AS currency_code, purchase_return.return_date AS date
            FROM tenant.purchase_return_lines line
            JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = line.organization_id AND purchase_return.id = line.purchase_return_id
            JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = line.organization_id AND receipt_line.id = line.goods_receipt_line_id
            JOIN tenant.purchase_orders po ON po.organization_id = purchase_return.organization_id AND po.id = purchase_return.purchase_order_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
           WHERE line.organization_id = $1 AND receipt_line.product_id = $2 ORDER BY purchase_return.return_date DESC LIMIT 100`,
    href: (row) => `/procurement/purchase-returns/${row.id}`,
  },
});

export const PRODUCT_RELATED_LISTS = Object.freeze(Object.keys(RELATED));

export async function listProductTransactions(client, context, productId, list) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  if (list === "stock") return getItemInventoryMovements(client, context, productId);
  const definition = RELATED[list];
  if (!definition) throw new ProductError(404, "Unknown list.", "PRODUCT_RELATED_UNKNOWN");
  if (!productCan(context, definition.needs)) throw new ProductError(403, "You do not have access to this information.", "PERMISSION_DENIED");
  const row = await loadProductRow(client, context, productId);
  const { rows } = await client.query(definition.sql, [context.organizationId, row.id]);
  return rows.map((entry) => ({
    id: entry.id, code: entry.code, party: entry.party ?? null, status: entry.status ?? null, quantity: entry.quantity === null ? null : num(entry.quantity), uom: entry.uom ?? null,
    amount: entry.amount === null || entry.amount === undefined ? null : num(entry.amount), currencyCode: entry.currency_code?.trim() ?? null, date: entry.date, href: definition.href(entry),
  }));
}

export async function getProductHistory(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const row = await loadProductRow(client, context, productId);
  return listProductHistory(client, context, row.id);
}

// Alias in the Item Master's own words.
export const getItemAuditHistory = getProductHistory;
