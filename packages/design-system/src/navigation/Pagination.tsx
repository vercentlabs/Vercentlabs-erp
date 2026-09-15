import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "../actions/IconButton.tsx";
import { cn } from "../utilities/cn.ts";

export interface PaginationProps {
  className?: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total row count, shown alongside page info — omit if unknown (e.g.
   * cursor-based pagination without a total). */
  totalItems?: number;
  pageSize?: number;
}

/** React Aria has no built-in Pagination primitive — this is a small
 * composed control, not a wrapper over a hidden RAC component. */
export function Pagination({ className, page, pageCount, onPageChange, totalItems, pageSize }: PaginationProps) {
  const canPrev = page > 1;
  const canNext = page < pageCount;
  const rangeStart = totalItems !== undefined && pageSize ? (page - 1) * pageSize + 1 : undefined;
  const rangeEnd = totalItems !== undefined && pageSize ? Math.min(page * pageSize, totalItems) : undefined;

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-between gap-4 text-sm text-text-secondary", className)}>
      <p>
        {rangeStart !== undefined && rangeEnd !== undefined && totalItems !== undefined ? (
          <>
            <span className="tabular-nums">{rangeStart}</span>–<span className="tabular-nums">{rangeEnd}</span> of{" "}
            <span className="tabular-nums">{totalItems}</span>
          </>
        ) : (
          <>
            Page <span className="tabular-nums">{page}</span> of <span className="tabular-nums">{pageCount}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-1">
        <IconButton
          aria-label="Previous page"
          variant="outline"
          size="compact"
          isDisabled={!canPrev}
          onPress={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label="Next page"
          variant="outline"
          size="compact"
          isDisabled={!canNext}
          onPress={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    </nav>
  );
}
