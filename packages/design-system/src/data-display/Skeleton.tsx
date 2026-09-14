import type { HTMLAttributes } from "react";
import { cn } from "../utilities/cn.ts";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Announces to screen readers that content is loading — Skeleton is
   * always visually decorative (aria-hidden) but its container should
   * carry role="status"/aria-busy where it stands in for real content. */
}

/** Loading placeholder. Respects prefers-reduced-motion (the pulse
 * animation is disabled globally — see apps/web/src/app/globals.css). */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-[var(--radius-control)] bg-canvas-strong", className)} {...props} />;
}
