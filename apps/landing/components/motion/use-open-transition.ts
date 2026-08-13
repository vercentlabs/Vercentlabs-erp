"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps a panel mounted for `durationMs` after `open` flips false so its CSS
 * close transition can play, instead of an instant unmount. Mirrors the same
 * two-phase "mount closed, flip visible next frame" technique on the way in.
 * No reduced-motion special-casing needed — this drives direct
 * user-triggered UI (nav open/close), so the global
 * `transition-duration: 0.001ms !important` override already makes it
 * instant-but-functional, which is the correct reduced-motion behaviour here
 * (unlike Reveal, there's no risk of content getting stuck hidden).
 */
export function useOpenTransition(open: boolean, durationMs: number) {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(open);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Adjusted during render, not inside the effect below — React's documented
  // pattern for synchronizing state with a changed prop without triggering
  // an extra render cycle (nav-menu.tsx's pathname-reset already uses the
  // same technique). The effect is reserved for genuinely async work: the
  // next-frame flip (so the "closed" styles actually paint first) and the
  // delayed unmount.
  if (open && !rendered) {
    setRendered(true);
  }
  if (!open && visible) {
    setVisible(false);
  }

  useEffect(() => {
    clearTimeout(timeoutRef.current);

    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }

    timeoutRef.current = setTimeout(() => setRendered(false), durationMs);
    return () => clearTimeout(timeoutRef.current);
  }, [open, durationMs]);

  return { rendered, visible };
}
