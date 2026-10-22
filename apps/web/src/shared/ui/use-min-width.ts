"use client";

import { useSyncExternalStore } from "react";

// Whether the screen is at least `minWidth` pixels wide — for a list that shows a column only where it fits. The server render and the
// first paint assume the narrower layout; it updates as the window is resized.
export function useMinWidth(minWidth: number) {
  const query = `(min-width: ${minWidth}px)`;
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
