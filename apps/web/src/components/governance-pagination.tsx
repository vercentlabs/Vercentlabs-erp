import Link from "next/link";

// Server-rendered prev/next pagination via real query-param links — every
// governance list (Audit Events, Record History, User Activity, Security
// Events, Privacy Requests) is paginated/bounded (Part 38). Distinct from
// pagination-controls.tsx (a client component driven by an onPageChange
// callback, used by client-managed resource tables) — this one needs no
// client state, since the page itself already re-renders server-side on
// navigation.
export default function GovernancePagination({
  page,
  pageSize,
  total,
  basePath,
  extraParams = {},
  pageParam = "page",
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  extraParams?: Record<string, string>;
  /** Query-param name to write the target page into — lets a single page host more than one independent paginated list (e.g. Security events' audit-event list and login-event list). */
  pageParam?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  function hrefFor(targetPage: number) {
    const params = new URLSearchParams(extraParams);
    params.set(pageParam, String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <nav className="pagination-controls" aria-label="Pagination">
      <span>
        Page {page} of {totalPages} · {total} total
      </span>
      <div>
        {page > 1 ? (
          <Link className="secondary-button" href={hrefFor(page - 1)}>
            Previous
          </Link>
        ) : (
          <span className="secondary-button disabled" aria-disabled="true">
            Previous
          </span>
        )}
        {page < totalPages ? (
          <Link className="secondary-button" href={hrefFor(page + 1)}>
            Next
          </Link>
        ) : (
          <span className="secondary-button disabled" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
