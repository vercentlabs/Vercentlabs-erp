// Stock is tracked only when the Stock app is on. A product's own setting (track_inventory, never true for a service) says whether it
// would be kept in stock; with Stock off nothing is: no warehouse, no reservation, no stock check, no stock movement. Sales, Point of
// Sale, Purchase and Products ask here rather than reading the column alone.
import { appOn } from "../access/apps.js";

// Whether the organization keeps stock at all (the Stock app is on).
export const stockOn = (client, context) => appOn(client, context, "stock");

// Whether a product's own setting tracks stock: item_type / track_inventory (database rows) or type (the product API's shape).
export const productTracksStock = (item) => Boolean(item) && (item.type ? item.type === "stock"
  : (item.item_type ?? item.itemType) !== "service" && (item.track_inventory ?? item.trackInventory) !== false);

// Effective tracking: the product's own setting, and Stock on.
export async function tracksStock(client, context, item) {
  return productTracksStock(item) && await stockOn(client, context);
}

// The type a new product starts as: kept in stock when Stock is on, otherwise not stock-tracked.
export async function defaultProductType(client, context) {
  return (await stockOn(client, context)) ? "stock" : "non_stock";
}
