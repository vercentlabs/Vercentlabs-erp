#!/usr/bin/env node
// `pnpm verify:shared-runtime` (static half): Shared Runtime ownership
// invariants for notifications, approvals, audit, search and background-job
// visibility. Reads source only; the unit tests it is paired with run the
// pure rules (catalogue/registry parity, job presentation coverage, ...).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

function walk(relative, filter, out = []) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if ([".next", "node_modules", "e2e", "tests", "dist"].includes(entry.name) || entry.name.startsWith(".next")) continue;
    const child = path.join(relative, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) walk(child, filter, out);
    else if (filter(child)) out.push(child);
  }
  return out;
}

const problems = [];
const section = (label, found) => {
  if (found.length) for (const problem of found) console.error(`FAIL  ${label}: ${problem}`);
  else console.log(`OK    ${label}`);
  problems.push(...found);
};

const PLATFORM = "services/api/src/core/platform";
const NOTIFICATION_WRITER = `${PLATFORM}/notifications/service.js`;
const APPROVAL_REPOSITORY = `${PLATFORM}/approvals/repository.js`;
const AUDIT_READER = `${PLATFORM}/audit/reader.js`;
const serverFiles = [...walk("services", (f) => /\.(js|mjs)$/.test(f)), ...walk("packages", (f) => /\.(js|mjs|ts)$/.test(f) && !f.endsWith(".d.ts"))];
const webFiles = walk("apps/web/src", (f) => /\.(ts|tsx)$/.test(f));
const allFiles = [...serverFiles, ...webFiles];

// 1. One canonical implementation per capability; the flat legacy files are gone.
section(
  "legacy flat runtime files are removed",
  ["notifications", "notification-preferences", "approvals", "background-jobs"]
    .flatMap((name) => [`services/api/src/core/${name}.js`, `services/api/src/core/${name}.d.ts`])
    .filter(exists)
    .map((file) => `${file} must not exist (moved into ${PLATFORM}/)`),
);
section(
  "no module-local generic notification helper",
  allFiles.filter((file) => /\bcreateInAppNotification\b/.test(read(file))).map((file) => `${file} uses createInAppNotification; use createNotification`),
);

// 2. Writers.
section(
  "notifications are written only by the platform notification service",
  allFiles.filter((file) => file !== NOTIFICATION_WRITER && /INSERT\s+INTO\s+(public\.)?notifications\b/i.test(read(file))).map((file) => `${file} inserts notifications directly`),
);
section(
  "approval requests and decisions are written only by the platform approval repository",
  allFiles
    .filter((file) => file !== APPROVAL_REPOSITORY && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?approval_(requests|decisions)\b/i.test(read(file)))
    .map((file) => `${file} writes approval rows directly`),
);
section(
  "audit events are read only through the platform audit reader",
  allFiles.filter((file) => file !== AUDIT_READER && /\b(FROM|JOIN)\s+(public\.)?audit_events\b/i.test(read(file))).map((file) => `${file} reads audit_events directly`),
);

// 3. Layering: the platform never imports business modules or orchestration.
section(
  "core/platform does not import modules or orchestration",
  walk(PLATFORM, (f) => /\.(js|d\.ts)$/.test(f))
    .filter((file) => /from\s+["'][^"']*\/(modules|orchestration)\//.test(read(file)))
    .map((file) => `${file} imports a business module or orchestration`),
);

// 4. Search: one server-side provider registry; the browser only calls /api/search.
const searchScreens = walk("apps/web/src/features/platform/search", (f) => /\.(ts|tsx)$/.test(f));
section(
  "global record search runs on the server",
  [
    ...(searchScreens.some((file) => read(file).includes("/api/search")) ? [] : ["the search screen does not call /api/search"]),
    ...searchScreens.filter((file) => /from\s+["']@\/features\/(crm|sales|accounting|point-of-sale)\//.test(read(file))).map((file) => `${file} imports module APIs (browser-side record providers)`),
    ...(exists("services/api/src/orchestration/search/providers.js") ? [] : ["the server provider registry is missing"]),
  ],
);

// 5. Routes: workspaceRoute, correct gates, read-only where required.
const RUNTIME_ROUTES = [
  "apps/web/src/app/api/notifications",
  "apps/web/src/app/api/approvals",
  "apps/web/src/app/api/settings/audit",
  "apps/web/src/app/api/settings/notification-preferences",
  "apps/web/src/app/api/search",
  "apps/web/src/app/api/jobs",
].flatMap((dir) => walk(dir, (f) => f.endsWith("/route.ts")));
const methods = (source) => [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
section(
  "shared runtime routes use workspaceRoute",
  RUNTIME_ROUTES.length === 0 ? ["no shared runtime routes found"] : RUNTIME_ROUTES.filter((file) => !/\bworkspaceRoute\(/.test(read(file))).map((file) => `${file} does not use workspaceRoute`),
);
section(
  "notifications, preferences, audit, search and jobs are never billing-gated",
  RUNTIME_ROUTES.filter((file) => !file.includes("/api/approvals/") && /billingWrite\s*:\s*true/.test(read(file))).map((file) => `${file} is billing-gated`),
);
section(
  "audit routes require audit.view and are read-only",
  walk("apps/web/src/app/api/settings/audit", (f) => f.endsWith("/route.ts")).flatMap((file) => {
    const source = read(file);
    const found = [];
    if (!/permission:\s*CORE_PERMISSIONS\.auditView\b/.test(source)) found.push(`${file} does not require audit.view`);
    if (methods(source).some((method) => method !== "GET")) found.push(`${file} exposes a mutation`);
    return found;
  }),
);
section(
  "job routes are read-only and go through the viewer service",
  walk("apps/web/src/app/api/jobs", (f) => f.endsWith("/route.ts")).flatMap((file) => {
    const source = read(file);
    const found = [];
    if (methods(source).some((method) => method !== "GET")) found.push(`${file} exposes a mutation (no cancel/retry)`);
    if (/\b(FROM|JOIN)\s+tenant\.background_jobs\b/i.test(source)) found.push(`${file} queries background_jobs directly`);
    if (!/\b(listJobsForViewer|getJobForViewer)\b/.test(source)) found.push(`${file} does not use the job viewer service`);
    return found;
  }),
);
section(
  "approval decisions go through the orchestration inbox",
  walk("apps/web/src/app/api/approvals", (f) => f.endsWith("/route.ts"))
    .filter((file) => methods(read(file)).includes("POST") && !/\bdecideApproval\b/.test(read(file)))
    .map((file) => `${file} decides approvals without decideApproval`),
);

// 6. In-app is the only notification channel.
section(
  "notification preferences offer in-app only",
  walk("apps/web/src/features/settings/notification-preferences", (f) => /\.(ts|tsx)$/.test(f))
    .filter((file) => /["'](push|email|sms)["']/.test(read(file)))
    .map((file) => `${file} offers a channel that is not delivered`),
);

if (problems.length) {
  console.error(`\n${problems.length} shared runtime architecture problem(s).`);
  process.exit(1);
}
console.log("\nShared runtime architecture: OK");
