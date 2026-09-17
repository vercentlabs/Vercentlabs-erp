// Phase 8 validator: re-derives the route security matrix fresh (never
// trusts a possibly-stale committed CSV) and fails the process if any
// mutation-capable route lacks BOTH authentication and an origin check,
// unless it appears in generate-route-security-matrix.mjs's
// DOCUMENTED_EXCEPTIONS with a real, specific reason. A route with
// authorization but no plain "authentication" primitive (e.g. one that
// only calls requireCrmAccess, which itself requires a session) is not
// flagged — this checks for the presence of SOME real gate, not that
// every route spells its check identically.
import { execSync } from "node:child_process";
import fs from "node:fs";

execSync("node scripts/qa/generate-route-security-matrix.mjs", { stdio: "inherit" });

const csv = fs.readFileSync("docs/frontend-rebuild/ROUTE_SECURITY_MATRIX.csv", "utf8");
const [headerLine, ...lines] = csv.trim().split("\n");
const header = headerLine.split(",");

function parseCsvLine(line) {
  // Minimal parser matching this file's own csvField() escaping — good
  // enough for this specific generated file, not a general CSV parser.
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

const rows = lines.map((line) => {
  const values = parseCsvLine(line);
  return Object.fromEntries(header.map((key, index) => [key, values[index]]));
});

const failures = [];
for (const row of rows) {
  const hasAuth = row.has_auth === "true";
  const hasOrigin = row.has_origin_check === "true";
  const exempt = Boolean(row.documented_exception);
  if (exempt) continue;
  if (!hasAuth || !hasOrigin) {
    failures.push(
      `${row.route} [${row.mutation_methods}] — missing ${!hasAuth ? "authentication" : ""}${!hasAuth && !hasOrigin ? " and " : ""}${!hasOrigin ? "an origin check" : ""}, and is not in DOCUMENTED_EXCEPTIONS`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\nROUTE SECURITY VALIDATION FAILED — ${failures.length} route(s) with an unprotected mutation and no documented reason:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nEither add the missing check, or add a DOCUMENTED_EXCEPTIONS entry in scripts/qa/generate-route-security-matrix.mjs naming the actual alternative protection.\n");
  process.exit(1);
}

console.log(`Route security validation passed — ${rows.length} mutation-capable routes checked, 0 unexplained gaps.`);
