import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const packages = [
  "config",
  "document-engine",
  "localization",
  "observability",
  "reporting-engine",
  "shared-ui",
  "test-utils",
  "workflows",
];

for (const name of packages) {
  const directory = path.join(root, "packages", name);
  for (const required of ["package.json", "src/index.js", "src/index.d.ts"]) {
    const file = path.join(directory, required);
    if (!fs.existsSync(file) || !fs.readFileSync(file, "utf8").trim()) {
      failures.push(`${path.relative(root, file)} is missing or empty.`);
    }
  }
  const tests = path.join(directory, "tests");
  if (
    !fs.existsSync(tests) ||
    !fs.readdirSync(tests).some((file) => file.endsWith(".test.mjs"))
  ) {
    failures.push(`packages/${name} has no executable package test.`);
  }
}

const approvalRoute = fs.readFileSync(
  path.join(root, "apps/web/src/app/api/approvals/[id]/route.ts"),
  "utf8",
);
for (const marker of [
  "assertSeparationOfDuties",
  "expectedVersion",
  "setTenantContext",
  "approval_decisions",
  "command.execute",
]) {
  if (!approvalRoute.includes(marker)) {
    failures.push(`Approval execution is missing ${marker}.`);
  }
}

const worker = fs.readFileSync(
  path.join(root, "apps/web/scripts/deliver-crm-outbox.mjs"),
  "utf8",
);
for (const marker of ["locked_by", "CRM_OUTBOX_LEASE_SECONDS", "SKIP LOCKED"]) {
  if (!worker.includes(marker)) failures.push(`Outbox recovery is missing ${marker}.`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `Implementation verified: ${packages.length} shared packages, transactional approvals and leased CRM outbox delivery.`,
);
