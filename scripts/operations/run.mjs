#!/usr/bin/env node
// Entry point of the operations Job (infrastructure/kubernetes/jobs/operations):
//   node scripts/operations/run.mjs <operation> [--dry-run]
// One named operation per Job; the same commands run locally through pnpm.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OPERATIONS = Object.freeze({
  status: ["status.mjs"],
  "files-migrate-legacy": ["files-migrate-legacy.mjs"],
  "files-reconcile": ["files-reconcile.mjs"],
  "secrets-reencrypt": ["secrets-reencrypt.mjs"],
  "secrets-migrate-legacy": ["secrets-reencrypt.mjs", "--legacy"],
});

const [operation, ...rest] = process.argv.slice(2);
const command = OPERATIONS[operation];
if (!command) {
  console.error(`Unknown operation "${operation ?? ""}". One of: ${Object.keys(OPERATIONS).join(", ")}`);
  process.exit(2);
}
const extra = rest.filter((arg) => arg === "--dry-run");
const result = spawnSync(process.execPath, [path.join(here, command[0]), ...command.slice(1), ...extra], { stdio: "inherit" });
process.exit(result.status ?? 1);
