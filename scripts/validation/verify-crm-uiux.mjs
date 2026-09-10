import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => failures.push(message);

function walkFiles(directory, extensions = new Set([".ts", ".tsx", ".js", ".jsx"])) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(relative, extensions));
    else if (extensions.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

const required = [
  "apps/web/src/modules/crm/ui/crm-ui-system.css",
  "apps/web/src/modules/crm/ui/crm-surface-registry.ts",
  "apps/web/src/modules/crm/ui/crm-feature-directory.tsx",
  "apps/web/src/modules/crm/ui/crm-calendar-workspace.tsx",
  "apps/web/src/app/(app)/crm/features/page.tsx",
  "apps/web/src/app/(app)/crm/calendar/page.tsx",
  "apps/web/src/app/(app)/crm/data-management/page.tsx",
];
for (const file of required) if (!exists(file)) fail(`Missing canonical CRM UI/UX file: ${file}`);

const rootLayout = read("apps/web/src/app/layout.tsx");
if (/import\s+["']\.\/crm-[^"']+\.css["']/.test(rootLayout)) {
  fail("CRM feature CSS is still globally imported by the ERP root layout.");
}

const crmLayout = read("apps/web/src/app/(app)/crm/layout.tsx");
if (!crmLayout.includes('data-crm-ui="canonical"')) fail("CRM layout is missing the canonical UI root marker.");
if (!crmLayout.includes('crm-ui-system.css')) fail("CRM layout does not load the canonical CRM UI layer.");

const surfaces = read("apps/web/src/modules/crm/ui/crm-surface-registry.ts");
for (let index = 1; index <= 30; index += 1) {
  const id = `F${String(index).padStart(3, "0")}`;
  if (!surfaces.includes(`id: "${id}"`)) fail(`CRM UI surface registry is missing ${id}.`);
}
const surfaceRows = [...surfaces.matchAll(/\{ id: "F\d{3}"/g)].length;
if (surfaceRows !== 30) fail(`CRM UI surface registry has ${surfaceRows} feature rows; expected exactly 30.`);

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

const css = read("apps/web/src/modules/crm/ui/crm-ui-system.css");
for (const token of ["--erp-color-surface", "--erp-color-text", "--erp-color-border", "--erp-color-accent", "--erp-radius-panel", "--erp-shadow-focus"]) {
  if (!css.includes(token)) fail(`Canonical CRM CSS does not consume required ERP token ${token}.`);
}
for (const breakpoint of ["1279px", "1023px", "767px", "479px"]) {
  if (!css.includes(`max-width: ${breakpoint}`)) fail(`CRM responsive system is missing breakpoint ${breakpoint}.`);
}
if (!css.includes("prefers-reduced-motion")) fail("CRM UI layer is missing reduced-motion behavior.");
if (!css.includes(":focus-visible")) fail("CRM UI layer is missing explicit keyboard focus styling.");
if (!css.includes("--crm-touch-target: 44px")) fail("CRM UI layer is missing its 44px minimum touch target baseline.");

const crmUiSourceFiles = [
  ...walkFiles("apps/web/src/modules/crm"),
  ...walkFiles("apps/web/src/app/(app)/crm"),
];
for (const file of crmUiSourceFiles) {
  const source = read(file);
  if (/window\.(?:confirm|prompt|alert)\s*\(/.test(source)) {
    fail(`Browser-native dialog remains in CRM UI: ${file}.`);
  }
  if (/(^|[^\w.])(?:confirm|prompt)\s*\(/m.test(source) && !file.endsWith("crm-command-dialog-provider.tsx")) {
    fail(`Ungoverned confirm/prompt call remains in CRM UI: ${file}.`);
  }
}

if (/F0\d\d/.test(setup)) fail("CRM Setup leaks internal feature IDs into customer-facing copy.");

if (failures.length) {
  console.error("CRM UI/UX validation failed:");
  for (const item of failures) console.error(`  ERROR: ${item}`);
  process.exit(1);
}
console.log("CRM UI/UX canonical coverage: PASS (30/30 features mapped)");
