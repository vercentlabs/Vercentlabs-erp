#!/usr/bin/env node
// CRM performance measurement at production-shaped volume, against a real
// PostgreSQL on the restricted runtime role (the same boundary as the app).
//
//   node scripts/crm/measure-performance.mjs [--leads 10000] [--iterations 30]
//
// Seeds a disposable organisation (removed afterwards): 10k leads, 10k
// accounts + 10k contacts, 3k opportunities across 40 sellers in a 3-level
// team hierarchy with territories and FX, 30k activities, closed forecast
// periods. Then measures real domain calls (p50/p95/p99, statement count,
// payload bytes) and a lead-import chunk, and writes a report to
// docs/03-modules/crm/performance/. Numbers are what this machine measured;
// they are evidence for this environment, not a production SLA.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import { setTenantContext } from "../../packages/database/src/index.js";
import { getCrmDashboard } from "../../services/api/src/modules/crm/analytics/analytics-service.js";
import { getCrmReport } from "../../services/api/src/modules/crm/analytics/analytics-service.js";
import { captureForecastPeriodSnapshot, getForecastAccuracy, getForecastWorkspace } from "../../services/api/src/modules/crm/analytics/forecast-service.js";
import { getMetricDrilldown, getMetricRollup, getPipelineDashboard } from "../../services/api/src/modules/crm/analytics/pipeline-metrics.js";
import { listCrmRecords } from "../../services/api/src/modules/crm/data-management/resource-query-service.js";
import { listCrmContacts } from "../../services/api/src/modules/crm/master-data/contact-operations.js";
import { getSalesCoverage, listUnassignedRecords } from "../../services/api/src/modules/crm/sales-organization/coverage-service.js";
import { previewLeadImport, processLeadImportChunk } from "../../services/api/src/modules/crm/data-management/import-export/lead-import.js";
import { ensureDefaultLeadStages } from "../../services/api/src/modules/crm/lead-management/lifecycle/stage-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? Number(process.argv[index + 1]) : fallback;
};
const LEADS = argument("leads", 10_000);
const ACCOUNTS = argument("accounts", 10_000);
const OPPORTUNITIES = argument("opportunities", 3_000);
const ACTIVITIES = argument("activities", 30_000);
const SELLERS = 40;
const ITERATIONS = argument("iterations", 30);
// --only <text>: measure just the operations whose label contains <text>
// (case-insensitive) and print them; the report files are left untouched.
const onlyIndex = process.argv.indexOf("--only");
const ONLY = onlyIndex > -1 ? String(process.argv[onlyIndex + 1] ?? "").toLowerCase() : null;

const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, application_name: "crm-perf-owner" });
const runtime = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: "crm-perf-runtime" });

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, rank)] * 10) / 10;
}

async function measure(label, work, { iterations = ITERATIONS } = {}) {
  if (ONLY && !label.toLowerCase().includes(ONLY)) return null;
  const timings = [];
  let statements = 0;
  let bytes = 0;
  for (let index = 0; index < iterations; index += 1) {
    let count = 0;
    const counting = { query: (...args) => { count += 1; return runtime.query(...args); } };
    await runtime.query("BEGIN");
    await setTenantContext(runtime, organizationId);
    const started = performance.now();
    const result = await work(counting, index);
    timings.push(performance.now() - started);
    await runtime.query("ROLLBACK");
    statements = count;
    bytes = Buffer.byteLength(JSON.stringify(result ?? null));
  }
  timings.sort((a, b) => a - b);
  const row = { label, iterations, p50: percentile(timings, 50), p95: percentile(timings, 95), p99: percentile(timings, 99), statements, payloadBytes: bytes };
  console.log(`${label.padEnd(58)} p50 ${String(row.p50).padStart(7)} ms  p95 ${String(row.p95).padStart(7)} ms  p99 ${String(row.p99).padStart(7)} ms  ${statements} stmts  ${bytes} B`);
  return row;
}

let organizationId;
const users = [];
async function seed() {
  organizationId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  for (let index = 0; index < SELLERS + 2; index += 1) {
    const id = randomUUID();
    users.push(id);
    await owner.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'x','active',now())`, [id, `perf-${index}-${id}@test.invalid`, `Perf User ${index}`]);
  }
  await owner.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'CRM Perf',$2,'IN','Asia/Kolkata','INR',$3)`, [organizationId, `crm-perf-${organizationId}`, users[0]]);
  await owner.query(`INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES($1,$2,'Perf Co','Perf Co','PERF','INR','IN',true,'active')`, [companyId, organizationId]);
  await owner.query(`INSERT INTO branches(id,organization_id,company_id,name,code,timezone,status) VALUES($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, organizationId, companyId]);
  for (const id of users) {
    await owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [organizationId, id]);
    await owner.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES($1,$2,$3)`, [organizationId, id, companyId]);
    await owner.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES($1,$2,$3)`, [organizationId, id, branchId]);
  }
  const role = randomUUID();
  await owner.query(`INSERT INTO roles(id,organization_id,name,slug,status) VALUES($1,$2,'Perf seller','perf-seller','active')`, [role, organizationId]);
  for (const permission of ["crm.view", "crm.leads.manage", "crm.import"]) await owner.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES($1,$2)`, [role, permission]);
  for (const id of users) await owner.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,status) VALUES($1,$2,$3,'active')`, [organizationId, id, role]);

  await owner.query("BEGIN");
  await setTenantContext(owner, organizationId);
  await ensureDefaultLeadStages(owner, { organizationId, userId: users[0] });
  const pipeline = randomUUID();
  await owner.query(`INSERT INTO tenant.crm_pipelines(id,organization_id,company_id,name,code,is_default,status) VALUES($1,$2,$3,'Sales','PERF',true,'active')`, [pipeline, organizationId, companyId]);
  const stages = [];
  for (const [index, name] of ["Qualify", "Discover", "Propose", "Negotiate", "Commit"].entries()) {
    const id = randomUUID();
    stages.push(id);
    await owner.query(`INSERT INTO tenant.crm_pipeline_stages(id,organization_id,pipeline_id,name,code,sequence,probability,stale_after_days,status) VALUES($1,$2,$3,$4,$5,$6,$7,30,'active')`, [id, organizationId, pipeline, name, `S${index}`, index + 1, (index + 1) * 15]);
  }
  // Team hierarchy: region -> 4 areas -> 8 teams of 5 sellers.
  const region = randomUUID();
  await owner.query(`INSERT INTO tenant.crm_sales_teams(id,organization_id,company_id,code,name,manager_user_id,status) VALUES($1,$2,$3,'REG','Region',$4,'active')`, [region, organizationId, companyId, users[SELLERS]]);
  const teams = [];
  for (let area = 0; area < 4; area += 1) {
    const areaId = randomUUID();
    await owner.query(`INSERT INTO tenant.crm_sales_teams(id,organization_id,company_id,parent_team_id,code,name,status) VALUES($1,$2,$3,$4,$5,$6,'active')`, [areaId, organizationId, companyId, region, `A${area}`, `Area ${area}`]);
    for (let sub = 0; sub < 2; sub += 1) {
      const teamId = randomUUID();
      teams.push(teamId);
      await owner.query(`INSERT INTO tenant.crm_sales_teams(id,organization_id,company_id,parent_team_id,code,name,manager_user_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active')`, [teamId, organizationId, companyId, areaId, `T${area}${sub}`, `Team ${area}.${sub}`, users[(area * 2 + sub) * 5]]);
    }
  }
  for (let seller = 0; seller < SELLERS; seller += 1)
    await owner.query(`INSERT INTO tenant.crm_sales_team_members(organization_id,company_id,team_id,user_id,member_role,effective_from,status) VALUES($1,$2,$3,$4,'seller','2000-01-01','active')`, [organizationId, companyId, teams[Math.floor(seller / 5)], users[seller]]);
  await owner.query(`INSERT INTO tenant.exchange_rates(organization_id,from_currency_code,to_currency_code,rate_date,rate,status) VALUES($1,'USD','INR','2000-01-01',83,'active')`, [organizationId]);
  const sellers = users.slice(0, SELLERS);
  await owner.query(
    `INSERT INTO tenant.crm_leads(organization_id,company_id,branch_id,code,first_name,last_name,email,company_name,city,owner_user_id,record_status)
     SELECT $1,$2,$3,'PL-'||n,'Lead'||n,'Perf','lead'||n||'@perf.test','Company '||(n%500),'City '||(n%50),
            CASE WHEN n%20=0 THEN NULL ELSE ($4::uuid[])[1+(n%${SELLERS})] END,'active'
       FROM generate_series(1,$5) n`,
    [organizationId, companyId, branchId, sellers, LEADS],
  );
  await owner.query(
    `INSERT INTO tenant.business_parties(organization_id,company_id,code,party_type,display_name,status,owner_user_id)
     SELECT $1,$2,'PA-'||n,'customer','Account '||n,'active',CASE WHEN n%25=0 THEN NULL ELSE ($3::uuid[])[1+(n%${SELLERS})] END FROM generate_series(1,$4) n`,
    [organizationId, companyId, sellers, ACCOUNTS],
  );
  await owner.query(
    `INSERT INTO tenant.contacts(organization_id,party_id,first_name,last_name,email,status)
     SELECT $1, party.id, 'Contact', party.code, lower(party.code)||'@contact.test', 'active' FROM tenant.business_parties party WHERE party.organization_id=$1`,
    [organizationId],
  );
  await owner.query(
    `INSERT INTO tenant.crm_opportunities(organization_id,company_id,branch_id,code,pipeline_id,stage_id,owner_user_id,party_id,name,amount,currency_code,probability,expected_close_date,actual_close_date,status,forecast_category,stage_entered_at)
     SELECT $1,$2,$3,'PO-'||n,$4,($5::uuid[])[1+(n%5)],CASE WHEN n%30=0 THEN NULL ELSE ($6::uuid[])[1+(n%${SELLERS})] END,
            parties.ids[1+(n%cardinality(parties.ids))],
            'Deal '||n,(1000+(n*37)%90000)::numeric, CASE WHEN n%10=0 THEN 'USD' ELSE 'INR' END,(15*(1+n%5))::numeric,
            current_date + ((n%180)-60), CASE WHEN n%7=0 THEN current_date - (n%90) END,
            CASE WHEN n%7=0 THEN CASE WHEN n%14=0 THEN 'lost' ELSE 'won' END ELSE 'open' END,
            CASE WHEN n%7=0 THEN 'closed' ELSE (ARRAY['pipeline','best_case','committed','omitted'])[1+(n%4)] END,
            now() - ((n%60) || ' days')::interval
       FROM generate_series(1,$7) n, (SELECT array_agg(id ORDER BY code) AS ids FROM tenant.business_parties WHERE organization_id=$1) parties`,
    [organizationId, companyId, branchId, pipeline, stages, sellers, OPPORTUNITIES],
  );
  await owner.query(
    `INSERT INTO tenant.crm_activities(organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,status,assigned_to,due_at,created_by)
     SELECT $1,$2,$3,'lead',leads.ids[1+(n%cardinality(leads.ids))],'task','Follow up '||n,CASE WHEN n%3=0 THEN 'completed' ELSE 'planned' END,
            leads.owners[1+(n%cardinality(leads.ids))],now()+((n%30-15)||' days')::interval,leads.owners[1+(n%cardinality(leads.ids))]
       FROM generate_series(1,$4) n, (SELECT array_agg(id ORDER BY code) AS ids, array_agg(owner_user_id ORDER BY code) AS owners FROM tenant.crm_leads WHERE organization_id=$1) leads`,
    [organizationId, companyId, branchId, ACTIVITIES],
  );
  const period = randomUUID();
  const start = new Date(); start.setUTCDate(1);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
  await owner.query(`INSERT INTO tenant.crm_forecast_periods(id,organization_id,company_id,name,period_type,period_start,period_end,status) VALUES($1,$2,$3,'Perf quarter','quarter',$4,$5,'open')`, [period, organizationId, companyId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]);
  await owner.query("COMMIT");
  // Production tables have planner statistics; freshly bulk-loaded ones do not.
  for (const table of ["crm_leads", "business_parties", "contacts", "crm_opportunities", "crm_activities", "crm_sales_team_members", "crm_territory_assignments"]) await owner.query(`ANALYZE tenant.${table}`);
  return { companyId, branchId, period, teams, region };
}

async function cleanup() {
  if (!organizationId) return;
  await owner.query("SET session_replication_role = replica").catch(() => undefined);
  for (const table of ["audit_events", "notifications"]) await owner.query(`DELETE FROM ${table} WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
  const tenantTables = (await owner.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
  for (const row of tenantTables) await owner.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
  await owner.query("SET session_replication_role = DEFAULT").catch(() => undefined);
  await owner.query(`DELETE FROM organizations WHERE id=$1`, [organizationId]).catch(() => undefined);
  await owner.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => undefined);
}

await owner.connect();
await runtime.connect();
const cleanupIndex = process.argv.indexOf("--cleanup-org");
if (cleanupIndex > -1) {
  organizationId = process.argv[cleanupIndex + 1];
  users.push(...(await owner.query(`SELECT user_id FROM organization_memberships WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.user_id));
  await cleanup();
  console.log(`Removed organisation ${organizationId}`);
  await runtime.end();
  await owner.end();
  process.exit(0);
}
const results = [];
let seeded;
try {
  const seedStarted = performance.now();
  seeded = await seed();
  console.log(`Seeded ${LEADS} leads, ${ACCOUNTS} accounts/contacts, ${OPPORTUNITIES} opportunities, ${ACTIVITIES} activities in ${Math.round(performance.now() - seedStarted)} ms`);
  const base = { organizationId, activeCompanyId: seeded.companyId, activeBranchId: seeded.branchId, allowAllCompanies: false, roleSlugs: [] };
  const admin = { ...base, userId: users[SELLERS + 1], permissions: ["crm.view", "crm.records.view_all", "crm.reports.view", "crm.revenue.manage", "crm.forecast.manage", "crm.coverage.view", "crm.leads.manage", "crm.import"] };
  const manager = { ...base, userId: users[0], permissions: ["crm.view", "crm.reports.view", "crm.forecast.review", "crm.forecast.submit", "crm.coverage.view"] };
  const seller = { ...base, userId: users[1], permissions: ["crm.view", "crm.reports.view", "crm.leads.manage"] };
  const quarter = { from: new Date().toISOString().slice(0, 8) + "01", to: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) };

  results.push(await measure("Database round trip (SELECT 1), for scale", (client) => client.query("SELECT 1").then(() => null)));
  results.push(await measure("Leads list, first page of 50 (seller)", (client) => listCrmRecords(client, seller, "leads", { limit: 50 })));
  results.push(await measure("Leads list, search 'Lead12' (admin)", (client) => listCrmRecords(client, admin, "leads", { limit: 50, search: "Lead12" })));
  results.push(await measure("Contacts list, first page of 50 (admin)", (client) => listCrmContacts(client, admin, { limit: 50 })));
  results.push(await measure("CRM home dashboard (admin)", (client) => getCrmDashboard(client, admin, {})));
  results.push(await measure("CRM home dashboard (seller)", (client) => getCrmDashboard(client, seller, {})));
  results.push(await measure("Pipeline dashboard: KPIs + stages + quota (admin)", (client) => getPipelineDashboard(client, admin, quarter)));
  results.push(await measure("Pipeline dashboard, team subtree filter (admin)", (client) => getPipelineDashboard(client, admin, { ...quarter, teamId: seeded.region })));
  results.push(await measure("Pipeline dashboard (manager, team visibility)", (client) => getPipelineDashboard(client, manager, quarter)));
  results.push(await measure("KPI drill-down, first page of 50 (admin)", (client) => getMetricDrilldown(client, admin, { metric: "open_pipeline", filters: quarter, limit: 50 })));
  results.push(await measure("Report: pipeline by owner (canonical rollup)", (client) => getMetricRollup(client, admin, { dimension: "owner", metrics: ["open_pipeline", "commit", "best_case", "won_amount", "win_rate"], filters: quarter })));
  results.push(await measure("Report: forecast by owner (catalogue)", (client) => getCrmReport(client, admin, "forecast", quarter)));
  results.push(await measure("Forecast workspace with hierarchy rollup", (client) => getForecastWorkspace(client, admin, { periodId: seeded.period })));
  results.push(await measure("Forecast snapshot capture (org+teams+owners+deals)", (client, index) => captureForecastPeriodSnapshot(client, admin, { periodId: seeded.period, captureKey: `perf-${index}` }), { iterations: 10 }));
  results.push(await measure("Forecast accuracy (closed periods)", (client) => getForecastAccuracy(client, admin, {})));
  results.push(await measure("Sales coverage overview", (client) => getSalesCoverage(client, admin)));
  results.push(await measure("Unassigned leads queue, first page", (client) => listUnassignedRecords(client, admin, { type: "leads", limit: 50 })));

  // Lead import: dry run of 5,000 rows, then one worker chunk.
  const rows = Array.from({ length: 5000 }, (_, index) => ({ First: `Imp${index}`, Email: `imp${index}-${randomUUID().slice(0, 6)}@import.test` }));
  results.push(await measure("Lead import dry run, 5,000 rows (stage + duplicates)", (client) => previewLeadImport(client, admin, { rows, fieldMapping: { firstName: "First", email: "Email" }, fileName: `perf-${randomUUID()}.csv`, duplicateStrategy: "skip" }), { iterations: 5 }));
  results.push(
    await measure(
      "Lead import worker chunk, 200 rows",
      async (client) => {
        const preview = await previewLeadImport(client, admin, { rows: rows.slice(0, 200).map((row) => ({ ...row, Email: `c-${randomUUID()}@import.test` })), fieldMapping: { firstName: "First", email: "Email" }, fileName: `chunk-${randomUUID()}.csv`, duplicateStrategy: "skip" });
        return processLeadImportChunk(client, admin, preview.batch.id, { limit: 200 });
      },
      { iterations: 3 },
    ),
  );
} finally {
  if (process.argv.includes("--keep")) console.log(`Kept organisation ${organizationId} for analysis (remove it by re-running without --keep is not automatic).`);
  else await cleanup();
  await runtime.end();
  await owner.end();
}

if (ONLY) process.exit(0);
const date = new Date().toISOString().slice(0, 10);
const outputDirectory = path.join(root, "docs/03-modules/crm/performance");
fs.mkdirSync(outputDirectory, { recursive: true });
const lines = [
  `# CRM performance measurement — ${date}`,
  "",
  "Measured by `node scripts/crm/measure-performance.mjs` against a real PostgreSQL",
  "on the restricted runtime role, in a disposable organisation removed afterwards.",
  "Each call runs inside a tenant transaction that is rolled back. Timings are",
  "wall-clock in the calling process, including database round trips, on the",
  "development machine (Windows host, PostgreSQL 16 in Docker). They are evidence",
  "for this environment, not a production SLA.",
  "",
  `Dataset: ${LEADS.toLocaleString("en-IN")} leads, ${ACCOUNTS.toLocaleString("en-IN")} accounts, ${ACCOUNTS.toLocaleString("en-IN")} contacts, ${OPPORTUNITIES.toLocaleString("en-IN")} opportunities (10% USD), ${ACTIVITIES.toLocaleString("en-IN")} activities, ${SELLERS} sellers in a 3-level team hierarchy.`,
  "",
  "| Operation | Iterations | p50 ms | p95 ms | p99 ms | Statements | Payload bytes |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...results.map((row) => `| ${row.label} | ${row.iterations} | ${row.p50} | ${row.p95} | ${row.p99} | ${row.statements} | ${row.payloadBytes} |`),
  "",
];
fs.writeFileSync(path.join(outputDirectory, `CRM_PERFORMANCE_${date}.md`), `${lines.join("\n")}\n`);
fs.writeFileSync(path.join(outputDirectory, `CRM_PERFORMANCE_${date}.json`), `${JSON.stringify({ date, dataset: { leads: LEADS, accounts: ACCOUNTS, opportunities: OPPORTUNITIES, activities: ACTIVITIES, sellers: SELLERS }, results }, null, 2)}\n`);
console.log(`Wrote docs/03-modules/crm/performance/CRM_PERFORMANCE_${date}.md`);
