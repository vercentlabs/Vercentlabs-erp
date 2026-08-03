import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { runPrivacyRetention } from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const organizations = await pool.query(
    `SELECT organization.id,organization.created_by
     FROM public.organizations organization
     WHERE organization.status='active' AND organization.created_by IS NOT NULL
     ORDER BY organization.created_at`,
  );
  let processed = 0;
  for (const organization of organizations.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_organization_id',$1,true)",
        [organization.id],
      );
      const result = await runPrivacyRetention(client, {
        organizationId: organization.id,
        userId: organization.created_by,
        activeCompanyId: null,
        activeBranchId: null,
        allowAllCompanies: true,
      });
      processed += Number(result.processed || 0);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(
    `CRM privacy retention completed for ${organizations.rows.length} organisation(s); ${processed} subject(s) processed.`,
  );
} finally {
  await pool.end();
}
