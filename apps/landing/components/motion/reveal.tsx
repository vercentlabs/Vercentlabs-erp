"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /**
   * Renders as a plain div by default, so pass whatever layout/visual
   * classes the call site needs (border, padding, etc. all work normally).
   * Pass `"contents"` explicitly when this wrapper sits directly inside a
   * CSS grid/flex parent that needs its children promoted as direct
   * items — e.g. wrapping two Grid-item siblings without adding a third.
   */
  className?: string;
  /**
   * Group mode: don't animate this wrapper itself — arm descendant
   * `[data-reveal-item]` elements instead (see the `[data-reveal-group]`
   * rule in globals.css).
   */
  group?: boolean;
}

/**
 * Scroll-triggered entrance, mirroring components/analytics/track-view.tsx's
 * one-shot-observer shape. Unlike TrackView (safe to fail closed — worst
 * case is a missed analytics ping), this must fail OPEN: real content must
 * never get stuck invisible just because IntersectionObserver is unavailable.
 * The <noscript> fallback in app/layout.tsx covers the no-JS case.
 */
export function Reveal({ children, className, group = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      node.setAttribute("data-revealed", "true");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-revealed", "true");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal={group ? undefined : ""} data-reveal-group={group ? "" : undefined} className={className}>
      {children}
    </div>
  );
}
