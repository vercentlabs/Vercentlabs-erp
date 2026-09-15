import type { ReactNode } from "react";
import { RecordHeader, type RecordHeaderProps } from "./RecordHeader.tsx";
import { Stack } from "../layout/Stack.tsx";
import { Grid } from "../layout/Grid.tsx";

export interface RecordDetailsPageProps {
  header: RecordHeaderProps;
  /** The tab strip (navigation/Tabs) for the record's sections — Overview/
   * Activity/Notes/etc. Optional: a record with one section can skip tabs
   * entirely and put content straight in `children`. */
  tabs?: ReactNode;
  /** Governance/context rail — audit trail, permissions, duplicate
   * handling, assignment history. Rendered as a side column on wide
   * viewports, stacked below on narrow ones. Optional. */
  sidebar?: ReactNode;
  children: ReactNode;
}

/**
 * Record 360 composition: identity/status header, optional section tabs,
 * main content, optional governance sidebar. This is layout only — it has
 * no idea what a Lead or a Sales Order is; a feature screen supplies all
 * of the above.
 */
export function RecordDetailsPage({ header, tabs, sidebar, children }: RecordDetailsPageProps) {
  return (
    <Stack gap={4}>
      <RecordHeader {...header} />
      {tabs}
      {sidebar ? (
        <Grid columns={4} gap={6} className="items-start">
          <div className="col-span-4 lg:col-span-3">{children}</div>
          <div className="col-span-4 lg:col-span-1">{sidebar}</div>
        </Grid>
      ) : (
        children
      )}
    </Stack>
  );
}
