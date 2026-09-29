// Re-derives the route security matrix from source (never trusts the
// committed CSV), writes it, and fails when:
//   - any handler is UNKNOWN (unclassified, or its class's evidence is gone);
//   - a SELF_SERVICE mutation has no origin check;
//   - a PUBLIC_AUTH mutation has no origin check;
//   - an explicit registry entry no longer matches a route file (stale).
import fs from "node:fs";

import { buildMatrix, EXPLICIT_ROUTES, OUTPUT, PLATFORM_DOMAIN_AUTHORIZATION, writeMatrix } from "./generate-route-security-matrix.mjs";

const rows = buildMatrix();
writeMatrix(rows);

const failures = [];
const mutation = (row) => row.method !== "GET";
for (const row of rows) {
  const at = `${row.route} ${row.method}`;
  if (row.class === "UNKNOWN") failures.push(`${at}: unclassified${row.protection ? ` (${row.protection})` : ""} — use workspaceRoute()/apiKeyRoute(), or add an EXPLICIT_ROUTES entry naming the real protection`);
  if ((row.class === "SELF_SERVICE" || row.class === "PUBLIC_AUTH") && mutation(row) && !row.originCheck) failures.push(`${at}: ${row.class} mutation without a same-origin check`);
}
// Unauthenticated token endpoints must be rate limited by a durable,
// replica-shared limiter (auth_rate_limits via enforcePublicRateLimits /
// enforceRateLimit) in EVERY handler. A domain-level limiter counts only
// when named here with the call that enforces it.
const DURABLE_LIMIT = /\benforcePublicRateLimits\s*\(|\benforceRateLimit\s*\(/;
const DOMAIN_RATE_LIMITED = Object.freeze({
  "api/crm/public/capture/[key]/route.ts": /\bcaptureCrmLead\s*\(/, // tenant.crm_capture_rate_limits, per form + fingerprint per hour
});
const handlerBodies = (source) => {
  const parts = source.split(/(?=export\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE)\b)/);
  return parts.slice(1).map((part) => ({ method: part.match(/function\s+(\w+)/)[1], body: part }));
};
for (const route of new Set(rows.filter((row) => row.class === "PUBLIC_TOKEN").map((row) => row.route))) {
  const source = fs.readFileSync(`apps/web/src/app/${route}`, "utf8");
  for (const { method, body } of handlerBodies(source)) {
    const domain = DOMAIN_RATE_LIMITED[route];
    if (!DURABLE_LIMIT.test(body) && !(domain && domain.test(body))) failures.push(`${route} ${method}: public token endpoint without a durable rate limit (enforcePublicRateLimits)`);
  }
}
// Request bodies are always read through the byte-bounded readJson/readJsonBody
// (100 KB default) or readRequestBytes; a raw request.json() reads unbounded.
const walkRoutes = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walkRoutes(`${directory}/${entry.name}`) : entry.name === "route.ts" ? [`${directory}/${entry.name}`] : []));
for (const file of walkRoutes("apps/web/src/app/api")) {
  if (/\b(?:request|req)\.(?:json|text|arrayBuffer)\s*\(\s*\)/.test(fs.readFileSync(file, "utf8"))) failures.push(`${file}: unbounded body read — use readJson()/readRequestBytes() from @/core`);
}
for (const route of [...Object.keys(EXPLICIT_ROUTES), ...Object.keys(PLATFORM_DOMAIN_AUTHORIZATION)]) {
  if (!fs.existsSync(`apps/web/src/app/${route}`)) failures.push(`registry entry ${route} has no route file (stale)`);
}

if (failures.length) {
  console.error(`\nROUTE SECURITY VALIDATION FAILED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
const counts = rows.reduce((acc, row) => ({ ...acc, [row.class]: (acc[row.class] ?? 0) + 1 }), {});
console.log(`Route security validation passed — ${rows.length} handlers classified (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}), 0 UNKNOWN. Matrix: ${OUTPUT}`);
