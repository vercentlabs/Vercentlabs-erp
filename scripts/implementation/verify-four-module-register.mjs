import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const file = new URL("../../docs/implementation/four-module-feature-register.json", import.meta.url);
const rows = JSON.parse(await readFile(file, "utf8"));
assert.ok(Array.isArray(rows), "The feature register must be a JSON array.");
assert.equal(rows.length, 419, "The four-module benchmark must retain all 419 capabilities.");

const required = [
  "Module",
  "Subdomain",
  "Capability",
  "Status",
  "Priority",
  "Recommended Wave",
  "Current Evidence",
  "Missing / Incomplete Detail",
  "Recommended Implementation",
];
const keys = new Set();
for (const [index, row] of rows.entries()) {
  for (const field of required) {
    assert.ok(String(row[field] ?? "").trim(), `Row ${index + 1} is missing ${field}.`);
  }
  assert.ok(["CRM", "Sales", "Accounting", "Procurement"].includes(row.Module), `Row ${index + 1} has an unknown module.`);
  assert.ok(["Implemented", "Needs hardening", "Partial", "Missing"].includes(row.Status), `Row ${index + 1} has an unknown status.`);
  assert.ok(["P0", "P1", "P2", "P3"].includes(row.Priority), `Row ${index + 1} has an unknown priority.`);
  const key = `${row.Module}:${row.Subdomain}:${row.Capability}`.toLowerCase();
  assert.ok(!keys.has(key), `Duplicate capability: ${key}`);
  keys.add(key);
}

const counts = rows.reduce((result, row) => {
  result[row.Module] = (result[row.Module] || 0) + 1;
  return result;
}, {});
assert.deepEqual(counts, { CRM: 83, Sales: 93, Accounting: 140, Procurement: 103 });
console.log("Four-module feature register verified:", counts);
