// The valuation report's filters, read from the query string (the screen and the export share them).
export function valuationFilters(request: Request) {
  const url = new URL(request.url);
  return Object.fromEntries(["view", "warehouseId", "itemId", "categoryId", "method", "search", "asOf", "includeZero", "limit", "offset"]
    .map((key) => [key, url.searchParams.get(key) ?? undefined]));
}
