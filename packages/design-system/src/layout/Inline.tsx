import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utilities/cn.ts";

const gapClasses = { 0: "gap-0", 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" } as const;

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: keyof typeof gapClasses;
  align?: "start" | "center" | "end" | "baseline";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
}

/** Horizontal flex row — a toolbar, a button group, a metadata row. */
export const Inline = forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { className, gap = 2, align = "center", justify, wrap, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-row",
        gapClasses[gap],
        wrap && "flex-wrap",
        align === "start" && "items-start",
        align === "center" && "items-center",
        align === "end" && "items-end",
        align === "baseline" && "items-baseline",
        justify === "start" && "justify-start",
        justify === "center" && "justify-center",
        justify === "end" && "justify-end",
        justify === "between" && "justify-between",
        className,
      )}
      {...props}
    />
  );
});
