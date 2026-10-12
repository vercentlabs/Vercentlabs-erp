import { ActionBar, type ActionBarProps } from "./ActionBar.tsx";
import { BulkActionBar, type BulkActionBarProps } from "./BulkActionBar.tsx";
import { FilterBar, type FilterBarProps } from "./FilterBar.tsx";
import { SavedViewBar, savedViewsAsMenu, type SavedViewBarProps } from "./SavedViewBar.tsx";

export interface ListToolbarProps {
  savedViews?: SavedViewBarProps;
  actionBar?: ActionBarProps;
  filterBar?: FilterBarProps;
  bulkActionBar?: BulkActionBarProps;
}

/** The card above a list: saved views, the action row (search, Filters,
 * buttons), the applied-filter chips, or the bulk actions while rows are
 * selected. Many views become a dropdown at the start of the action row, so
 * the card stays one line tall on a desktop and two on a phone. */
export function ListToolbar({ savedViews, actionBar, filterBar, bulkActionBar }: ListToolbarProps) {
  if (!savedViews && !actionBar && !bulkActionBar && !filterBar) return null;
  const bulk = Boolean(bulkActionBar && bulkActionBar.selectedCount > 0);
  const inlineViews = Boolean(savedViews && actionBar && !bulk && savedViewsAsMenu(savedViews.views));
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-[var(--shadow-subtle)] sm:p-4">
      {savedViews && !inlineViews && <SavedViewBar {...savedViews} />}
      {bulk && bulkActionBar ? (
        <BulkActionBar {...bulkActionBar} />
      ) : actionBar ? (
        <ActionBar {...actionBar} leading={inlineViews && savedViews ? <SavedViewBar {...savedViews} className="min-w-0 flex-1 sm:flex-none" /> : actionBar.leading} />
      ) : null}
      {filterBar && <FilterBar {...filterBar} />}
    </div>
  );
}
