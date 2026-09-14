import { forwardRef, type ReactNode } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)]",
    "text-sm font-medium transition-colors duration-[var(--motion-fast)]",
    "outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-brand text-text-inverse hover:bg-brand-hover data-[pressed]:bg-brand-active",
        secondary:
          "border border-border bg-surface text-text hover:bg-surface-muted data-[pressed]:bg-canvas-strong",
        outline:
          "border border-border-strong bg-transparent text-text hover:bg-surface-muted data-[pressed]:bg-canvas-strong",
        ghost: "bg-transparent text-text hover:bg-surface-muted data-[pressed]:bg-canvas-strong",
        danger: "bg-danger text-text-inverse hover:bg-danger-emphasis data-[pressed]:bg-danger-emphasis",
      },
      size: {
        compact: "h-[var(--control-height-compact)] px-3 text-xs",
        standard: "h-[var(--control-height-standard)] px-4",
        large: "h-[var(--control-height-large)] px-5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "standard" },
  },
);

export interface ButtonProps
  extends Omit<AriaButtonProps, "className" | "children">,
    VariantProps<typeof buttonVariants> {
  className?: string;
  children?: ReactNode;
  /** Shows a spinner and disables the button. The button keeps its size so
   * layout doesn't shift — label stays in the DOM for screen readers. */
  isLoading?: boolean;
}

/**
 * Core action button. Icon-only usage must go through IconButton, which
 * requires an accessible label — Button always renders its children as
 * visible text content.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, isLoading, isDisabled, children, ...props },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      isDisabled={isDisabled || isLoading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </AriaButton>
  );
});
