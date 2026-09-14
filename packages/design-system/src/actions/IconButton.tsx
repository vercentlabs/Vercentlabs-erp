import { forwardRef, type ReactNode } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";

const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)]",
    "transition-colors duration-[var(--motion-fast)]",
    "outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        ghost: "bg-transparent text-text-secondary hover:bg-surface-muted hover:text-text data-[pressed]:bg-canvas-strong",
        outline:
          "border border-border-strong bg-transparent text-text-secondary hover:bg-surface-muted data-[pressed]:bg-canvas-strong",
        danger: "bg-transparent text-danger hover:bg-danger-soft data-[pressed]:bg-danger-soft",
      },
      size: {
        compact: "size-[var(--control-height-compact)]",
        standard: "size-[var(--control-height-standard)]",
        large: "size-[var(--control-height-large)]",
      },
    },
    defaultVariants: { variant: "ghost", size: "standard" },
  },
);

export interface IconButtonProps
  extends Omit<AriaButtonProps, "className" | "children">,
    VariantProps<typeof iconButtonVariants> {
  className?: string;
  /** The icon to render, e.g. `<Trash2 className="size-4" aria-hidden="true" />`. */
  children: ReactNode;
  /** Required — icon-only buttons must have an accessible name. */
  "aria-label": string;
}

/** An icon-only button. Unlike Button, this requires `aria-label` at the
 * type level so an unlabeled icon-only action can't ship. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, children, ...props },
  ref,
) {
  return (
    <AriaButton ref={ref} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
      {children}
    </AriaButton>
  );
});
