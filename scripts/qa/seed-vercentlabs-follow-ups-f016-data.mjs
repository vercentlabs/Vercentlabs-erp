#!/usr/bin/env node
// F016 Follow-ups — the demo org has 270 planned Follow-ups but none snoozed,
// completed, cancelled or escalated, and every reminder is pending/cancelled
// (none sent, failed or acknowledged). Seeds one of each through the governed
// functions (createCrmFollowUp, snoozeCrmFollowUp, completeCrmFollowUp,
// cancelCrmFollowUp, escalateOverdueFollowUps, markReminderOutcome,
// acknowledgeReminder) — never raw SQL. Reminder outcomes are applied only to
// the seeded follow-ups' own reminders, never to the org-wide due queue.
// Local-only, idempotent by distinctive subject.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  createCrmFollowUp, snoozeCrmFollowUp, completeCrmFollowUp, cancelCrmFollowUp,
  escalateOverdueFollowUps, markReminderOutcome, acknowledgeReminder, listRemindersForActivity,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
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
  const context = {
    organizationId, userId: owner.id, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.activities.manage"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  const exists = async (subject) => (await admin.query(
    `SELECT 1 FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='follow_up' AND subject=$2 LIMIT 1`, [organizationId, subject])).rows.length > 0;
  const hour = 60 * 60_000;
  const base = { entityType: "general", followUpChannel: "call" };

  console.log(`Seeding F016 Follow-ups demo data for "${ORG_NAME}" (${organizationId})...`);

  const snoozed = "Revisit pricing — Suvidha procurement";
  if (!(await exists(snoozed))) {
    const f = await withTx((c) => createCrmFollowUp(c, context, { ...base, subject: snoozed, followUpReason: "Customer asked to revisit pricing next week", dueAt: new Date(Date.now() + 2 * hour).toISOString() }));
    await withTx((c) => snoozeCrmFollowUp(c, context, f.id, { dueAt: new Date(Date.now() + 48 * hour).toISOString() }));
    console.log(`Created + snoozed: ${snoozed}`);
  } else console.log(`Already present: ${snoozed}`);

  const completed = "Onboarding check-in — Suvidha";
  if (!(await exists(completed))) {
    const f = await withTx((c) => createCrmFollowUp(c, context, { ...base, subject: completed, followUpChannel: "email", dueAt: new Date(Date.now() + hour).toISOString() }));
    await withTx((c) => completeCrmFollowUp(c, context, f.id));
    console.log(`Created + completed: ${completed}`);
  } else console.log(`Already present: ${completed}`);

  const cancelled = "Reminder: renewal paperwork";
  if (!(await exists(cancelled))) {
    const f = await withTx((c) => createCrmFollowUp(c, context, { ...base, subject: cancelled, followUpChannel: "sms", dueAt: new Date(Date.now() + 5 * hour).toISOString() }));
    await withTx((c) => cancelCrmFollowUp(c, context, f.id));
    console.log(`Created + cancelled: ${cancelled}`);
  } else console.log(`Already present: ${cancelled}`);

  const escalated = "Contract renewal at risk — Suvidha";
  if (!(await exists(escalated))) {
    await withTx((c) => createCrmFollowUp(c, context, { ...base, subject: escalated, followUpReason: "Contract renewal is at risk", dueAt: new Date(Date.now() - 3 * hour).toISOString(), escalateAfterMinutes: 60 }));
    // Escalates only follow-ups with escalation configured and overdue past their window.
    const n = await withTx((c) => escalateOverdueFollowUps(c, context));
    console.log(`Created overdue follow-up with escalation; escalation pass touched ${n}: ${escalated}`);
  } else console.log(`Already present: ${escalated}`);

  const delivery = "Confirm go-live date — Suvidha";
  if (!(await exists(delivery))) {
    const f = await withTx((c) => createCrmFollowUp(c, context, { ...base, subject: delivery, followUpChannel: "email", dueAt: new Date(Date.now() + 26 * hour).toISOString() }));
    const reminders = await withTx((c) => listRemindersForActivity(c, context, f.id));
    const [first, second, third] = reminders;
    if (first) { await withTx((c) => markReminderOutcome(c, context, first.id, { status: "sent" })); await withTx((c) => acknowledgeReminder(c, context, f.id, first.id)); }
    if (second) await withTx((c) => markReminderOutcome(c, context, second.id, { status: "sent" }));
    if (third) await withTx((c) => markReminderOutcome(c, context, third.id, { status: "failed", failureReason: "SEND_FAILED" }));
    console.log(`Created with ${reminders.length} reminders (acknowledged / sent / failed): ${delivery}`);
  } else console.log(`Already present: ${delivery}`);

  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
