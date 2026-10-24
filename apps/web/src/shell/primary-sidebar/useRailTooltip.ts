"use client";

// The tooltip of a rail icon (an app in the sidebar, the profile, the top bar's icons): shown while the pointer is over the icon, or
// while the icon has keyboard focus — not after a click, which also focuses it and would otherwise leave the tooltip standing until a
// click elsewhere. Gone on click, on leaving, on Escape, on scroll, when the window loses focus and when the page changes.
import { useEffect, useRef, useState, type RefObject } from "react";
import { usePathname } from "next/navigation";

export type TooltipPosition = { top: number; left?: number; right?: number };

export function useRailTooltip<T extends HTMLElement>(
  place: (rect: DOMRect) => TooltipPosition = (rect) => ({ top: rect.top + rect.height / 2, left: rect.right + 8 }),
): { ref: RefObject<T | null>; position: TooltipPosition | null; handlers: Record<string, (event: never) => void> } {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const pathname = usePathname();
  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPosition(place(rect));
  };
  const hide = () => setPosition(null);

  // A new page: whatever was hovered or clicked is no longer what the tooltip described.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setPosition(null);
  }

  useEffect(() => {
    if (!position) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [position]);

  return {
    ref,
    position,
    handlers: {
      onPointerEnter: show,
      onPointerLeave: hide,
      onPointerDown: hide,
      // Focus shows it only from the keyboard (Tab), never from the click that also focuses the icon.
      onFocus: (event: React.FocusEvent<HTMLElement>) => { if ((event.target as HTMLElement).matches?.(":focus-visible")) show(); },
      onBlur: hide,
    } as Record<string, (event: never) => void>,
  };
}
