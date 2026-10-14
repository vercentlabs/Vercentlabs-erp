import type { ReactNode } from "react";
import { PageHeader, type PageHeaderProps } from "./PageHeader.tsx";
import type { ActionBarProps } from "./ActionBar.tsx";
import type { FilterBarProps } from "./FilterBar.tsx";
import type { SavedViewBarProps } from "./SavedViewBar.tsx";
import type { BulkActionBarProps } from "./BulkActionBar.tsx";
import { ListToolbar } from "./ListToolbar.tsx";
import { Stack } from "../layout/Stack.tsx";

export interface EnterpriseListPageProps {
  header: PageHeaderProps;
  /** Page-level tabs between the header and the toolbar (one page, several lists — e.g. CRM To-dos). */
  tabs?: ReactNode;
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
export function EnterpriseListPage({ header, tabs, savedViews, actionBar, filterBar, bulkActionBar, children }: EnterpriseListPageProps) {
  return (
    // The header sits on the page canvas as its own chrome, deliberately
    // more separated (gap-6) from the work area below than that work
    // area's own internal rhythm (gap-3) — the toolbar card and the grid
    // read as one connected surface, not three independent blocks.
    <Stack gap={6}>
      <PageHeader {...header} />
      {tabs}
      <Stack gap={3}>
        <ListToolbar savedViews={savedViews} actionBar={actionBar} filterBar={filterBar} bulkActionBar={bulkActionBar} />
        {children}
      </Stack>
    </Stack>
  );
}
