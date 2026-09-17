import { forwardRef } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Circle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";

const toneIcon = { neutral: Circle, info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertCircle };

export const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-canvas-strong text-text-secondary",
        info: "border-info-emphasis/20 bg-info-soft text-info",
        success: "border-success-emphasis/20 bg-success-soft text-success",
        warning: "border-warning-emphasis/20 bg-warning-soft text-warning",
        danger: "border-danger-emphasis/20 bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  className?: string;
  /** The status label — required, plain text, not an abbreviation only a
   * trained user would recognize ("Pending approval", not "PA"). */
  children: string;
}

/**
 * Record/transaction status indicator. Always pairs an icon with the label
 * so status is never conveyed by color alone (WCAG 1.4.1 / the ERP "status
 * must be obvious" principle) — this is not optional/stylable away.
 */
export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(function StatusBadge(
  { className, tone = "neutral", children },
  ref,
) {
  const Icon = toneIcon[tone ?? "neutral"];
  return (
    <span ref={ref} className={cn(statusBadgeVariants({ tone }), className)}>
      <Icon className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
});
