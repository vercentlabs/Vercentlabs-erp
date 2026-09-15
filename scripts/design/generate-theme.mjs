import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Generates the mobile-native theme adapter. The web adapter is generated
// separately by generate-tailwind-theme.mjs (a Tailwind v4 @theme block),
// since apps/web no longer uses a hand-rolled --erp-* custom-property
// scheme — see packages/design-tokens/README.md.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.join(repoRoot, "packages/design-tokens/tokens/theme.json");
const nativePath = path.join(repoRoot, "apps/mobile/src/shared/theme/tokens.ts");
const theme = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const c = theme.color;
const s = theme.spacing;
const r = theme.radius;
const control = theme.control;

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

apply(nativePath, native);
if (!process.argv.includes("--check")) console.log(`Generated canonical theme ${theme.version} for native.`);
