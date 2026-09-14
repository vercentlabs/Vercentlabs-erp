#!/usr/bin/env node
// Static route smoke validation. This does NOT boot Next.js and does NOT
// require a database or environment variables — it walks src/app and
// checks structural invariants that would otherwise only surface at
// `next build` time or in the browser.
//
// Restored (checks 1-3 only) from the pre-clean-slate-rebuild archive —
// see docs/frontend-rebuild/README.md. The original also had checks 4-6
// (navigation registry / Quick Create / topbar destination href
// resolution), dropped here because they hardcoded expectations about the
// old navigation registry (src/core/navigation/) and specific CRM routes
// that don't exist in the new architecture yet, by design — nothing has
// been built past the bootstrap placeholder. Restore that logic once the
// new app shell has a real navigation registry to check against (see
// docs/ux/UI_REWRITE_TRACKER.md's "Immediate next action"), rather than
// guessing its shape now. This intentionally does NOT attempt to import or
// render every module — that would require full Next.js/webpack resolution
// of path aliases, CSS imports and React Server Component boundaries. It
// instead checks the same class of mistake statically and cheaply:
//   1. Every page.tsx has a default export.
//   2. Every route.ts exports at least one recognized HTTP method handler.
//   3. No two sibling directories both define a dynamic segment (a real
//      Next.js App Router build-time conflict, e.g. [id] and [slug] as
//      immediate children of the same parent).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/app",
);

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

let failures = 0;
let pagesChecked = 0;
let routesChecked = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL  ${message}`);
}

function relative(file) {
  return path.relative(appRoot, file).split(path.sep).join("/");
}

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, callback);
    } else {
      callback(full, entry.name);
    }
  }
}

// --- Check 1: every page.tsx has a default export -------------------------
walk(appRoot, (file, name) => {
  if (name !== "page.tsx") return;
  pagesChecked += 1;
  const source = fs.readFileSync(file, "utf8");
  const hasDefaultExport =
    /export\s+default\s+(async\s+)?function/.test(source) ||
    /export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/m.test(source) ||
    /^\s*export\s+default\s+/m.test(source);
  if (!hasDefaultExport) {
    fail(`${relative(file)}: no "export default" found — page will not render`);
  }
});

// --- Check 2: every route.ts exports a recognized HTTP method handler -----
walk(appRoot, (file, name) => {
  if (name !== "route.ts") return;
  routesChecked += 1;
  const source = fs.readFileSync(file, "utf8");
  const exported = HTTP_METHODS.filter(
    (method) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(
        source,
      ) || new RegExp(`export\\s+const\\s+${method}\\s*=`).test(source),
  );
  if (exported.length === 0) {
    fail(
      `${relative(file)}: exports no recognized HTTP method handler (${HTTP_METHODS.join("/")})`,
    );
  }
});

// --- Check 3: no sibling directories define conflicting dynamic segments --
function dynamicSegmentName(directoryName) {
  if (!directoryName.startsWith("[")) return null;
  // Normalizes [id], [...slug] and [[...slug]] down to a comparable key —
  // any dynamic segment at all conflicts with a differently-named sibling.
  return directoryName.replace(/^\[+\.{0,3}/, "").replace(/]+$/, "");
}

function checkDynamicSiblings(dir) {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  const dynamicNames = new Set();
  for (const entry of entries) {
    if (entry.name.startsWith("(")) continue; // route groups are not real segments
    const dynamicName = dynamicSegmentName(entry.name);
    if (dynamicName) dynamicNames.add(dynamicName);
  }
  if (dynamicNames.size > 1) {
    fail(
      `${relative(dir)}: conflicting dynamic segments as siblings (${[...dynamicNames].join(", ")}) — Next.js requires one dynamic slug name per route level`,
    );
  }
  for (const entry of entries) {
    checkDynamicSiblings(path.join(dir, entry.name));
  }
}

checkDynamicSiblings(appRoot);

console.log(
  `Checked ${pagesChecked} page.tsx and ${routesChecked} route.ts file(s) under src/app.`,
);
if (failures > 0) {
  console.error(`\nverify:routes summary — ${failures} failing check(s).`);
  process.exitCode = 1;
} else {
  console.log(
    "Route smoke validation passed (static analysis only — Next.js was not booted).",
  );
}
