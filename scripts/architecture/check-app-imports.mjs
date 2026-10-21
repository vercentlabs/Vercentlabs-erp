// One app's code calls another app only through a bridge (a file under a bridges/ folder, which checks the other app is on first).
// This lists every import from one app's folder (services/api/src/modules/<app>) into another's and fails on any that is not in the
// baseline (app-imports-baseline.json, the imports that were there when the rule came in, to be moved into bridges). The books are
// shared: imports into accounting are allowed, as are imports into products, gst and related (platform core kept under modules/).
//   node scripts/architecture/check-app-imports.mjs            check
//   node scripts/architecture/check-app-imports.mjs --update   rewrite the baseline (only after moving an import into a bridge)
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modules = join(root, "services/api/src/modules");
const baselineFile = join(dirname(fileURLToPath(import.meta.url)), "app-imports-baseline.json");
const APPS = new Set(["assets", "crm", "hr-payroll", "manufacturing", "point-of-sale", "procurement", "projects", "quality", "sales", "stock", "support"]);
const SHARED = new Set(["accounting", "products", "gst", "related"]);

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.(js|mjs)$/.test(name) ? [path] : [];
});
const appOf = (path) => relative(modules, path).split(sep)[0];

const found = new Set();
for (const file of files(modules)) {
  const from = appOf(file);
  if (!APPS.has(from) || relative(modules, file).split(sep).includes("bridges")) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(file), match[1]);
    if (!target.startsWith(modules + sep)) continue;
    const to = appOf(target);
    if (to === from || SHARED.has(to) || !APPS.has(to)) continue;
    found.add(`${relative(modules, file).split(sep).join("/")} -> ${to}`);
  }
}

const current = [...found].sort();
if (process.argv.includes("--update")) {
  writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Baseline written: ${current.length} cross-app imports.`);
  process.exit(0);
}
const baseline = new Set(JSON.parse(readFileSync(baselineFile, "utf8")));
const added = current.filter((entry) => !baseline.has(entry));
const gone = [...baseline].filter((entry) => !found.has(entry));
if (gone.length) console.log(`${gone.length} baseline import(s) are gone; run with --update to shrink the baseline.`);
if (added.length) {
  console.error(`New imports from one app into another (call it through a bridges/ file that checks hasApp / appOn):\n  ${added.join("\n  ")}`);
  process.exit(1);
}
console.log(`App imports: ${current.length} known cross-app imports, none new.`);
