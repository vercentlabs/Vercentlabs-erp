import type { MouseEvent } from "react";

/** Lets a real <a href> hand a plain left-click to the app's router (so the
 * page does not fully reload) while modified clicks — new tab, new window —
 * keep the browser's normal behaviour. */
export function followLink(event: MouseEvent<HTMLAnchorElement>, href: string, onNavigate?: (href: string) => void) {
  if (!onNavigate || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate(href);
}
