// The Stock Ledger's query string: the balance scope (item, warehouse, location, batch, serial, disposition) and the listing filters.
export const LEDGER_FILTER_KEYS = ["itemId", "warehouseId", "locationId", "batchId", "serialId", "disposition", "from", "to", "postedFrom", "postedTo", "type", "categoryId",
  "reference", "sourceType", "sourceId", "postedBy", "search", "order", "limit", "cursor"] as const;

export function ledgerFilters(request: Request) {
  const url = new URL(request.url);
  return Object.fromEntries(LEDGER_FILTER_KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
}
