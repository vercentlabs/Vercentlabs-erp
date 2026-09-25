#!/usr/bin/env node
// F015 Tasks — the demo org has 325 planned Tasks but none in any other state,
// none on a team queue, none recurring and no dependencies. Seeds one of each
// via the governed functions (createCrmTask, startCrmTask, completeCrmTask,
// cancelCrmTask, addTaskDependency) — never raw SQL. Local-only, idempotent by
// distinctive subject.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmTask, startCrmTask, completeCrmTask, cancelCrmTask, addTaskDependency } from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
  if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const owner = (await admin.query(
    `SELECT id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const team = (await admin.query(`SELECT id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];
  const context = {
    organizationId, userId: owner.id, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.activities.manage"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  const find = async (subject) => (await admin.query(
    `SELECT id FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='task' AND subject=$2 ORDER BY created_at LIMIT 1`, [organizationId, subject])).rows[0];
  const day = 24 * 60 * 60_000;
  const base = { entityType: "general", priority: "medium" };

  console.log(`Seeding F015 Tasks demo data for "${ORG_NAME}" (${organizationId})...`);

  const s1 = "Proposal review — Suvidha multi-site rollout";
  if (!(await find(s1))) {
    const t = await withTx((c) => createCrmTask(c, context, { ...base, subject: s1, priority: "high", dueAt: new Date(Date.now() + day).toISOString() }));
    await withTx((c) => startCrmTask(c, context, t.id));
    console.log(`Created + started: ${s1}`);
  } else console.log(`Already present: ${s1}`);

  const s2 = "Contract checklist — Suvidha renewal";
  if (!(await find(s2))) {
    const t = await withTx((c) => createCrmTask(c, context, { ...base, subject: s2, dueAt: new Date(Date.now() - day).toISOString() }));
    await withTx((c) => completeCrmTask(c, context, t.id, { outcome: "All contract clauses verified against the approved template." }));
    console.log(`Created + completed: ${s2}`);
  } else console.log(`Already present: ${s2}`);

  const s3 = "Follow up on pricing questions — Suvidha";
  if (!(await find(s3))) {
    const t = await withTx((c) => createCrmTask(c, context, { ...base, subject: s3, dueAt: new Date(Date.now() + 2 * day).toISOString() }));
    await withTx((c) => cancelCrmTask(c, context, t.id));
    console.log(`Created + cancelled: ${s3}`);
  } else console.log(`Already present: ${s3}`);

  const s4 = "Qualify inbound enquiry — website form";
  if (team && !(await find(s4))) {
    await withTx((c) => createCrmTask(c, context, { ...base, subject: s4, teamId: team.id, priority: "high", dueAt: new Date(Date.now() + day).toISOString() }));
    console.log(`Created (unclaimed team queue task): ${s4}`);
  } else console.log(`Already present or no team: ${s4}`);

  const s5 = "Weekly pipeline hygiene";
  if (!(await find(s5))) {
    await withTx((c) => createCrmTask(c, context, { ...base, subject: s5, dueAt: new Date(Date.now() + 3 * day).toISOString(), recurrenceConfig: { freq: "weekly", interval: 1, count: 6 } }));
    console.log(`Created (recurring): ${s5}`);
  } else console.log(`Already present: ${s5}`);

  const s6 = "Send revised quotation — Suvidha";
  const s7 = "Book onboarding workshop (after quotation approval)";
  if (!(await find(s6)) && !(await find(s7))) {
    const first = await withTx((c) => createCrmTask(c, context, { ...base, subject: s6, dueAt: new Date(Date.now() + day).toISOString() }));
    const second = await withTx((c) => createCrmTask(c, context, { ...base, subject: s7, dueAt: new Date(Date.now() + 2 * day).toISOString() }));
    await withTx((c) => addTaskDependency(c, context, second.id, first.id));
    console.log(`Created dependency pair: ${s7} depends on ${s6}`);
  } else console.log("Dependency pair already present.");

  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
