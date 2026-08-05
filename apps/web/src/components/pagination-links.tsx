import Link from "next/link";

type PageItem = number | "ellipsis-start" | "ellipsis-end";

const visiblePages = (page: number, totalPages: number): PageItem[] => {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "ellipsis-end", totalPages];
  if (page >= totalPages - 3)
    return [
      1,
      "ellipsis-start",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  return [
    1,
    "ellipsis-start",
    page - 1,
    page,
    page + 1,
    "ellipsis-end",
    totalPages,
  ];
};

export default function PaginationLinks({
  pathname,
  query,
  page,
  pageSize,
  totalItems,
}: {
  pathname: string;
  query: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  totalItems: number;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const hrefFor = (pageNumber: number) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key !== "page" && value) parameters.set(key, value);
    }
    if (pageNumber > 1) parameters.set("page", String(pageNumber));
    const suffix = parameters.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  };
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(totalItems, page * pageSize);

  return (
    <nav className="pagination-bar" aria-label="Record pages">
      <p>
        Showing <strong>{firstItem}</strong>–<strong>{lastItem}</strong> of{" "}
        <strong>{totalItems}</strong>
      </p>
      <div className="pagination-actions">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)}>Previous</Link>
        ) : (
          <span aria-disabled="true">Previous</span>
        )}
        <div className="pagination-pages" aria-label="Choose page">
          {visiblePages(page, totalPages).map((item) =>
            typeof item === "number" ? (
              <Link
                href={hrefFor(item)}
                key={item}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
              >
                {item}
              </Link>
            ) : (
              <span
                className="pagination-ellipsis"
                aria-hidden="true"
                key={item}
              >
                …
              </span>
            ),
          )}
        </div>
        {page < totalPages ? (
          <Link href={hrefFor(page + 1)}>Next</Link>
        ) : (
          <span aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}
