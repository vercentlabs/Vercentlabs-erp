#!/usr/bin/env node
// Generates apps/web/src/app/tokens.css (a Tailwind v4 @theme block) from
// packages/design-tokens/tokens/theme.json — the single source of truth.
// Do not hand-edit the generated file; update theme.json and rerun instead.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.join(repoRoot, "packages/design-tokens/tokens/theme.json");
const outPath = path.join(repoRoot, "apps/web/src/app/tokens.css");
const theme = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const px = (value) => `${value}px`;
const c = theme.color;
const s = theme.spacing;
const r = theme.radius;
const control = theme.control;
const z = theme.z;
const motion = theme.motion;
const t = theme.webType;

const content = `/* GENERATED from packages/design-tokens/tokens/theme.json by
   scripts/design/generate-tailwind-theme.mjs. Do not edit directly. */
@theme {
  /* --font-sans is intentionally NOT set here: next/font/google owns it at
     runtime (apps/web/src/app/layout.tsx) so the actual Inter font loads
     instead of a static fallback stack winning the cascade. See
     packages/design-tokens/tokens/theme.json's font.sans for the source
     value used by generate-theme.mjs for the native (mobile) adapter. */

  /* Semantic color tokens (color.*) */
  --color-canvas: ${c.canvas};
  --color-canvas-strong: ${c.canvasStrong};
  --color-surface: ${c.surface};
  --color-surface-muted: ${c.surfaceSubtle};
  --color-surface-raised: ${c.surfaceRaised};
  --color-text: ${c.text};
  --color-text-secondary: ${c.textSecondary};
  --color-text-muted: ${c.textMuted};
  --color-text-subtle: ${c.textSubtle};
  --color-text-inverse: ${c.onAccent};
  --color-border: ${c.border};
  --color-border-strong: ${c.borderStrong};
  --color-focus: ${theme.alpha.focus};
  --color-brand: ${c.accent};
  --color-brand-hover: ${c.accentStrong};
  --color-brand-active: ${c.accentStrong};
  --color-brand-soft: ${c.accentSoft};
  --color-brand-border: ${c.accentBorder};
  --color-danger: ${c.danger};
  --color-danger-emphasis: ${c.dangerEmphasis};
  --color-danger-soft: ${c.dangerSoft};
  --color-warning: ${c.warning};
  --color-warning-emphasis: ${c.warningEmphasis};
  --color-warning-soft: ${c.warningSoft};
  --color-success: ${c.success};
  --color-success-emphasis: ${c.successEmphasis};
  --color-success-soft: ${c.successSoft};
  --color-info: ${c.info};
  --color-info-emphasis: ${c.infoEmphasis};
  --color-info-soft: ${c.infoSoft};
  --color-navigation: ${c.navigation};
  --color-navigation-text: ${c.navigationText};
  --color-navigation-muted: ${c.navigationMuted};
  --color-overlay-backdrop: ${theme.alpha.overlayBackdrop};
  --color-overlay-backdrop-strong: ${theme.alpha.overlayBackdropStrong};

  /* Spacing (4px grid) */
  --spacing-1: ${px(s["1"])};
  --spacing-2: ${px(s["2"])};
  --spacing-3: ${px(s["3"])};
  --spacing-4: ${px(s["4"])};
  --spacing-5: ${px(s["5"])};
  --spacing-6: ${px(s["6"])};
  --spacing-8: ${px(s["8"])};
  --spacing-10: ${px(s["10"])};
  --spacing-12: ${px(s["12"])};

  /* Radius */
  --radius-control: ${px(r.control)};
  --radius-card: ${px(r.card)};
  --radius-panel: ${px(r.panel)};
  --radius-overlay: ${px(r.overlay)};
  --radius-pill: ${px(r.pill)};

  /* Control heights / touch targets (density.*) */
  --control-height-compact: ${px(control.compact)};
  --control-height-standard: ${px(control.standard)};
  --control-height-large: ${px(control.large)};
  --control-touch-target-web: ${px(control.webTouchTarget)};

  /* Shadows — reserved for menus/popovers/dialogs/overlays only */
  --shadow-subtle: 0 1px 2px ${theme.alpha.shadowSubtle};
  --shadow-panel: 0 8px 24px ${theme.alpha.shadowPanel};
  --shadow-overlay: 0 24px 64px ${theme.alpha.shadowOverlay};
  --shadow-focus: 0 0 0 3px ${theme.alpha.focus};

  /* Typography */
  --text-xs: ${px(t.xs)};
  --text-sm: ${px(t.sm)};
  --text-md: ${px(t.md)};
  --text-lg: ${px(t.lg)};
  --text-section: ${px(t.section)};
  --text-xl: ${px(t.xl)};
  --text-2xl: ${px(t["2xl"])};
  --text-3xl: ${px(t["3xl"])};
  --leading-tight: ${t.lineHeightTight};
  --leading-body: ${t.lineHeightBody};
  --font-weight-medium: ${t.weightMedium};
  --font-weight-semibold: ${t.weightSemibold};
  --font-weight-bold: ${t.weightBold};

  /* Motion */
  --motion-fast: ${motion.fast}ms;
  --motion-standard: ${motion.standard}ms;

  /* Z-index scale */
  --z-base: ${z.base};
  --z-sticky: ${z.sticky};
  --z-dropdown: ${z.dropdown};
  --z-drawer: ${z.drawer};
  --z-modal: ${z.modal};
  --z-toast: ${z.toast};

  /* Layout */
  --layout-primary-rail-width: ${px(theme.layout.primaryRailWidth)};
  --layout-secondary-sidebar-width: ${px(theme.layout.secondarySidebarWidth)};
  --layout-content-max: ${px(theme.layout.contentMax)};
  --layout-topbar-height: ${px(theme.layout.topbarHeight)};

  /* Breakpoints */
  --breakpoint-narrow: ${px(theme.breakpoint.narrow)};
  --breakpoint-mobile: ${px(theme.breakpoint.mobile)};
  --breakpoint-tablet: ${px(theme.breakpoint.tablet)};
  --breakpoint-compact-desktop: ${px(theme.breakpoint.compactDesktop)};
}

@media (prefers-color-scheme: dark) {
  /* Dark mode is not yet designed for the ERP workspace (light-canvas-first
     per the rebuild brief); this guard exists so components that already
     branch on it don't silently break. Revisit when dark mode is scoped. */
}
`;

if (process.argv.includes("--check")) {
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== content) {
    console.error(`Generated Tailwind theme file is out of date: ${path.relative(repoRoot, outPath)}`);
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content);
  console.log(`Generated Tailwind v4 theme (${theme.version}) at ${path.relative(repoRoot, outPath)}`);
}
