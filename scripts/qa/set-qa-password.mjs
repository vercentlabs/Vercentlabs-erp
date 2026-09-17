#!/usr/bin/env node
// One-off local-dev-only utility: sets a KNOWN password for existing QA/E2E
// fixture users so a real browser session can be authenticated for the
// Prompt 3 visual QA pass. Never run against anything but the local
// MIGRATION_DATABASE_URL (loaded the same way scripts/database/migrate.mjs
// does) — refuses if the connection string doesn't look like localhost.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { hashPassword } from "../../services/api/src/core/session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  throw new Error("Refusing to run against a non-local database.");
}

const emails = process.argv.slice(2);
const password = "CrmQaFixture!2026";
if (!emails.length) throw new Error("Usage: set-qa-password.mjs <email> [email...]");

const client = new Client({ connectionString });
await client.connect();
try {
  const hash = await hashPassword(password);
  for (const email of emails) {
    const result = await client.query(
      `UPDATE public.users SET password_hash=$2, password_changed_at=now() WHERE lower(email)=lower($1) RETURNING id, email`,
      [email, hash],
    );
    if (!result.rows[0]) {
      console.log(`NOT FOUND: ${email}`);
      continue;
    }
    console.log(`OK: ${result.rows[0].email} -> password set (id ${result.rows[0].id})`);
  }
  console.log(`\nShared QA password: ${password}`);
} finally {
  await client.end();
}
