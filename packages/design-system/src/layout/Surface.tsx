import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";

export const surfaceVariants = cva("rounded-[var(--radius-card)]", {
  variants: {
    tone: {
      primary: "bg-surface",
      secondary: "bg-surface-muted",
      raised: "bg-surface-raised shadow-panel",
      sunken: "bg-canvas-strong",
    },
    bordered: {
      true: "border border-border",
      false: "",
    },
    padding: {
      none: "p-0",
      sm: "p-3",
      md: "p-4",
      lg: "p-6",
    },
  },
  defaultVariants: { tone: "primary", bordered: true, padding: "md" },
});

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceVariants> {}

/** A visually distinct panel — a card, a form section container. Prefers
 * borders over shadows per the visual-restraint principle; use
 * tone="raised" only for content that should read as floating above the
 * page (rare outside overlays, which have their own chrome already). */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { className, tone, bordered, padding, ...props },
  ref,
) {
  return <div ref={ref} className={cn(surfaceVariants({ tone, bordered, padding }), className)} {...props} />;
});
