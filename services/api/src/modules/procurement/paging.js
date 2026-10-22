// Paging for Procurement's document lists (Procurement plan Phase 0, bug 7): quotations, goods receipts, rejections, bills and returns
// used to stop at 300 rows with no total, so older documents could not be reached from their list. A list asked for a page
// (filters.limit / filters.offset) returns { rows, total, limit, offset }, the total counted over the same query; one scoped to a parent
// document (an order's receipts, a receipt's rejections) returns all its rows; anything else keeps the old first 300 as a plain array.
const MAX_PAGE = 200;

export function pagingOf(filters = {}, { scoped = false } = {}) {
  const paged = filters.limit !== undefined || filters.offset !== undefined;
  if (!paged) return { paged: false, clause: scoped ? "" : " LIMIT 300" };
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), MAX_PAGE);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  return { paged: true, limit, offset, clause: ` LIMIT ${limit} OFFSET ${offset}` };
}

// sql: the list's SELECT with its WHERE and ORDER BY and no LIMIT; map: row → API row.
export async function pagedList(client, sql, values, filters, map, options = {}) {
  const paging = pagingOf(filters, options);
  const rows = (await client.query(`${sql}${paging.clause}`, values)).rows.map(map);
  if (!paging.paged) return rows;
  const total = Number((await client.query(`SELECT count(*)::int AS total FROM (${sql}) counted`, values)).rows[0].total);
  return { rows, total, limit: paging.limit, offset: paging.offset };
}
