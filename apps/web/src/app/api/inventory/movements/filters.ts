// Movement History's query string: the stock scope (item, warehouse, location, batch, serial, disposition), the saved view and the listing
// filters, the order, and the page.
export const MOVEMENT_FILTER_KEYS = ["view", "itemId", "warehouseId", "locationId", "batchId", "serialId", "disposition", "categoryId", "category", "type", "direction",
  "sourceType", "sourceId", "reference", "postedBy", "status", "backdated", "tracking", "from", "to", "postedFrom", "postedTo", "search", "sort", "order", "limit", "cursor"] as const;

export function movementFilters(request: Request) {
  const url = new URL(request.url);
  return Object.fromEntries(MOVEMENT_FILTER_KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
}
