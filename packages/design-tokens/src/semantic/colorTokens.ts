import { colors, alpha } from "../primitives/colors.ts";

/**
 * Semantic color tokens. Components should reach for these, not raw
 * palette values, so a future rebrand only touches this file plus
 * theme.json — never module/component code. See
 * docs/frontend-rebuild/HCI_STANDARD.md for usage rules.
 */

export const surface = {
  /** Page background. */
  canvas: colors.canvas,
  /** Primary working surface (cards, panels, table bodies). */
  primary: colors.surface,
  /** Secondary/nested surface (e.g. a panel inside a panel). */
  secondary: colors.surfaceSubtle,
  /** Surface that should read as lifted (popovers, dropdown panels). */
  raised: colors.surfaceRaised,
  /** Surface that should read as recessed (page chrome, filter rails). */
  sunken: colors.canvasStrong,
  /** Selected row/item background. */
  selected: colors.accentSoft,
  /** Hover background for an otherwise-neutral surface. */
  hover: colors.canvasStrong,
} as const;

export const text = {
  primary: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  /** Text on a filled brand/status surface (e.g. inside a primary button). */
  inverse: colors.onAccent,
  link: colors.accent,
  disabled: colors.textSubtle,
} as const;

export const border = {
  default: colors.border,
  strong: colors.borderStrong,
  /** Barely-there divider, lighter than `default`. */
  subtle: colors.canvasStrong,
  focus: colors.accent,
} as const;

export const action = {
  primary: colors.accent,
  primaryHover: colors.accentStrong,
  /** Pressed shares accentStrong with hover — theme.json defines two brand
   * shades, not three; revisit if a distinct pressed shade is approved. */
  primaryPressed: colors.accentStrong,
  /** Neutral/outline button background. Pair with border.default. */
  secondary: colors.surface,
  danger: colors.danger,
  dangerHover: colors.dangerEmphasis,
} as const;

/** Status tone triplets: soft background, emphasis foreground/icon, border. */
export const status = {
  neutral: { bg: colors.canvasStrong, fg: colors.textSecondary, border: colors.borderStrong },
  info: { bg: colors.infoSoft, fg: colors.info, border: colors.infoEmphasis },
  success: { bg: colors.successSoft, fg: colors.success, border: colors.successEmphasis },
  warning: { bg: colors.warningSoft, fg: colors.warning, border: colors.warningEmphasis },
  danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerEmphasis },
} as const;

export const focus = {
  ring: colors.accent,
  glow: alpha.focus,
} as const;

export const navigation = {
  surface: colors.navigation,
  text: colors.navigationText,
  muted: colors.navigationMuted,
} as const;

export const overlay = {
  backdrop: alpha.overlayBackdrop,
  backdropStrong: alpha.overlayBackdropStrong,
} as const;
