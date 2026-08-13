/**
 * Design tokens implementing the "Control Surface" creative direction
 * (docs/landing-redesign/phase-1/creative-direction.md). This is a semantic-token
 * FOUNDATION, not a finished visual redesign — Prompt 2 wires these into whatever
 * styling stack it chooses (Tailwind v4 `@theme`, CSS custom properties, or both;
 * see phase-2-brief.md's "styling decision" note) and verifies WCAG AA contrast
 * for every module accent (see modules.js) before shipping.
 */
export const COLOR_TOKENS = Object.freeze({
  canvas: "#f9fafb",
  surface: "#ffffff",
  ink: "#101828",
  // Was #667085 (4.44:1 against brandAccentSoft/#eef2ff — fails WCAG AA's
  // 4.5:1 for normal text). Darkened to the minimal value that clears AA
  // with real margin (4.83:1), found via axe-core scanning all Phase 7
  // representative routes — a real, MEASURED, site-wide finding (228 nodes
  // across 9 of 13 routes), not a one-off component bug. See
  // docs/landing-redesign/phase-7/decision-log.md.
  mutedInk: "#5d6b81",
  border: "#e4e7ec",
  brandAccent: "#4338ca",
  brandAccentStrong: "#3730a3",
  brandAccentSoft: "#eef2ff",
  signalCyan: "#0891b2",
  success: "#15803d",
  warning: "#b45309",
  error: "#b91c1c",
  focusRing: "#4338ca",
});

export const RADIUS_TOKENS = Object.freeze({
  control: 8,
  card: 12,
  panel: 16,
});

export const SPACING_SCALE = Object.freeze([4, 8, 12, 16, 20, 24, 32, 48, 64]);

export const SHADOW_TOKENS = Object.freeze({
  subtle: "0 1px 2px rgba(16, 24, 40, 0.04)",
  panel: "0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)",
});

export const CONTAINER_TOKENS = Object.freeze({
  maxWidth: 1600,
  gridColumns: 12,
});

export const BREAKPOINT_TOKENS = Object.freeze({
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1440,
});

export const MOTION_TOKENS = Object.freeze({
  hoverLiftPx: 2,
  // Interaction easing/durations: anything the user directly triggers (press, open/close).
  durationFastMs: 120,
  durationBaseMs: 200,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  // Entrance easing/duration: passive content arrival (scroll reveals, hero on-load).
  durationSlowMs: 400,
  easingEntrance: "cubic-bezier(0.16, 1, 0.3, 1)",
  revealDistancePx: 8,
  respectsReducedMotion: true,
});

export const TYPOGRAPHY_TOKENS = Object.freeze({
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  headlineTrackingEm: -0.045,
  bodyLineHeight: 1.65,
  numericVariant: "tabular-nums",
});

/**
 * Phase 2 extension: semantic categories required by phase-2-brief.md /
 * docs/landing-redesign/phase-2/design-system-specification.md. Every value here
 * resolves to a COLOR_TOKENS entry (never a new raw hex) so there is exactly one
 * place the actual brand palette is defined. See docs/landing-redesign/phase-2/
 * decision-log.md for why this extends, rather than replaces, the Phase 1 palette.
 */
export const SEMANTIC_BACKGROUND = Object.freeze({
  page: COLOR_TOKENS.canvas,
  subtle: COLOR_TOKENS.brandAccentSoft,
  inverse: COLOR_TOKENS.ink,
  elevated: COLOR_TOKENS.surface,
  brand: COLOR_TOKENS.brandAccent,
  selected: COLOR_TOKENS.brandAccentSoft,
});

export const SEMANTIC_TEXT = Object.freeze({
  primary: COLOR_TOKENS.ink,
  secondary: COLOR_TOKENS.mutedInk,
  muted: COLOR_TOKENS.mutedInk,
  inverse: COLOR_TOKENS.surface,
  brand: COLOR_TOKENS.brandAccentStrong,
  link: COLOR_TOKENS.brandAccent,
  disabled: "#98a2b3",
});

export const SEMANTIC_BORDER = Object.freeze({
  default: COLOR_TOKENS.border,
  strong: "#98a2b3",
  subtle: "#eef1f4",
  brand: COLOR_TOKENS.brandAccent,
  error: COLOR_TOKENS.error,
  focus: COLOR_TOKENS.focusRing,
});

export const SEMANTIC_STATE = Object.freeze({
  success: COLOR_TOKENS.success,
  successSoft: "#eaf8ef",
  warning: COLOR_TOKENS.warning,
  warningSoft: "#fef3e2",
  error: COLOR_TOKENS.error,
  errorSoft: "#fdeded",
  information: COLOR_TOKENS.signalCyan,
  informationSoft: "#e5f6fa",
  focus: COLOR_TOKENS.focusRing,
  disabled: "#98a2b3",
});

/** Tokens for framing and annotating real product screenshots (never used for marketing chrome). */
export const SEMANTIC_PRODUCT = Object.freeze({
  frame: COLOR_TOKENS.border,
  chrome: "#f2f4f7",
  canvas: COLOR_TOKENS.surface,
  annotation: COLOR_TOKENS.brandAccent,
  highlight: "#fef3e2",
});
