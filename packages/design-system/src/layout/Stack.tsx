import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utilities/cn.ts";

const gapClasses = { 0: "gap-0", 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" } as const;

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: keyof typeof gapClasses;
  align?: "start" | "center" | "end" | "stretch";
}

/** Vertical flex stack — the default layout primitive for a form or a
 * column of sections. For horizontal, use Inline. Native flexbox utilities
 * remain fine for anything this doesn't cover; this exists only because
 * "vertical stack with a spacing-scale gap" is the single most common
 * layout need across every screen. */
export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { className, gap = 4, align, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col",
        gapClasses[gap],
        align === "start" && "items-start",
        align === "center" && "items-center",
        align === "end" && "items-end",
        align === "stretch" && "items-stretch",
        className,
      )}
      {...props}
    />
  );
});
