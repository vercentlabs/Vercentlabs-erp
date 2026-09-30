// Shared plumbing for the Vercentlabs CRM demo seeders: local-only guard,
// organization lookup, a tenant transaction per governed call, and a domain
// context per person built from their REAL built-in role permissions (so the
// services apply the same scope and permission rules they apply to a user).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";

import { setTenantContext } from "../../packages/database/src/index.js";
import { permissionsForRole } from "../../packages/permissions/src/roles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")])
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });

export const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";

export async function openSeedKit() {
  const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
  if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
  const db = new Client({ connectionString, application_name: "vercentlabs-crm-seed" });
  await db.connect();
  const org = (await db.query(`SELECT id FROM organizations WHERE lower(name) = lower($1) LIMIT 1`, [ORG_NAME])).rows[0];
  if (!org) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const organizationId = org.id;

  async function withTx(fn) {
    await db.query("BEGIN");
    try {
      await setTenantContext(db, organizationId);
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }

  async function company() {
    const row = (await db.query(`SELECT id FROM companies WHERE organization_id=$1 AND is_primary ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];
    if (!row) return { companyId: null, branchId: null };
    const branch = (await db.query(`SELECT id FROM branches WHERE organization_id=$1 AND company_id=$2 ORDER BY is_primary DESC, created_at LIMIT 1`, [organizationId, row.id])).rows[0];
    return { companyId: row.id, branchId: branch?.id ?? null };
  }

  /** Domain context for a member, with their assigned role's permissions. */
  async function contextFor(userId) {
    const { companyId, branchId } = await company();
    const roles = (await db.query(
      `SELECT r.slug FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.organization_id=$1 AND a.user_id=$2 AND a.status='active'`,
      [organizationId, userId],
    )).rows.map((row) => row.slug);
    const permissions = [...new Set(roles.flatMap((slug) => permissionsForRole(slug) ?? []))];
    return {
      organizationId,
      userId,
      activeCompanyId: companyId,
      activeBranchId: branchId,
      allowAllCompanies: roles.includes("organization_owner"),
      permissions,
      roleSlugs: roles,
    };
  }

  async function owner() {
    return (await db.query(
      `SELECT u.id, u.full_name FROM users u JOIN organization_memberships m ON m.user_id=u.id
        JOIN user_role_assignments a ON a.user_id=u.id AND a.organization_id=m.organization_id AND a.status='active'
        JOIN roles r ON r.id=a.role_id AND r.slug='organization_owner'
       WHERE m.organization_id=$1 AND m.status='active' ORDER BY m.created_at LIMIT 1`,
      [organizationId],
    )).rows[0];
  }

  const count = async (table, where = "true", params = []) =>
    Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1 AND ${where}`, [organizationId, ...params])).rows[0].n);

  return { db, organizationId, withTx, company, contextFor, owner, count, close: () => db.end() };
}

// Deterministic randomness, so a re-run makes the same choices.
let seed = Number(process.env.SEED_RANDOM ?? 20260930);
export function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
export const pick = (list) => list[Math.floor(random() * list.length)];
export const between = (min, max) => Math.floor(random() * (max - min + 1)) + min;
export const chance = (probability) => random() < probability;
export function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
export function daysFromNow(days, hour = between(9, 18), minute = pick([0, 15, 30, 45])) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
export const dateFromNow = (days) => daysFromNow(days, 12, 0).slice(0, 10);
export const slug = (value) => value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").slice(0, 30);
export const phone = () => `+91 ${pick(["98", "99", "97", "96", "90", "88", "87", "82", "81", "70"])}${between(100, 999)} ${between(10000, 99999)}`;
export function log(message) {
  process.stdout.write(`${message}\n`);
}
