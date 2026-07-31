import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rows = JSON.parse(fs.readFileSync(path.join(root, "docs/implementation/four-module-feature-register.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, "docs/implementation/four-module-feature-evidence.json"), "utf8"));
const summary = new Map();
for (const row of rows) {
  const key = `${row.Module}::${row.Status}`;
  summary.set(key, (summary.get(key) ?? 0) + 1);
}
for (const module of ["CRM", "Sales", "Accounting", "Procurement"]) {
  const statuses = [...new Set(rows.filter((row) => row.Module === module).map((row) => row.Status))];
  console.log(`\n${module}`);
  for (const status of statuses.sort()) console.log(`  ${status}: ${summary.get(`${module}::${status}`) ?? 0}`);
}
const verified = evidence.filter((row) => row.acceptanceStatus === "verified").length;
const withImplementation = evidence.filter((row) => row.implementationPaths.length > 0).length;
const withTests = evidence.filter((row) => row.testPaths.length > 0).length;
console.log(`\nEvidence: implementation ${withImplementation}/419, tests ${withTests}/419, acceptance ${verified}/419.`);
