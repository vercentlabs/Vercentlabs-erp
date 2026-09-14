import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../utils/cn";

// An icon-only affordance (row action trigger, filter-bar toggle, ActionBar
// overflow button, ...) is a real SP032 accessibility risk if the caller
// forgets a label -- so `aria-label` is required here, not optional, unlike
// a normal ButtonProps.
const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)]",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-1",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        ghost: "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-strong)] hover:text-[var(--color-text-primary)]",
        outline: "border border-[var(--color-border-default)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-strong)]",
        danger: "bg-transparent text-[var(--color-state-danger)] hover:bg-[var(--color-state-danger-soft)]",
      },
      size: {
        compact: "size-7",
        standard: "size-9",
      },
    },
    defaultVariants: { variant: "ghost", size: "standard" },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    VariantProps<typeof iconButtonVariants> {
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button ref={ref} type="button" className={cn(iconButtonVariants({ variant, size }), className)} {...props} />;
  },
);
IconButton.displayName = "IconButton";
