// Shared plumbing for operational commands (file migration, reconciliation,
// secret re-encryption, status). They run as a Kubernetes Job with the
// migration authority (MIGRATION_DATABASE_URL) or locally against the dev
// database, and print a JSON summary suitable for a release record. Nothing
// secret is ever printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadEnvironment() {
  for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
    if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
  }
}

export function flags(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    options[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value === undefined ? true : value;
  }
  return options;
}

export async function withOperationsClient(work) {
  const { loadSecretFiles } = await import("../../packages/config/src/index.js");
  loadSecretFiles(process.env);
  const { resolveDbSsl } = await import("../../packages/database/src/index.js");
  const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
  const client = new pg.Client({ connectionString, application_name: "vercentlabs-operations", ssl: resolveDbSsl(process.env) });
  await client.connect();
  const withTransaction = async (inner) => {
    await client.query("BEGIN");
    try {
      const result = await inner(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };
  try {
    return await work({ client, withTransaction });
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function report(name, summary, { failed = false } = {}) {
  console.log(JSON.stringify({ command: name, at: new Date().toISOString(), ...summary }, null, 2));
  if (failed) process.exitCode = 1;
}
