import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tables = [
  "users",
  "organizations",
  "companies",
  "branches",
  "departments",
  "cost_centers",
  "teams",
  "permissions",
  "roles",
  "role_permissions",
  "user_role_assignments",
  "user_preferences",
  "notifications",
  "numbering_series",
  "organization_modules",
  "workflow_definitions",
  "approval_requests",
  "activities",
  "comments",
  "attachments",
  "custom_field_definitions",
];

try {
  const result = await pool.query(
    "SELECT name, to_regclass('public.' || name) AS relation FROM unnest($1::text[]) AS name ORDER BY name",
    [tables],
  );
  const missing = result.rows
    .filter((row) => !row.relation)
    .map((row) => row.name);
  if (missing.length)
    throw new Error(`Missing database tables: ${missing.join(", ")}`);
  const permissionResult = await pool.query(
    "SELECT count(*)::int AS count FROM permissions",
  );
  if ((permissionResult.rows[0]?.count || 0) < 17)
    throw new Error("The global permission catalog is incomplete.");
  console.log(
    `Database foundation verified: ${tables.length} tables and ${permissionResult.rows[0].count} permissions.`,
  );
} finally {
  await pool.end();
}
