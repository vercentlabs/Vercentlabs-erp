import type { ReactNode } from "react";
import { cn } from "../utilities/cn.ts";

export interface ActionBarProps {
  className?: string;
  /** Left-aligned content — usually a SearchField and/or FilterBar. */
  start?: ReactNode;
  /** Right-aligned content — usually action buttons (Import, Export,
   * Create). */
  end?: ReactNode;
}

/** The toolbar row above an EnterpriseDataGrid or list — search/filters on
 * one side, record-level actions on the other. For a row selected in the
 * grid, BulkActionBar replaces this instead of stacking beside it. */
export function ActionBar({ className, start, end }: ActionBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex flex-1 flex-wrap items-center gap-2">{start}</div>
      {end && <div className="flex shrink-0 items-center gap-2">{end}</div>}
    </div>
  );
}
