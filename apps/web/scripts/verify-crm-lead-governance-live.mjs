import assert from "node:assert/strict";
import pg from "pg";
import "dotenv/config";
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(url, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: url });
try {
  for (const t of [
    "crm_lead_record_types",
    "crm_lead_field_definitions",
    "crm_lead_layouts",
    "crm_lead_assignment_policies",
    "crm_lead_assignment_state",
  ]) {
    const r = await pool.query(`select to_regclass($1) name`, [`tenant.${t}`]);
    assert.ok(r.rows[0].name, `${t} missing`);
  }
  const counts = await pool.query(
    `select (select count(*) from tenant.crm_lead_record_types) record_types,(select count(*) from tenant.crm_lead_field_definitions) fields,(select count(*) from tenant.crm_lead_layouts) layouts`,
  );
  assert.ok(Number(counts.rows[0].record_types) > 0);
  assert.ok(Number(counts.rows[0].fields) >= 11);
  assert.ok(Number(counts.rows[0].layouts) > 0);
  console.log("Stage 2B live lead governance verified.");
} finally {
  await pool.end();
}
