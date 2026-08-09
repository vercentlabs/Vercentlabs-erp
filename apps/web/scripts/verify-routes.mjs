#!/usr/bin/env node
// Static route smoke validation. This does NOT boot Next.js and does NOT
// require a database or environment variables — it walks src/app and
// checks structural invariants that would otherwise only surface at
// `next build` time or in the browser. See docs/implementation/
// ERP_VERIFICATION_BASELINE_002.md, "Web route smoke validation".
//
// With ~116 page.tsx files and ~279 route.ts files (per docs/implementation/
// ERP_WEB_AUDIT_001.md), this intentionally does NOT attempt to import or
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

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/app");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

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
  const exported = HTTP_METHODS.filter((method) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source) ||
    new RegExp(`export\\s+const\\s+${method}\\s*=`).test(source),
  );
  if (exported.length === 0) {
    fail(`${relative(file)}: exports no recognized HTTP method handler (${HTTP_METHODS.join("/")})`);
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
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
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

// --- Check 4: every navigation registry href resolves to a real route -----
// Static-analysis only (Part 33 explicitly prefers this over importing the
// registry through a TS loader): the registry's .ts files declare
// `href: "/some/path"` literals directly, so this extracts them by regex
// rather than executing TypeScript. Each href must resolve to either a
// literal page.tsx at that path, or fall through a dynamic `[resource]`-
// style segment already present in the file tree (the established
// `<module>/[resource]/page.tsx` pattern most modules use for their
// non-overview destinations) — see docs/implementation/
// ERP_NAVIGATION_FOUNDATION_006.md Section 10.
const navigationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/navigation");
const authenticatedAppRoot = path.join(appRoot, "(app)");

function extractHrefs(source) {
  const hrefs = [];
  const re = /href:\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(source))) hrefs.push(match[1]);
  return hrefs;
}

// A literal segment directory existing does not guarantee it resolves the
// requested path — e.g. crm/leads/ only contains [id]/page.tsx (the list
// view is actually served by the sibling crm/[resource]/page.tsx). Next.js
// itself falls through to a dynamic sibling whenever the literal branch has
// no page.tsx at the needed depth, so this tries the literal branch first
// and backtracks to any dynamic sibling if that whole branch dead-ends,
// rather than greedily committing to the first directory match found.
function resolveSegments(dir, segments) {
  if (segments.length === 0) return fs.existsSync(path.join(dir, "page.tsx"));
  const [segment, ...rest] = segments;
  const literal = path.join(dir, segment);
  if (fs.existsSync(literal) && fs.statSync(literal).isDirectory()) {
    if (resolveSegments(literal, rest)) return true;
  }
  const dynamicSiblings = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("["));
  return dynamicSiblings.some((sibling) => resolveSegments(path.join(dir, sibling.name), rest));
}

function routeExists(hrefPath) {
  const withoutQuery = hrefPath.split("?")[0].split("#")[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  return resolveSegments(authenticatedAppRoot, segments);
}

let navigationHrefsChecked = 0;
if (fs.existsSync(navigationDir)) {
  const seenPerFile = new Map();
  for (const file of fs.readdirSync(navigationDir)) {
    if (!file.endsWith(".ts") || file === "types.ts" || file === "resolve-navigation.ts" || file === "match-path.ts" || file === "route-map.ts" || file === "breadcrumb-labels.ts" || file === "index.ts") continue;
    const fullPath = path.join(navigationDir, file);
    const source = fs.readFileSync(fullPath, "utf8");
    const hrefs = extractHrefs(source);
    const seen = new Set();
    for (const href of hrefs) {
      navigationHrefsChecked += 1;
      if (seen.has(href)) {
        fail(`navigation/${file}: duplicate href "${href}" declared more than once in the same file`);
      }
      seen.add(href);
      if (!routeExists(href)) {
        fail(`navigation/${file}: href "${href}" does not resolve to any page.tsx under src/app/(app)`);
      }
    }
    seenPerFile.set(file, seen);
  }
}

// --- Check 5: every Quick Create action href resolves to a real route ----
// (Part 52: "Quick Create hrefs must resolve... do not allow dead launcher
// actions.") Same static-extraction + routeExists approach as Check 4;
// routeExists already strips query strings (?create=1) before resolving.
const quickCreateFile = path.join(navigationDir, "../quick-create/actions.ts");
let quickCreateHrefsChecked = 0;
if (fs.existsSync(quickCreateFile)) {
  const source = fs.readFileSync(quickCreateFile, "utf8");
  const hrefs = extractHrefs(source);
  const seen = new Set();
  for (const href of hrefs) {
    quickCreateHrefsChecked += 1;
    if (seen.has(href)) {
      fail(`quick-create/actions.ts: duplicate href "${href}" declared more than once`);
    }
    seen.add(href);
    if (!routeExists(href)) {
      fail(`quick-create/actions.ts: href "${href}" does not resolve to any page.tsx under src/app/(app)`);
    }
  }
}

// --- Check 6: the topbar's hardcoded platform destinations resolve -------
// (Part 52: "profile/settings destinations resolve") — these are static
// <Link>s in components/{profile-menu,app-shell,notifications-control}.tsx,
// not registry-driven, so they're checked directly rather than extracted.
const staticTopbarDestinations = ["/profile", "/security", "/notifications", "/dashboard"];
for (const href of staticTopbarDestinations) {
  if (!routeExists(href)) {
    fail(`static topbar destination "${href}" does not resolve to any page.tsx under src/app/(app)`);
  }
}

console.log(`Checked ${pagesChecked} page.tsx and ${routesChecked} route.ts file(s) under src/app.`);
console.log(`Checked ${navigationHrefsChecked} navigation registry href(s) under src/lib/navigation.`);
console.log(`Checked ${quickCreateHrefsChecked} Quick Create action href(s) and ${staticTopbarDestinations.length} static topbar destination(s).`);
if (failures > 0) {
  console.error(`\nverify:routes summary — ${failures} failing check(s).`);
  process.exitCode = 1;
} else {
  console.log("Route smoke validation passed (static analysis only — Next.js was not booted).");
}
