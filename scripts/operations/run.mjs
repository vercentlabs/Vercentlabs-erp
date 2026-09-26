#!/usr/bin/env node
// Entry point of the operations Job (infrastructure/kubernetes/jobs/operations):
//   node scripts/operations/run.mjs <operation> [--dry-run]
// One named operation per Job; the same commands run locally through pnpm.
// contract-apply is the only destructive operation: it runs the contract
// migrations, each of which re-checks its own preconditions and refuses to
// change anything when the data is not ready (docs/operations/RELEASE_RUNBOOK.md).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrate = path.join(here, "../database/migrate.mjs");
const OPERATIONS = Object.freeze({
  status: [[path.join(here, "status.mjs")]],
  "files-migrate-legacy": [[path.join(here, "files-migrate-legacy.mjs")]],
  "files-reconcile": [[path.join(here, "files-reconcile.mjs")]],
  "secrets-reencrypt": [[path.join(here, "secrets-reencrypt.mjs")]],
  "secrets-migrate-legacy": [[path.join(here, "secrets-reencrypt.mjs"), "--legacy"]],
  "restore-verify": [[path.join(here, "restore-verify.mjs")]],
  "contract-plan": [
    [migrate, "platform", "--contract", "--plan"],
    [migrate, "tenant", "--contract", "--plan"],
  ],
  "contract-apply": [
    [migrate, "platform", "--contract", "--confirm"],
    [migrate, "tenant", "--contract", "--confirm"],
  ],
});
const DRY_RUN_CAPABLE = new Set(["files-migrate-legacy", "secrets-reencrypt", "secrets-migrate-legacy"]);

const [operation, ...rest] = process.argv.slice(2);
const steps = OPERATIONS[operation];
if (!steps) {
  console.error(`Unknown operation "${operation ?? ""}". One of: ${Object.keys(OPERATIONS).join(", ")}`);
  process.exit(2);
}
const extra = DRY_RUN_CAPABLE.has(operation) ? rest.filter((arg) => arg === "--dry-run") : [];
for (const step of steps) {
  const result = spawnSync(process.execPath, [...step, ...extra], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
