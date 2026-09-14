import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.join(repoRoot, "packages/design-tokens/tokens/theme.json");
const webPath = path.join(repoRoot, "apps/web/src/shared/design/tokens.css");
const nativePath = path.join(repoRoot, "apps/mobile/src/shared/theme/tokens.ts");
const theme = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const px = (value) => `${value}px`;
const c = theme.color;
const a = theme.alpha;
const s = theme.spacing;
const r = theme.radius;
const control = theme.control;
const layout = theme.layout;
const z = theme.z;
const motion = theme.motion;
const t = theme.webType;

const web = `/* GENERATED from packages/design-tokens/tokens/theme.json. Do not edit directly. */\n:root,\n[data-erp-theme="light"] {\n  --erp-font-sans: ${theme.font.sans};\n\n  --erp-color-canvas: ${c.canvas};\n  --erp-color-canvas-strong: ${c.canvasStrong};\n  --erp-color-surface: ${c.surface};\n  --erp-color-surface-subtle: ${c.surfaceSubtle};\n  --erp-color-surface-raised: ${c.surfaceRaised};\n  --erp-color-text: ${c.text};\n  --erp-color-text-secondary: ${c.textSecondary};\n  --erp-color-text-muted: ${c.textMuted};\n  --erp-color-text-subtle: ${c.textSubtle};\n  --erp-color-border: ${c.border};\n  --erp-color-border-strong: ${c.borderStrong};\n  --erp-color-accent: ${c.accent};\n  --erp-color-accent-strong: ${c.accentStrong};\n  --erp-color-accent-soft: ${c.accentSoft};\n  --erp-color-accent-border: ${c.accentBorder};\n  --erp-color-success: ${c.success};\n  --erp-color-success-emphasis: ${c.successEmphasis};\n  --erp-color-success-soft: ${c.successSoft};\n  --erp-color-warning: ${c.warning};\n  --erp-color-warning-emphasis: ${c.warningEmphasis};\n  --erp-color-warning-soft: ${c.warningSoft};\n  --erp-color-danger: ${c.danger};\n  --erp-color-danger-emphasis: ${c.dangerEmphasis};\n  --erp-color-danger-soft: ${c.dangerSoft};\n  --erp-color-info: ${c.info};\n  --erp-color-info-emphasis: ${c.infoEmphasis};\n  --erp-color-info-soft: ${c.infoSoft};\n  --erp-color-on-accent: ${c.onAccent};\n  --erp-color-navigation: ${c.navigation};\n  --erp-color-navigation-text: ${c.navigationText};\n  --erp-color-navigation-muted: ${c.navigationMuted};\n  --erp-color-overlay-backdrop: ${a.overlayBackdrop};\n  --erp-color-overlay-backdrop-soft: ${a.backdropSoft};\n  --erp-color-overlay-backdrop-strong: ${a.overlayBackdropStrong};\n  --erp-color-surface-glass: ${a.surfaceGlass};\n  --erp-color-surface-glass-strong: ${a.surfaceGlassStrong};\n  --erp-alpha-shadow-subtle: ${a.shadowSubtle};\n  --erp-alpha-shadow-panel: ${a.shadowPanel};\n  --erp-alpha-shadow-overlay: ${a.shadowOverlay};\n  --erp-alpha-focus: ${a.focus};\n\n  --erp-shadow-subtle: 0 1px 2px ${a.shadowSubtle};\n  --erp-shadow-panel: 0 8px 24px ${a.shadowPanel};\n  --erp-shadow-overlay: 0 24px 64px ${a.shadowOverlay};\n  --erp-shadow-focus: 0 0 0 3px ${a.focus};\n\n  --erp-radius-control: ${px(r.control)};\n  --erp-radius-card: ${px(r.card)};\n  --erp-radius-panel: ${px(r.panel)};\n  --erp-radius-overlay: ${px(r.overlay)};\n  --erp-radius-pill: ${px(r.pill)};\n\n  --erp-control-height-compact: ${px(control.compact)};\n  --erp-control-height: ${px(control.standard)};\n  --erp-control-height-large: ${px(control.large)};\n  --erp-touch-target: ${px(control.webTouchTarget)};\n\n  --erp-space-1: ${px(s["1"])};\n  --erp-space-2: ${px(s["2"])};\n  --erp-space-3: ${px(s["3"])};\n  --erp-space-4: ${px(s["4"])};\n  --erp-space-5: ${px(s["5"])};\n  --erp-space-6: ${px(s["6"])};\n  --erp-space-8: ${px(s["8"])};\n  --erp-space-10: ${px(s["10"])};\n  --erp-space-12: ${px(s["12"])};\n\n  --erp-primary-rail-width: ${px(layout.primaryRailWidth)};\n  --erp-secondary-sidebar-width: ${px(layout.secondarySidebarWidth)};\n  --erp-content-max: ${px(layout.contentMax)};\n  --erp-topbar-height: ${px(layout.topbarHeight)};\n  --erp-page-gutter-desktop: ${px(layout.pageGutterDesktop)};\n  --erp-page-gutter-tablet: ${px(layout.pageGutterTablet)};\n  --erp-page-gutter-mobile: ${px(layout.pageGutterMobile)};\n  --erp-page-gutter-narrow: ${px(layout.pageGutterNarrow)};\n\n  --erp-z-base: ${z.base};\n  --erp-z-sticky: ${z.sticky};\n  --erp-z-dropdown: ${z.dropdown};\n  --erp-z-drawer: ${z.drawer};\n  --erp-z-modal: ${z.modal};\n  --erp-z-toast: ${z.toast};\n\n  --erp-motion-fast: ${motion.fast}ms;\n  --erp-motion-standard: ${motion.standard}ms;\n\n  --erp-font-size-xs: ${px(t.xs)};\n  --erp-font-size-sm: ${px(t.sm)};\n  --erp-font-size-md: ${px(t.md)};\n  --erp-font-size-lg: ${px(t.lg)};\n  --erp-font-size-xl: ${px(t.xl)};\n  --erp-font-size-2xl: ${px(t["2xl"])};\n  --erp-line-height-tight: ${t.lineHeightTight};\n  --erp-line-height-body: ${t.lineHeightBody};\n  --erp-font-weight-medium: ${t.weightMedium};\n  --erp-font-weight-semibold: ${t.weightSemibold};\n  --erp-font-weight-bold: ${t.weightBold};\n}\n`;

const nt = theme.nativeType;
const native = `/* GENERATED from packages/design-tokens/tokens/theme.json. Do not edit directly. */\nexport const palette = Object.freeze({\n  navy950: "${c.navigation}",\n  navy900: "${c.navigation}",\n  navy800: "${c.text}",\n  slate900: "${c.text}",\n  slate700: "${c.textSecondary}",\n  slate500: "${c.textMuted}",\n  slate300: "${c.borderStrong}",\n  slate200: "${c.border}",\n  slate100: "${c.canvasStrong}",\n  canvas: "${c.canvas}",\n  white: "${c.surface}",\n  indigo700: "${c.accentStrong}",\n  indigo600: "${c.accent}",\n  indigo100: "${c.accentBorder}",\n  indigo50: "${c.accentSoft}",\n  cyan600: "${c.info}",\n  success700: "${c.success}",\n  success50: "${c.successSoft}",\n  warning700: "${c.warning}",\n  warning50: "${c.warningSoft}",\n  danger700: "${c.danger}",\n  danger50: "${c.dangerSoft}",\n  navigationMuted: "${c.navigationMuted}",\n});\n\nexport const spacing = Object.freeze({\n  xxs: ${s["1"]},\n  xs: ${s["2"]},\n  sm: ${s["3"]},\n  md: ${s["4"]},\n  lg: ${s["5"]},\n  xl: ${s["6"]},\n  xxl: ${s["8"]},\n  hero: ${s["12"]},\n});\n\nexport const radii = Object.freeze({\n  sm: ${r.control},\n  md: ${r.card},\n  lg: ${r.panel},\n  xl: ${r.overlay},\n  full: ${r.pill},\n});\n\nexport const typeScale = Object.freeze({\n  display: { fontSize: ${nt.display[0]}, lineHeight: ${nt.display[1]}, fontWeight: "${nt.display[2]}" as const },\n  title: { fontSize: ${nt.title[0]}, lineHeight: ${nt.title[1]}, fontWeight: "${nt.title[2]}" as const },\n  heading: { fontSize: ${nt.heading[0]}, lineHeight: ${nt.heading[1]}, fontWeight: "${nt.heading[2]}" as const },\n  body: { fontSize: ${nt.body[0]}, lineHeight: ${nt.body[1]}, fontWeight: "${nt.body[2]}" as const },\n  label: { fontSize: ${nt.label[0]}, lineHeight: ${nt.label[1]}, fontWeight: "${nt.label[2]}" as const },\n  caption: { fontSize: ${nt.caption[0]}, lineHeight: ${nt.caption[1]}, fontWeight: "${nt.caption[2]}" as const },\n});\n\nexport const breakpoints = Object.freeze({\n  narrow: ${theme.breakpoint.narrow},\n  mobile: ${theme.breakpoint.mobile},\n  tablet: ${theme.breakpoint.tablet},\n  compactDesktop: ${theme.breakpoint.compactDesktop},\n});\n\nexport const minimumTouchTarget = ${control.nativeTouchTarget};\n`;

function apply(file, content) {
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
      console.error(`Generated theme file is out of date: ${path.relative(repoRoot, file)}`);
      process.exitCode = 1;
    }
    return;
  }
  fs.writeFileSync(file, content);
}

apply(webPath, web);
apply(nativePath, native);
if (!process.argv.includes("--check")) console.log(`Generated canonical theme ${theme.version} for web and native.`);
