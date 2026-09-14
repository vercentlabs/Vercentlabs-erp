import { theme } from "../theme.ts";

/** Elevation shadows. Reserved for menus/popovers/dialogs/drawers — ordinary
 * work surfaces use borders (border.ts / colorTokens.ts), not shadows. */
export const shadows = {
  subtle: `0 1px 2px ${theme.alpha.shadowSubtle}`,
  panel: `0 8px 24px ${theme.alpha.shadowPanel}`,
  overlay: `0 24px 64px ${theme.alpha.shadowOverlay}`,
  focusRing: `0 0 0 3px ${theme.alpha.focus}`,
} as const;
