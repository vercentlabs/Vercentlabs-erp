import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const required = [
  "crm_settings",
  "crm_pipelines",
  "crm_pipeline_stages",
  "crm_lead_sources",
  "crm_lost_reasons",
  "crm_tags",
  "crm_campaigns",
  "crm_leads",
  "crm_lead_tags",
  "crm_scoring_rules",
  "crm_lead_score_history",
  "crm_assignment_rules",
  "crm_round_robin_state",
  "crm_opportunities",
  "crm_opportunity_stage_history",
  "crm_opportunity_items",
  "crm_competitors",
  "crm_opportunity_competitors",
  "crm_activities",
  "crm_activity_attendees",
  "crm_notes",
  "crm_communications",
  "crm_sequences",
  "crm_sequence_steps",
  "crm_sequence_enrollments",
  "crm_capture_forms",
  "crm_capture_rate_limits",
  "crm_campaign_members",
  "crm_saved_views",
  "crm_automation_rules",
  "crm_automation_runs",
  "crm_conversion_records",
  "crm_merge_records",
  "crm_forecast_targets",
  "crm_integrations",
  "crm_webhook_subscriptions",
  "crm_outbox_events",
  "crm_sales_teams",
  "crm_sales_team_members",
  "crm_territories",
  "crm_territory_assignments",
  "crm_quota_plans",
  "crm_forecast_periods",
  "crm_forecast_submissions",
  "crm_forecast_snapshots",
  "crm_account_plans",
  "crm_account_stakeholders",
  "crm_playbooks",
  "crm_playbook_questions",
  "crm_playbook_responses",
  "crm_consent_events",
  "crm_privacy_requests",
  "crm_data_quality_scores",
];
try {
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='tenant' AND table_name = ANY($1::text[])",
    [required],
  );
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missing = required.filter((name) => !found.has(name));
  if (missing.length)
    throw new Error(`Missing CRM tables: ${missing.join(", ")}`);
  const policies = await pool.query(
    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tenant' AND c.relname = ANY($1::text[])",
    [required],
  );
  const insecure = policies.rows
    .filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)
    .map((row) => row.relname);
  if (insecure.length)
    throw new Error(`CRM tables without forced RLS: ${insecure.join(", ")}`);
  const permissions = await pool.query(
    "SELECT count(*)::int AS count FROM permissions WHERE key LIKE 'crm.%'",
  );
  if (Number(permissions.rows[0]?.count || 0) < 19)
    throw new Error("CRM permission catalog is incomplete.");
  const seeds = await pool.query(
    "SELECT (SELECT count(*) FROM tenant.crm_pipeline_stages) AS stages,(SELECT count(*) FROM tenant.crm_lead_sources) AS sources,(SELECT count(*) FROM tenant.crm_lost_reasons) AS reasons",
  );
  if (
    Number(seeds.rows[0].stages) < 7 ||
    Number(seeds.rows[0].sources) < 8 ||
    Number(seeds.rows[0].reasons) < 8
  )
    throw new Error("Default CRM configuration is incomplete.");
  console.log(
    `CRM database verified: ${required.length} tables, ${policies.rows.length} forced-RLS contracts and ${permissions.rows[0].count} permissions.`,
  );
} finally {
  await pool.end();
}
