import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../utils/cn";

// Houses the search box + filter controls (Select/Popover-based filters,
// saved-view switcher) above an EnterpriseDataGrid. Layout-only: it does not
// own filter state -- the page/archetype does, per the grid's manual
// sorting/pagination contract.
export function FilterBar({ search, children, className, ...props }: { search?: ReactNode; children?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} {...props}>
      {search ? <div className="min-w-[220px] flex-1 sm:flex-none sm:w-72">{search}</div> : null}
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
