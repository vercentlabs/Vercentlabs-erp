import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const register = JSON.parse(fs.readFileSync(path.join(root, "docs/implementation/four-module-feature-register.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, "docs/implementation/four-module-feature-evidence.json"), "utf8"));

if (!Array.isArray(register) || register.length !== 419) {
  console.error(`Expected 419 benchmark capabilities; found ${Array.isArray(register) ? register.length : "invalid register"}.`);
  process.exit(1);
}
if (!Array.isArray(evidence) || evidence.length !== register.length) {
  console.error(`Evidence ledger must contain exactly ${register.length} rows.`);
  process.exit(1);
}

const failures = [];
for (let index = 0; index < register.length; index += 1) {
  const row = register[index];
  const proof = evidence[index];
  const label = `${proof?.id ?? index + 1} ${row.Module} / ${row.Capability}`;
  if (proof?.module !== row.Module || proof?.subdomain !== row.Subdomain || proof?.capability !== row.Capability) {
    failures.push(`${label}: evidence ledger is out of sync with the register.`);
    continue;
  }
  if (row.Status !== "Implemented") failures.push(`${label}: register status is ${row.Status}.`);
  if (!Array.isArray(proof.implementationPaths) || proof.implementationPaths.length === 0) failures.push(`${label}: implementation evidence is missing.`);
  if (!Array.isArray(proof.testPaths) || proof.testPaths.length === 0) failures.push(`${label}: executable test evidence is missing.`);
  if (proof.acceptanceStatus !== "verified") failures.push(`${label}: acceptance is not verified.`);
  if (!proof.verifiedAt || !proof.verifiedBy) failures.push(`${label}: verifier identity/date is missing.`);
}

if (failures.length) {
  console.error(`419-capability completion gate failed with ${failures.length} evidence gaps.`);
  console.error(failures.slice(0, 80).map((failure) => `- ${failure}`).join("\n"));
  if (failures.length > 80) console.error(`- ... ${failures.length - 80} additional gaps omitted.`);
  process.exit(1);
}

console.log("All 419 capabilities have implementation, executable-test and acceptance evidence.");
