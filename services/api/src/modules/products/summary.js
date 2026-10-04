// The product page beyond the record: the Sales, Purchasing and Inventory
// tabs, related transactions and history. Every figure is read from the
// module that owns it; stock quantities and valuation come from Inventory
// and are never stored on the product.
import { canViewProductCost, productCan, requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, ProductError } from "./constants.js";
import { listProductHistory } from "./history.js";
import { loadProductRow, toProduct } from "./records.js";

const num = (value) => Number(value ?? 0);

export async function getProductDetails(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const row = await loadProductRow(client, context, productId);
  const cost = canViewProductCost(context);
  const product = toProduct(row, { cost });
  const values = [context.organizationId, row.id];
  const details = { access: { sales: productCan(context, "sales.view"), procurement: productCan(context, "procurement.view"), inventory: productCan(context, "stock.view"), cost } };

  const priceLists = await client.query(
    `SELECT list.id, list.name, list.currency_code, list.tax_inclusive, entry.rate, entry.minimum_quantity, entry.valid_from, entry.valid_to, uom.code AS uom_code
       FROM tenant.price_list_items entry
       JOIN tenant.price_lists list ON list.organization_id = entry.organization_id AND list.id = entry.price_list_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = entry.organization_id AND uom.id = entry.uom_id
      WHERE entry.organization_id = $1 AND entry.item_id = $2 AND entry.status = 'active' AND list.status = 'active' AND list.price_list_type = 'sales' AND entry.variant_id IS NULL
      ORDER BY list.name, entry.minimum_quantity`, values);
  details.sales = {
    priceLists: priceLists.rows.map((entry) => ({
      id: entry.id, name: entry.name, currencyCode: entry.currency_code?.trim() ?? null, taxInclusive: entry.tax_inclusive, rate: num(entry.rate), minimumQuantity: num(entry.minimum_quantity),
      uom: entry.uom_code, validFrom: entry.valid_from, validTo: entry.valid_to,
    })),
  };

  // A service has no inventory, by rule, not only on screen.
  if (product.inventoryTracked && details.access.inventory) {
    const { rows } = await client.query(
      `SELECT warehouse.id, warehouse.code, warehouse.name, sum(balance.quantity) AS on_hand, sum(balance.reserved_quantity) AS reserved,
              CASE WHEN sum(balance.quantity) <> 0 THEN sum(balance.quantity * balance.average_cost) / sum(balance.quantity) END AS average_cost
         FROM tenant.stock_balances balance JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
        WHERE balance.organization_id = $1 AND balance.item_id = $2
        GROUP BY warehouse.id, warehouse.code, warehouse.name ORDER BY warehouse.name`, values);
    const warehouses = rows.map((entry) => ({
      id: entry.id, code: entry.code, name: entry.name, onHand: num(entry.on_hand), reserved: num(entry.reserved), available: num(entry.on_hand) - num(entry.reserved),
      ...(cost ? { averageCost: entry.average_cost === null ? null : num(entry.average_cost) } : {}),
    }));
    const onHand = warehouses.reduce((sum, entry) => sum + entry.onHand, 0);
    const reserved = warehouses.reduce((sum, entry) => sum + entry.reserved, 0);
    details.inventory = { onHand, reserved, available: onHand - reserved, warehouses, uom: product.baseUom?.code ?? null };
    if (cost) details.inventory.value = rows.reduce((sum, entry) => sum + num(entry.on_hand) * num(entry.average_cost), 0);
  }
  return { product, ...details };
}

// The documents a product appears on, newest first.
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
  invoices: {
    needs: "accounting.view",
    sql: `SELECT invoice.id, invoice.invoice_number AS code, party.display_name AS party, invoice.status, line.quantity, uom.code AS uom, line.line_total AS amount,
                 invoice.currency_code, invoice.invoice_date AS date
            FROM tenant.accounting_customer_invoice_lines line
            JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.customer_invoice_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = invoice.organization_id AND party.id = invoice.party_id
            LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
           WHERE line.organization_id = $1 AND line.item_id = $2 ORDER BY invoice.invoice_date DESC LIMIT 100`,
    href: () => null,
  },
  purchases: {
    needs: "procurement.view",
    sql: `SELECT po.id, COALESCE(po.data->>'purchaseOrderNumber', po.data->>'poNumber', po.data->>'number', left(po.id::text, 8)) AS code, party.display_name AS party, po.status,
                 COALESCE(NULLIF(line.data->>'quantity', '')::numeric, 0) AS quantity, uom.code AS uom, NULL::numeric AS amount, po.data->>'currencyCode' AS currency_code, po.created_at AS date
            FROM tenant.procurement_purchase_order_lines line
            JOIN tenant.procurement_purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.parent_id
            LEFT JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.supplier_id
            LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
           WHERE line.organization_id = $1 AND line.item_id = $2 ORDER BY po.created_at DESC LIMIT 100`,
    href: () => null,
  },
  stock: {
    needs: "stock.view",
    sql: `SELECT movement.id, movement.movement_number AS code, warehouse.name AS party, movement.movement_type AS status, movement.quantity, NULL::text AS uom,
                 NULL::numeric AS amount, NULL::text AS currency_code, movement.occurred_at AS date
            FROM tenant.stock_movements movement LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
           WHERE movement.organization_id = $1 AND movement.item_id = $2 ORDER BY movement.occurred_at DESC LIMIT 100`,
    href: () => null,
  },
});

export const PRODUCT_RELATED_LISTS = Object.freeze(Object.keys(RELATED));

export async function listProductTransactions(client, context, productId, list) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
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
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const row = await loadProductRow(client, context, productId);
  return listProductHistory(client, context, row.id);
}
