import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";

export const iconButtonVariants = cva(
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
  /** Hover/focus tooltip text. Defaults to `aria-label`; pass `false` to suppress
   * (e.g. when the trigger already shows its own tooltip elsewhere). */
  tooltip?: string | false;
}

// Every icon-only button gets a visible hover/focus label, not just an
// aria-label a sighted mouse user never sees — matching the primary
// sidebar's icons (PrimaryNavItem.tsx), which this intentionally mirrors:
// a plain portaled span/hover-state tooltip, not react-aria-components'
// TooltipTrigger. TooltipTrigger provides its own Button context to its
// child, which risks colliding with an outer trigger's context (MenuTrigger,
// DialogTrigger) when an IconButton is itself a menu/dialog trigger — a
// failure mode already hit and documented with next/link in
// PrimaryNavItem.tsx. A plain wrapping span carries no such context and is
// invisible to any outer trigger's cloning/context logic, so it composes
// safely everywhere IconButton is used, including as a MenuTrigger child
// (ProfileMenu.tsx, ContextSwitcher.tsx). Portaled to document.body for the
// same reason as PrimaryNavItem.tsx: an absolutely/fixed-positioned tooltip
// left in a scrollable or clipped ancestor (a table row, a dialog body)
// would otherwise get clipped or contribute to that ancestor's own
// scrollable area.
/** An icon-only button. Unlike Button, this requires `aria-label` at the
 * type level so an unlabeled icon-only action can't ship. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, children, tooltip, ...props },
  ref,
) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const tooltipText = tooltip === false ? null : tooltip || props["aria-label"];

  function showTooltip() {
    if (!tooltipText) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({ top: rect.top - 6, left: rect.left + rect.width / 2 });
  }
  function hideTooltip() {
    setTooltipPosition(null);
  }

  // Clamp horizontally after the tooltip has its real rendered width — a
  // button near the left/right viewport edge (e.g. a table's last column)
  // would otherwise have its centered tooltip clipped off-screen. Runs
  // before paint (useLayoutEffect, not useEffect) so the correction is
  // never visible as a jump.
  useLayoutEffect(() => {
    if (!tooltipPosition || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const halfWidth = rect.width / 2;
    let left = tooltipPosition.left;
    if (left - halfWidth < margin) left = halfWidth + margin;
    if (left + halfWidth > window.innerWidth - margin) left = window.innerWidth - halfWidth - margin;
    if (left !== tooltipPosition.left) el.style.left = `${left}px`;
  }, [tooltipPosition]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <AriaButton ref={ref} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
        {children}
      </AriaButton>
      {tooltipPosition && tooltipText && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              role="tooltip"
              style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text shadow-panel"
            >
              {tooltipText}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
});
