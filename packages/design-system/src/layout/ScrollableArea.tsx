import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utilities/cn.ts";

export interface ScrollableAreaProps extends HTMLAttributes<HTMLDivElement> {
  direction?: "vertical" | "horizontal" | "both";
}

/** A scoped scroll region (a table body, a side panel's content) that
 * doesn't scroll the whole page. Keeps keyboard scroll (arrow keys, Page
 * Up/Down) working by staying a real focusable/native-scrollable element,
 * not a transform-based fake scroller. */
export const ScrollableArea = forwardRef<HTMLDivElement, ScrollableAreaProps>(function ScrollableArea(
  { className, direction = "vertical", tabIndex = 0, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      tabIndex={tabIndex}
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-brand",
        direction === "vertical" && "overflow-y-auto overflow-x-hidden",
        direction === "horizontal" && "overflow-x-auto overflow-y-hidden",
        direction === "both" && "overflow-auto",
        className,
      )}
      {...props}
    />
  );
});
