import type { ReactNode } from "react";
import { X, Filter } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { cn } from "../utilities/cn.ts";

export interface ActiveFilter {
  id: string;
  /** e.g. "Stage: Qualified" — the whole readable filter, not just the value. */
  label: ReactNode;
}

export interface FilterBarProps {
  className?: string;
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
  /** The "Add filter" trigger — typically a MenuTrigger/Popover you own,
   * since the filter-building UI is domain-specific. */
  addFilterTrigger?: ReactNode;
}

/** Active-filter chip row. The filter-building UI itself (which fields,
 * which operators) is domain-specific and owned by the caller via
 * `addFilterTrigger` — this component only renders what's already active. */
export function FilterBar({ className, filters, onRemove, onClearAll, addFilterTrigger }: FilterBarProps) {
  if (filters.length === 0 && !addFilterTrigger) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {filters.length > 0 && <Filter className="size-3.5 text-text-muted" aria-hidden="true" />}
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="flex items-center gap-1 rounded-pill border border-border-strong bg-surface py-0.5 pl-2.5 pr-1 text-xs text-text"
        >
          {filter.label}
          <button
            type="button"
            aria-label={`Remove filter: ${typeof filter.label === "string" ? filter.label : "filter"}`}
            className="rounded-full p-0.5 text-text-muted hover:bg-canvas-strong hover:text-text"
            onClick={() => onRemove(filter.id)}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      {filters.length > 0 && onClearAll && (
        <Button variant="ghost" size="compact" onPress={onClearAll} className="h-6 px-1.5 text-xs">
          Clear all
        </Button>
      )}
      {addFilterTrigger}
    </div>
  );
}
