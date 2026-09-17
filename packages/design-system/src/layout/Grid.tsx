import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utilities/cn.ts";

const gapClasses = { 0: "gap-0", 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" } as const;
const colClasses = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 6: "grid-cols-6", 12: "grid-cols-12" } as const;

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: keyof typeof colClasses;
  gap?: keyof typeof gapClasses;
}

/** Fixed-column CSS grid — form sections with a 2/3/4-column field layout,
 * metric card rows. For a responsive auto-fit grid, use native Tailwind
 * grid utilities directly; this covers the common fixed case only. */
export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { className, columns = 2, gap = 4, ...props },
  ref,
) {
  return <div ref={ref} className={cn("grid", colClasses[columns], gapClasses[gap], className)} {...props} />;
});
