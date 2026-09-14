import { Plus } from "lucide-react";
import { IconButton } from "../actions/IconButton.tsx";
import { cn } from "../utilities/cn.ts";

export interface SavedView {
  id: string;
  label: string;
  /** Row count for this view, if cheap to compute — omit rather than
   * showing a stale/misleading number. */
  count?: number;
}

export interface SavedViewBarProps {
  className?: string;
  views: SavedView[];
  activeViewId: string;
  onSelect: (id: string) => void;
  onCreateView?: () => void;
}

/** The saved-view tab row above a list (e.g. "My leads" / "All leads" /
 * "Hot leads"). Distinct from Tabs (navigation/) — a saved view changes
 * the query, it doesn't switch page content. */
export function SavedViewBar({ className, views, activeViewId, onSelect, onCreateView }: SavedViewBarProps) {
  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto", className)} role="tablist" aria-label="Saved views">
      {views.map((view) => {
        const isActive = view.id === activeViewId;
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(view.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm font-medium outline-none",
              "data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand",
              isActive ? "bg-brand-soft text-brand-active" : "text-text-secondary hover:bg-surface-muted hover:text-text",
            )}
          >
            {view.label}
            {view.count !== undefined && <span className="tabular-nums text-xs text-text-muted">{view.count}</span>}
          </button>
        );
      })}
      {onCreateView && (
        <IconButton aria-label="Save current filters as a view" size="compact" onPress={onCreateView}>
          <Plus className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
