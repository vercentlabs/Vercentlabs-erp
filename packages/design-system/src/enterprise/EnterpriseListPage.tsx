import type { ReactNode } from "react";
import { PageHeader, type PageHeaderProps } from "./PageHeader.tsx";
import { ActionBar, type ActionBarProps } from "./ActionBar.tsx";
import { FilterBar, type FilterBarProps } from "./FilterBar.tsx";
import { SavedViewBar, type SavedViewBarProps } from "./SavedViewBar.tsx";
import { BulkActionBar, type BulkActionBarProps } from "./BulkActionBar.tsx";
import { Stack } from "../layout/Stack.tsx";

export interface EnterpriseListPageProps {
  header: PageHeaderProps;
  savedViews?: SavedViewBarProps;
  actionBar?: ActionBarProps;
  filterBar?: FilterBarProps;
  /** Pass to show BulkActionBar in place of the ActionBar area — the
   * composition, not the grid, owns this decision (the grid only reports
   * selection state via its own onRowSelectionChange). */
  bulkActionBar?: BulkActionBarProps;
  /** The grid/list itself — EnterpriseListPage doesn't know what a "Lead"
   * is, it only arranges the surrounding chrome around whatever's passed. */
  children: ReactNode;
}

/**
 * Composition, not a "resource manager" — this owns layout/spacing only.
 * A feature screen (e.g. LeadListScreen) composes this with its own
 * EnterpriseDataGrid instance and domain-specific filter/saved-view state;
 * this component has no knowledge of any specific record type.
 */
export function EnterpriseListPage({ header, savedViews, actionBar, filterBar, bulkActionBar, children }: EnterpriseListPageProps) {
  return (
    <Stack gap={4}>
      <PageHeader {...header} />
      {savedViews && <SavedViewBar {...savedViews} />}
      {bulkActionBar && bulkActionBar.selectedCount > 0 ? <BulkActionBar {...bulkActionBar} /> : actionBar ? <ActionBar {...actionBar} /> : null}
      {filterBar && <FilterBar {...filterBar} />}
      {children}
    </Stack>
  );
}
