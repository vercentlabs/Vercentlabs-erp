"use client";

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

export default function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(totalItems, page * pageSize);
  const changePage = (nextPage: number) => {
    onPageChange(Math.min(totalPages, Math.max(1, nextPage)));
  };

  return (
    <nav className="pagination-bar" aria-label="Record pages">
      <p>
        Showing <strong>{firstItem}</strong>–<strong>{lastItem}</strong> of{" "}
        <strong>{totalItems}</strong>
      </p>
      <div className="pagination-actions">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => changePage(page - 1)}
        >
          Previous
        </button>
        <div className="pagination-pages" aria-label="Choose page">
          {visiblePages(page, totalPages).map((item) =>
            typeof item === "number" ? (
              <button
                type="button"
                key={item}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
                onClick={() => changePage(item)}
              >
                {item}
              </button>
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
        <button
          type="button"
          disabled={page === totalPages}
          onClick={() => changePage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
