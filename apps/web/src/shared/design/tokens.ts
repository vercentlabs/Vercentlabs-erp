/**
 * Semantic CSS-variable references for Experience Kernel components.
 * Values live in tokens.css; components should consume these references rather
 * than duplicating literal colors, radii, spacing or z-index values.
 */
export const ERP_DESIGN_TOKENS = Object.freeze({
  color: {
    canvas: "var(--erp-color-canvas)",
    surface: "var(--erp-color-surface)",
    surfaceSubtle: "var(--erp-color-surface-subtle)",
    text: "var(--erp-color-text)",
    textSecondary: "var(--erp-color-text-secondary)",
    textMuted: "var(--erp-color-text-muted)",
    border: "var(--erp-color-border)",
    borderStrong: "var(--erp-color-border-strong)",
    accent: "var(--erp-color-accent)",
    accentStrong: "var(--erp-color-accent-strong)",
    accentSoft: "var(--erp-color-accent-soft)",
    success: "var(--erp-color-success)",
    warning: "var(--erp-color-warning)",
    danger: "var(--erp-color-danger)",
  },
  radius: {
    control: "var(--erp-radius-control)",
    card: "var(--erp-radius-card)",
    panel: "var(--erp-radius-panel)",
    overlay: "var(--erp-radius-overlay)",
    pill: "var(--erp-radius-pill)",
  },
  shadow: {
    subtle: "var(--erp-shadow-subtle)",
    panel: "var(--erp-shadow-panel)",
    overlay: "var(--erp-shadow-overlay)",
    focus: "var(--erp-shadow-focus)",
  },
} as const);
