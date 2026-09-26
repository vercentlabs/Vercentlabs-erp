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
