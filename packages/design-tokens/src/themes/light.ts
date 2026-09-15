import * as semantic from "../semantic/index.ts";

/**
 * The only theme today — the rebuild brief is explicit that this is a
 * light-canvas-first product; dark mode is intentionally out of scope
 * until it has its own design pass (see apps/web/src/app/tokens.css's
 * dark-mode media query stub).
 */
export const lightTheme = {
  surface: semantic.surface,
  text: semantic.text,
  border: semantic.border,
  action: semantic.action,
  status: semantic.status,
  focus: semantic.focus,
  navigation: semantic.navigation,
  overlay: semantic.overlay,
  typography: semantic.typography,
  spacing: semantic.gap,
  controlHeight: semantic.controlHeight,
  touchTarget: semantic.touchTarget,
  density: semantic.density,
  state: semantic.state,
} as const;

export type Theme = typeof lightTheme;
