// The negative-stock report's filters, read from the query string (the screen and the export share them).
export function negativeStockFilters(request: Request) {
  const url = new URL(request.url);
  return Object.fromEntries(["status", "warehouseId", "itemId", "categoryId", "reasonCode", "userId", "from", "to", "search", "limit", "offset"]
    .map((key) => [key, url.searchParams.get(key) ?? undefined]));
}
