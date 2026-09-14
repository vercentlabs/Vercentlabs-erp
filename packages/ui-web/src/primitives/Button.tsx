import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../utils/cn";

// Base UI has no Button primitive of its own -- a native <button> already
// carries full keyboard/role/focus semantics, so there is nothing an
// accessible-primitives library needs to add here. What this component
// owns is the ONE visual vocabulary (variant/size/tone) every module must
// reuse instead of inventing its own button styling, per
// docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md.
// Exported so a non-<button> element that needs the exact same visual
// language (e.g. a Next.js <Link> acting as a CTA -- nesting a <button>
// inside an <a> is invalid HTML) can apply it directly:
// `<Link className={buttonVariants({ variant: "primary" })}>`.
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)]",
    "font-[family-name:var(--font-sans)] font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary: "bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] hover:bg-[var(--color-action-primary-hover)]",
        secondary: "bg-[var(--color-action-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] hover:bg-[var(--color-canvas-strong)]",
        danger: "bg-[var(--color-action-danger)] text-[var(--color-text-inverse)] hover:bg-[var(--color-action-danger-hover)]",
        ghost: "bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-strong)]",
        link: "bg-transparent text-[var(--color-action-primary)] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        compact: "h-[var(--control-compact)] px-3 text-[length:var(--text-sm)]",
        standard: "h-[var(--control-standard)] px-4 text-[length:var(--text-md)]",
        large: "h-[var(--control-large)] px-5 text-[length:var(--text-lg)]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "standard",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
