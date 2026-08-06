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
  mutedInk: "#667085",
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
  durationFastMs: 120,
  durationBaseMs: 200,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  respectsReducedMotion: true,
});

export const TYPOGRAPHY_TOKENS = Object.freeze({
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  headlineTrackingEm: -0.045,
  bodyLineHeight: 1.65,
  numericVariant: "tabular-nums",
});
