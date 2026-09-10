import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => failures.push(message);
const posix = (value) => value.split(path.sep).join("/");

function walkFiles(directory, extensions) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(relative, extensions));
    else if (!extensions || extensions.has(path.extname(entry.name))) files.push(posix(relative));
  }
  return files;
}

function exactFeatureIds(source) {
  return [...source.matchAll(/id:\s*"(F\d{3})"/g)].map((match) => match[1]);
}

const expectedIds = Array.from(
  { length: 30 },
  (_, index) => `F${String(index + 1).padStart(3, "0")}`,
);

const required = [
  "packages/shared-ui/tokens/theme.json",
  "scripts/design/generate-theme.mjs",
  "apps/web/src/shared/design/tokens.css",
  "apps/mobile/src/shared/theme/tokens.ts",
  "apps/web/src/modules/crm/ui/crm.css",
  "apps/web/src/modules/crm/ui/crm-route-registry.ts",
  "apps/web/src/modules/crm/ui/crm-route-experience.tsx",
  "apps/web/src/modules/crm/ui/crm-surface-registry.ts",
  "apps/web/src/modules/crm/ui/crm-feature-directory.tsx",
  "apps/web/src/modules/crm/ui/crm-calendar-workspace.tsx",
  "apps/mobile/src/modules/crm/ui/crm-feature-registry.ts",
  "apps/mobile/src/app/(protected)/crm/index.tsx",
  "apps/web/src/app/(app)/crm/features/page.tsx",
  "apps/web/src/app/(app)/crm/calendar/page.tsx",
  "apps/web/src/app/(app)/crm/data-management/page.tsx",
];
for (const file of required) if (!exists(file)) fail(`Missing canonical CRM UI/UX file: ${file}`);

// One design-token source must generate both web and native platform adapters.
if (exists("scripts/design/generate-theme.mjs")) {
  const result = spawnSync(process.execPath, ["scripts/design/generate-theme.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`Generated web/native theme adapters are stale: ${(result.stderr || result.stdout).trim()}`);
  }
}

if (exists("packages/shared-ui/tokens/theme.json")) {
  const theme = JSON.parse(read("packages/shared-ui/tokens/theme.json"));
  for (const key of ["color", "spacing", "radius", "control", "layout", "breakpoint", "motion", "webType", "nativeType"]) {
    if (!theme[key]) fail(`Canonical theme source is missing ${key}.`);
  }
  const bp = theme.breakpoint ?? {};
  if (bp.narrow !== 480 || bp.mobile !== 768 || bp.tablet !== 1024 || bp.compactDesktop !== 1280) {
    fail("Canonical theme breakpoints must remain 480 / 768 / 1024 / 1280.");
  }
  if (theme.control?.webTouchTarget < 44 || theme.control?.nativeTouchTarget < 48) {
    fail("Canonical theme touch targets must remain at least 44px web / 48px native.");
  }
}

const rootLayout = read("apps/web/src/app/layout.tsx");
if (/import\s+["']\.\/crm-[^"']+\.css["']/.test(rootLayout)) {
  fail("CRM feature CSS is still globally imported by the ERP root layout.");
}

const appCss = fs.readdirSync(path.join(root, "apps/web/src/app"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^crm-.*\.css$/.test(entry.name))
  .map((entry) => entry.name);
if (appCss.length) fail(`Legacy app-root CRM stylesheets remain: ${appCss.join(", ")}`);

const crmLayout = read("apps/web/src/app/(app)/crm/layout.tsx");
const crmCssImports = [...crmLayout.matchAll(/import\s+["']([^"']+\.css)["']/g)].map((match) => match[1]);
if (crmCssImports.length !== 1 || crmCssImports[0] !== "@/modules/crm/ui/crm.css") {
  fail(`CRM route layout must import exactly one canonical stylesheet; found ${JSON.stringify(crmCssImports)}.`);
}
if (!crmLayout.includes('data-crm-ui="canonical"')) fail("CRM layout is missing the canonical UI root marker.");
if (!crmLayout.includes("<CrmRouteExperience")) fail("CRM layout is missing the canonical route experience wrapper.");
if (/crm-ui-system\.css|crm-(?:shell|home|lead-workspaces|experience)\.css/.test(crmLayout)) {
  fail("CRM layout still references a retired presentation layer.");
}

const surfaces = read("apps/web/src/modules/crm/ui/crm-surface-registry.ts");
const webIds = exactFeatureIds(surfaces);
if (JSON.stringify(webIds) !== JSON.stringify(expectedIds)) {
  fail(`Web CRM feature registry must map exactly F001-F030; found ${webIds.join(", ")}.`);
}

const mobileRegistry = read("apps/mobile/src/modules/crm/ui/crm-feature-registry.ts");
const mobileIds = exactFeatureIds(mobileRegistry);
if (JSON.stringify(mobileIds) !== JSON.stringify(expectedIds)) {
  fail(`Mobile CRM feature registry must map exactly F001-F030; found ${mobileIds.join(", ")}.`);
}
for (const support of ["native", "native-read", "native-action", "web-workspace"]) {
  if (!mobileRegistry.includes(`support: "${support}"`)) fail(`Mobile CRM registry has no ${support} disposition.`);
}

const mobileManifest = read("apps/mobile/src/modules/crm/manifest.ts");
if (!mobileManifest.includes('"crm"')) fail("Mobile CRM manifest is missing the canonical CRM home route.");
const mobileCatalog = read("apps/mobile/src/core/modules/catalog.ts");
if (!mobileCatalog.includes('"/(protected)/crm"')) fail("Mobile module catalog does not route CRM to its canonical home.");

const routes = read("apps/web/src/modules/crm/ui/crm-route-registry.ts");
for (const archetype of [
  "home",
  "list-work-queue",
  "record-360",
  "board",
  "calendar",
  "inbox",
  "analytics",
  "data-operations",
  "setup-catalog",
  "setup-rule",
  "feature-directory",
]) {
  if (!routes.includes(`| "${archetype}"`) && !routes.includes(`archetype: "${archetype}"`)) {
    fail(`CRM route registry is missing page archetype ${archetype}.`);
  }
}

const nav = read("apps/web/src/core/navigation/modules.ts");
for (const href of [
  "/crm", "/crm/leads", "/crm/accounts", "/crm/contacts", "/crm/opportunities", "/crm/pipeline", "/crm/forecast",
  "/crm/work", "/crm/tasks", "/crm/calls", "/crm/meetings", "/crm/follow-ups", "/crm/calendar", "/crm/activities",
  "/crm/inbox", "/crm/reports", "/crm/data-management", "/crm/features", "/crm/settings",
]) {
  if (!nav.includes(`href: "${href}"`)) fail(`Canonical CRM navigation is missing ${href}.`);
}

const setup = read("apps/web/src/app/(app)/crm/settings/page.tsx");
for (const href of [
  "/crm/sources", "/crm/lead-lifecycle", "/crm/assignment-rules", "/crm/qualification-criteria", "/crm/lead-scoring", "/crm/duplicate-rules",
  "/crm/pipelines", "/crm/stages", "/crm/lost-reasons", "/crm/sales-teams", "/crm/sales-team-members", "/crm/territories", "/crm/territory-assignments",
  "/crm/quota-plans", "/crm/data-management", "/crm/tags", "/crm/custom-object-definitions", "/crm/custom-field-definitions", "/crm/custom-records", "/crm/features",
]) {
  if (!setup.includes(`href: "${href}"`)) fail(`CRM Setup discoverability map is missing ${href}.`);
}
if (/F0\d\d/.test(setup)) fail("CRM Setup leaks internal feature IDs into customer-facing copy.");

// CSS convergence: a single canonical route stylesheet plus capability CSS Modules,
// all tokenized and using the same breakpoint grammar.
const cssFiles = walkFiles("apps/web/src/modules/crm", new Set([".css"]));
const allowedMedia = new Set([
  "(max-width:479px)",
  "(max-width:767px)",
  "(max-width:1023px)",
  "(max-width:1279px)",
  "(min-width:768px)and(max-width:1023px)",
  "(min-width:1024px)",
  "(min-width:1280px)",
  "(prefers-reduced-motion:reduce)",
  "print",
]);
for (const file of cssFiles) {
  const css = read(file);
  if (/(?:#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\()/i.test(css)) {
    fail(`${file}: raw color literal found; CRM styles must consume canonical --erp-* tokens.`);
  }
  if (/!important\b/.test(css)) fail(`${file}: !important is forbidden in canonical CRM styling.`);
  if (/:root\b/.test(css)) fail(`${file}: CRM styles may not define a competing :root token source.`);
  for (const match of css.matchAll(/@media\s*([^\{]+)\{/g)) {
    const normalized = match[1].trim().replace(/\s+/g, "").replace(/\s*:\s*/g, ":");
    if (!allowedMedia.has(normalized)) fail(`${file}: noncanonical media query ${match[1].trim()}.`);
  }
}

const css = read("apps/web/src/modules/crm/ui/crm.css");
for (const token of [
  "--erp-color-surface", "--erp-color-text", "--erp-color-border", "--erp-color-accent", "--erp-radius-panel", "--erp-shadow-focus",
  "--erp-font-size-xs", "--erp-font-size-md", "--erp-space-4", "--erp-touch-target",
]) {
  if (!css.includes(token)) fail(`Canonical CRM CSS does not consume required ERP token ${token}.`);
}
for (const breakpoint of ["1279px", "1023px", "767px", "479px"]) {
  if (!css.includes(`max-width: ${breakpoint}`)) fail(`CRM responsive system is missing breakpoint ${breakpoint}.`);
}
if (!css.includes("prefers-reduced-motion")) fail("CRM canonical stylesheet is missing reduced-motion behavior.");
if (!css.includes(":focus-visible")) fail("CRM canonical stylesheet is missing keyboard focus styling.");
if (!css.includes("var(--erp-touch-target)")) fail("CRM canonical stylesheet is not using the shared touch target token.");

const crmUiSourceFiles = [
  ...walkFiles("apps/web/src/modules/crm", new Set([".ts", ".tsx", ".js", ".jsx"])),
  ...walkFiles("apps/web/src/app/(app)/crm", new Set([".ts", ".tsx", ".js", ".jsx"])),
];
for (const file of crmUiSourceFiles) {
  const source = read(file);
  if (/window\.(?:confirm|prompt|alert)\s*\(/.test(source)) fail(`Browser-native dialog remains in CRM UI: ${file}.`);
  if (/<dialog(?:\s|>)/.test(source) || /\.showModal\s*\(/.test(source)) fail(`Native/custom dialog primitive remains in CRM UI: ${file}.`);
}

const mobileUiFiles = [
  ...walkFiles("apps/mobile/src/modules/crm", new Set([".ts", ".tsx"])),
  ...walkFiles("apps/mobile/src/app/(protected)/crm", new Set([".ts", ".tsx"])),
  "apps/mobile/src/app/(protected)/(tabs)/leads.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/pipeline.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/activities.tsx",
].filter(exists);
for (const file of mobileUiFiles) {
  const source = read(file);
  if (/#[0-9a-f]{3,8}\b/i.test(source)) fail(`${file}: raw color literal found; mobile CRM must use the generated theme adapter.`);
}

if (failures.length) {
  console.error("CRM UNIFIED UI/UX VALIDATION FAILED:");
  for (const item of failures) console.error(`  ERROR: ${item}`);
  process.exit(1);
}

console.log("CRM unified UI/UX: PASS");
console.log(" - one generated cross-platform semantic theme source");
console.log(" - one CRM route stylesheet; zero app-root CRM stylesheets");
console.log(" - zero raw CRM CSS colors / !important / competing :root blocks");
console.log(" - canonical 480 / 768 / 1024 / 1280 responsive grammar");
console.log(" - shared Dialog owns CRM web overlay behavior");
console.log(" - 30/30 web capability surfaces and 30/30 mobile dispositions mapped");
