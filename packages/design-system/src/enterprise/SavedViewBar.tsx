import { Plus } from "lucide-react";
import { IconButton } from "../actions/IconButton.tsx";
import { Select } from "../data-entry/Select.tsx";
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

/** More views than this and the tab row would scroll sideways, so the views
 * collapse into one "View" dropdown that sits in the toolbar row instead. */
export const SAVED_VIEW_TAB_LIMIT = 5;

export const savedViewsAsMenu = (views: SavedView[]) => views.length > SAVED_VIEW_TAB_LIMIT;

/** The saved-view tab row above a list (e.g. "My leads" / "All leads" /
 * "Hot leads"). Distinct from Tabs (navigation/) — a saved view changes
 * the query, it doesn't switch page content. */
export function SavedViewBar({ className, views, activeViewId, onSelect, onCreateView }: SavedViewBarProps) {
  if (savedViewsAsMenu(views))
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Select
          aria-label="View"
          size="compact"
          className="w-full sm:w-56"
          selectedKey={activeViewId}
          onSelectionChange={(key) => onSelect(String(key))}
          options={views.map((view) => ({ value: view.id, label: view.count === undefined ? view.label : `${view.label} (${view.count})` }))}
        />
        {onCreateView && (
          <IconButton aria-label="Save current filters as a view" size="compact" onPress={onCreateView}>
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>
    );
  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto", className)}>
      <div className="flex items-center gap-1" role="tablist" aria-label="Saved views">
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
      </div>
      {onCreateView && (
        <IconButton aria-label="Save current filters as a view" size="compact" onPress={onCreateView}>
          <Plus className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
