import { ChevronDown, Plus } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { IconButton } from "../actions/IconButton.tsx";
import { Menu, MenuItem, MenuTrigger } from "../overlays/Menu.tsx";
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
  /** The most used views, always visible as chips; every other view sits under "More views ▾" (named there when it is the active one). */
  pinned?: string[];
}

/** More views than this and the tab row would scroll sideways, so the views
 * collapse into one "View" dropdown that sits in the toolbar row instead. */
export const SAVED_VIEW_TAB_LIMIT = 5;

export const savedViewsAsMenu = (views: SavedView[], pinned?: string[]) => !pinned?.length && views.length > SAVED_VIEW_TAB_LIMIT;

/** The saved-view tab row above a list (e.g. "My leads" / "All leads" /
 * "Hot leads"). Distinct from Tabs (navigation/) — a saved view changes
 * the query, it doesn't switch page content. */
export function SavedViewBar({ className, views, activeViewId, onSelect, onCreateView, pinned }: SavedViewBarProps) {
  if (pinned?.length) {
    const chips = pinned.map((id) => views.find((view) => view.id === id)).filter((view): view is SavedView => Boolean(view));
    const rest = views.filter((view) => !pinned.includes(view.id));
    const activeRest = rest.find((view) => view.id === activeViewId);
    const chip = (view: SavedView) => {
      const isActive = view.id === activeViewId;
      return (
        <button key={view.id} type="button" role="tab" aria-selected={isActive} onClick={() => onSelect(view.id)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand",
            isActive ? "border-brand bg-brand-soft text-brand-active" : "border-border text-text-secondary hover:bg-surface-muted hover:text-text",
          )}>
          {view.label}
          {view.count !== undefined && <span className="tabular-nums text-xs text-text-muted">{view.count}</span>}
        </button>
      );
    };
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Saved views">{chips.map(chip)}</div>
        {rest.length > 0 && (
          <MenuTrigger>
            <Button variant={activeRest ? "secondary" : "ghost"} size="compact" aria-label="More views">
              {activeRest ? activeRest.label : "More views"}<ChevronDown className="size-4" aria-hidden="true" />
            </Button>
            <Menu onAction={(key) => onSelect(String(key))}>
              {rest.map((view) => <MenuItem key={view.id} id={view.id}>{view.count === undefined ? view.label : `${view.label} (${view.count})`}</MenuItem>)}
            </Menu>
          </MenuTrigger>
        )}
        {onCreateView && (
          <IconButton aria-label="Save current filters as a view" size="compact" onPress={onCreateView}>
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>
    );
  }
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
