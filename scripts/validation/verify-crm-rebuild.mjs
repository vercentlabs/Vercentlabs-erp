import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => failures.push(message);
const lines = (file) => read(file).split(/\r?\n/).length;
const walk = (directory) => {
  const out = [];
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(directory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) out.push(...walk(relative));
    else out.push(relative);
  }
  return out;
};

const WEB_CAPABILITIES = [
  "prospect-and-relationship-master-data",
  "lead-lifecycle-qualification-and-prioritization",
  "opportunity-and-pipeline-governance",
  "seller-activity-and-follow-up-workspace",
  "sales-organization-and-coverage",
  "crm-data-operations-and-customization",
  "crm-conversion-and-sales-handoff",
  "pipeline-analytics-and-forecasting",
];
const WEB_ROOT_DIRECTORIES = [...WEB_CAPABILITIES, "ui"];

// Public endpoint hardening lives inside capability-owned handlers; route.ts is now a thin adapter.
const booking = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/route-handlers/public-meeting-bookings.ts");
if (/new Map</.test(booking)) fail("Public meeting booking uses a process-local Map rate limiter.");
if (!/enforceRateLimit/.test(booking)) fail("Public meeting booking is missing distributed rate limiting.");
if (!/readRequestBytes/.test(booking) || /request\.json\(\)/.test(booking)) fail("Public meeting booking body is not bounded.");

const chat = read("apps/web/src/modules/crm/prospect-and-relationship-master-data/route-handlers/public-lead-chat.ts");
if (!/\^\[0-9a-f\]\\\{48\\\}\$/.test(chat) && !/\[0-9a-f\]\{48\}/.test(chat)) fail("Public chat token shape validation is missing.");
if (!/enforceRateLimit/.test(chat)) fail("Public chat throttling is missing.");
if (!/readRequestBytes/.test(chat) || /request\.json\(\)/.test(chat)) fail("Public chat body is not bounded.");

const inbound = read("apps/web/src/modules/crm/prospect-and-relationship-master-data/route-handlers/public-inbound-email.ts");
if (!/NODE_ENV === "production"/.test(inbound) || !/requiredSecret\.length < 32/.test(inbound)) {
  fail("Inbound email does not fail closed on weak/missing production authentication.");
}

// All server-rendered CRM pages must enter through the entitlement-gated context.
for (const file of [...walk("apps/web/src/app/(app)/crm"), "apps/web/src/app/(app)/search/page.tsx", "apps/web/src/orchestration/integrations.ts"]) {
  if (!file.endsWith("page.tsx") && !file.endsWith("integrations.ts")) continue;
  const source = read(file);
  if (/[^.\w]crmContext\(session\)/.test(source)) fail(`${file} still uses un-gated crmContext(session).`);
}

// Next route files are transport adapters, never persistence owners.
const directPersistence = [];
for (const file of walk("apps/web/src/app/api/crm").filter((value) => value.endsWith("route.ts"))) {
  const source = read(file);
  if (/\bclient\.query\s*\(|\bquery\s*</.test(source)) directPersistence.push(file);
}
if (directPersistence.length) fail(`Direct persistence remains in CRM route handlers: ${directPersistence.join(", ")}`);

// Clean capability ownership: no old components/server/features buckets or flat API implementation files.
for (const capability of WEB_CAPABILITIES) {
  if (!exists(`apps/web/src/modules/crm/${capability}`)) fail(`Missing web CRM capability directory: ${capability}`);
  if (!exists(`services/api/src/modules/crm/${capability}`)) fail(`Missing API CRM capability directory: ${capability}`);
}
for (const entry of fs.readdirSync(path.join(root, "apps/web/src/modules/crm"), { withFileTypes: true })) {
  if (entry.isDirectory() && !WEB_ROOT_DIRECTORIES.includes(entry.name)) fail(`Legacy/ad-hoc web CRM root directory remains: ${entry.name}`);
  if (entry.isFile() && entry.name !== "index.ts") fail(`Unexpected web CRM root file remains: ${entry.name}`);
}
for (const entry of fs.readdirSync(path.join(root, "services/api/src/modules/crm"), { withFileTypes: true })) {
  if (entry.isDirectory() && !WEB_CAPABILITIES.includes(entry.name)) fail(`Legacy/ad-hoc API CRM root directory remains: ${entry.name}`);
  if (entry.isFile() && !["index.js", "index.d.ts"].includes(entry.name)) fail(`Unexpected API CRM root file remains: ${entry.name}`);
}

// Prevent giant public roots and extreme single-file CRM ownership from returning.
for (const [file, limit] of [
  ["services/api/src/modules/crm/index.js", 300],
  ["apps/web/src/modules/crm/index.ts", 100],
  ["apps/web/src/modules/crm/crm-data-operations-and-customization/resource-definitions.ts", 250],
  ["apps/web/src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx", 2000],
  ["apps/web/src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx", 2000],
]) {
  if (!exists(file)) fail(`Expected CRM architecture file is missing: ${file}`);
  else if (lines(file) > limit) fail(`${file} is ${lines(file)} lines (limit ${limit}); decomposition regressed.`);
}
for (const file of [...walk("apps/web/src/modules/crm"), ...walk("services/api/src/modules/crm")]) {
  if (!/\.(?:ts|tsx|js)$/.test(file)) continue;
  if (lines(file) > 2500) fail(`${file} is ${lines(file)} lines; no CRM implementation file may exceed 2500 lines.`);
}

// Declarative resource catalog is domain-sharded rather than one giant map.
for (const shard of [
  "prospect-and-relationship", "lead-lifecycle", "opportunity-pipeline", "seller-activity",
  "sales-organization", "data-operations", "conversion-handoff", "analytics-forecasting",
]) {
  const file = `apps/web/src/modules/crm/crm-data-operations-and-customization/resource-definitions/${shard}.ts`;
  if (!exists(file)) fail(`Missing CRM resource-definition shard: ${shard}`);
  else if (lines(file) > 900) fail(`CRM resource-definition shard ${shard} grew beyond 900 lines.`);
}

// First-class navigation for daily work and previously-hidden governed resources.
const requiredPages = ["work", "tasks", "calls", "meetings", "follow-ups", "calendar", "inbox", "features", "data-management"];
for (const page of requiredPages) if (!exists(`apps/web/src/app/(app)/crm/${page}/page.tsx`)) fail(`Missing first-class CRM page /crm/${page}.`);
const nav = read("apps/web/src/core/navigation/modules.ts");
for (const href of ["/crm/work", "/crm/tasks", "/crm/calls", "/crm/meetings", "/crm/follow-ups", "/crm/calendar", "/crm/inbox", "/crm/features", "/crm/data-management", "/crm/settings"]) {
  if (!nav.includes(`href: "${href}"`)) fail(`CRM navigation is missing ${href}.`);
}
const setupPage = read("apps/web/src/app/(app)/crm/settings/page.tsx");
for (const href of ["/crm/sales-teams", "/crm/territories", "/crm/quota-plans", "/crm/duplicate-rules"]) {
  if (!setupPage.includes(`href: "${href}"`)) fail(`CRM setup is missing governed destination ${href}.`);
}
const capabilityRegistry = read("apps/web/src/modules/crm/crm-data-operations-and-customization/capability-registry.ts");
if (!capabilityRegistry.includes('"quota-plans"')) fail("quota-plans is still not UI-reachable.");

// Reports implemented by API must be exposed by the governed report registry.
const reportKeys = ["pipeline", "conversion", "sources", "activities", "forecast", "revenue-operations", "pipeline-intelligence", "engagement-intelligence", "relationship-coverage", "campaigns", "account-health", "partner-pipeline", "privacy", "ai-governance"];
for (const key of reportKeys) if (!capabilityRegistry.includes(`"${key}"`)) fail(`Implemented CRM report is not exposed: ${key}.`);

// Remove temporary/rebuild/version naming from active CRM-owned file names.
const forbiddenName = /(enterprise|redesign|extension|(?:^|[-_.])v[23](?:[-_.]|$)|pass[0-9])/i;
for (const file of [...walk("apps/web/src/modules/crm"), ...walk("services/api/src/modules/crm"), ...walk("apps/web/tests"), ...walk("services/api/tests")]) {
  const base = path.basename(file);
  if ((/crm/i.test(file) || file.includes("modules/crm")) && forbiddenName.test(base)) fail(`Temporary/legacy naming remains in active CRM file: ${file}`);
}

if (failures.length) {
  console.error("CRM v2 reconstruction validation failed:");
  for (const item of failures) console.error(`  ERROR: ${item}`);
  process.exit(1);
}
console.log("CRM v2 reconstruction safeguards: PASS");
