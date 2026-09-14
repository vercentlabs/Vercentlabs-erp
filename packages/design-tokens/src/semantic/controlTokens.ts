import { theme } from "../theme.ts";

/**
 * Control heights, in px. `standard` (42px) is the approved brand value
 * from the original Vercentlabs token set — one px outside the 36-40px
 * "comfortable" guidance band, kept as-is rather than silently retuned;
 * revisit only via an explicit design-token change, not a component-level
 * override.
 */
export const controlHeight = {
  compact: theme.control.compact,
  comfortable: theme.control.standard,
  large: theme.control.large,
} as const;

export const touchTarget = {
  web: theme.control.webTouchTarget,
  native: theme.control.nativeTouchTarget,
} as const;
