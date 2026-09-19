// SP011 Section 3 validator: re-derives the billing-mutation inventory
// fresh and fails the process if any CRM/POS mutation-capable route is
// neither billing-write-gated nor named in generate-billing-mutation-
// inventory.mjs's DOCUMENTED_EXCLUSIONS with a real, reviewed reason.
// Mirrors validate-route-security.mjs's shape exactly. Scope: CRM and POS
// only, matching the tracker's own disclosed finding that the other 10
// modules have no route/UI layer at all yet (nothing to validate there).
import { execSync } from "node:child_process";
import fs from "node:fs";

execSync("node scripts/qa/generate-billing-mutation-inventory.mjs", { stdio: "inherit" });

const csv = fs.readFileSync("docs/frontend-rebuild/BILLING_MUTATION_INVENTORY.csv", "utf8");
const [headerLine, ...lines] = csv.trim().split("\n");
const header = headerLine.split(",");

function parseCsvLine(line) {
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

const unaccounted = rows.filter((row) => row.status === "UNACCOUNTED");

if (unaccounted.length > 0) {
  console.error(`\nBILLING MUTATION GATE VALIDATION FAILED — ${unaccounted.length} CRM/POS mutation route(s) are neither billing-write-gated nor documented as excluded:\n`);
  for (const row of unaccounted) console.error(`  - ${row.route} [${row.mutation_methods}]`);
  console.error(
    "\nEither wire requireBillingWriteAccess (directly, via requireCrmMutationAccess, or via requireCrmAccess/requirePosAccess's { mutation: true } option), or add a DOCUMENTED_EXCLUSIONS entry in scripts/qa/generate-billing-mutation-inventory.mjs naming the specific reason this route must remain reachable regardless of subscription-write state.\n",
  );
  process.exit(1);
}

const inScope = rows.filter((row) => row.status !== "out-of-scope");
console.log(
  `Billing mutation gate validation passed — ${inScope.length} in-scope CRM/POS mutation routes checked (${rows.length} total mutation-capable routes repo-wide), 0 unaccounted.`,
);
