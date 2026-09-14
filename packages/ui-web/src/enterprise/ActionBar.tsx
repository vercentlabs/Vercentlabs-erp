import type { HTMLAttributes } from "react";

import { cn } from "../utils/cn";

// A page/section-level row of primary + secondary actions (e.g. "New lead"
// + import/export menu). Distinct from FilterBar (search/filter controls)
// and BulkActionBar (only appears once rows are selected).
export function ActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2", className)} {...props} />;
}
