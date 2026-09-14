import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../utils/cn";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-0.5 text-[length:var(--text-xs)] font-medium leading-none",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--color-canvas-strong)] text-[var(--color-text-secondary)]",
        success: "bg-[var(--color-state-success-soft)] text-[var(--color-state-success)]",
        warning: "bg-[var(--color-state-warning-soft)] text-[var(--color-state-warning)]",
        danger: "bg-[var(--color-state-danger-soft)] text-[var(--color-state-danger)]",
        info: "bg-[var(--color-state-info-soft)] text-[var(--color-state-info)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface StatusBadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {}

// Replaces packages/shared-ui's StatusBadge (kept there, unmodified, for
// existing consumers until each is migrated -- see docs/ux/UI_REWRITE_TRACKER.md).
export function StatusBadge({ className, tone, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)} {...props}>
      {children}
    </span>
  );
}
