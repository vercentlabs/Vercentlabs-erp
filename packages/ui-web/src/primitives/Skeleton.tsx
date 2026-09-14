import type { HTMLAttributes } from "react";

import { cn } from "../utils/cn";

// prefers-reduced-motion is honored globally (see tailwind-theme.css's
// motion tokens / any global reduced-motion media query the Experience
// Kernel already defines) -- this component only sets the animation
// class, never a hardcoded duration/easing that would bypass it.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn("animate-pulse rounded-[var(--radius-control)] bg-[var(--color-canvas-strong)]", className)}
      {...props}
    />
  );
}
