import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export interface RelatedRecord {
  id: string;
  href: string;
  title: string;
  /** e.g. a StatusBadge, an amount, a date — the one or two facts that
   * matter for recognizing this record without opening it. */
  meta?: ReactNode;
}

export interface RelatedRecordsProps {
  className?: string;
  title: string;
  records: RelatedRecord[];
  emptyMessage?: string;
  /** "View all N" link when the list is truncated — pass the full count. */
  totalCount?: number;
  onViewAll?: () => void;
}

/** A titled list of records related to the current one (an account's
 * contacts, a sales order's deliveries) — same-type, flat list. For a
 * cross-module lifecycle (Lead → Opportunity → Quotation → …), use
 * RelatedBusinessFlow instead, which is ordered/staged, not a flat list. */
export function RelatedRecords({ className, title, records, emptyMessage = "None", totalCount, onViewAll }: RelatedRecordsProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {totalCount !== undefined && totalCount > records.length && onViewAll && (
          <button type="button" onClick={onViewAll} className="text-xs font-medium text-brand outline-none hover:underline data-[focus-visible]:underline">
            View all {totalCount}
          </button>
        )}
      </div>
      {records.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {records.map((record) => (
            <li key={record.id}>
              <a
                href={record.href}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm outline-none hover:bg-surface-muted data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand"
              >
                <span className="truncate text-text">{record.title}</span>
                <span className="flex shrink-0 items-center gap-1 text-text-muted">
                  {record.meta}
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
