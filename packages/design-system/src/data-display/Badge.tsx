import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";
import { humanizeToken } from "../utilities/humanize-token.ts";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-canvas-strong text-text-secondary",
        brand: "border-brand-border bg-brand-soft text-brand-active",
        info: "border-info-emphasis/20 bg-info-soft text-info",
        success: "border-success-emphasis/20 bg-success-soft text-success",
        warning: "border-warning-emphasis/20 bg-warning-soft text-warning",
        danger: "border-danger-emphasis/20 bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Non-status label chip (a count, a category, a custom-field tag). For
 * record/transaction status specifically, use StatusBadge instead — it
 * enforces the icon-plus-text pairing so status is never color-only. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ className, tone, children, ...props }, ref) {
  return (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props}>
      {humanizeToken(children)}
    </span>
  );
});
