#!/usr/bin/env node
// F013 Calls — the demo org already has 237 real planned Calls plus 5 real
// completed ones (with genuine no_answer/voicemail outcomes and notes, from
// this session's own live verification), but zero calls in the "in_progress"
// or "cancelled" states, so CallDetailScreen/CallListScreen never had
// anything to show for either. Uses the app's own governed functions
// (createCrmCall, startCrmCall, cancelCrmCall) — never raw SQL for
// operational records. Local-only, idempotent by a distinctive subject,
// same convention as the other scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmCall, startCrmCall, cancelCrmCall } from "../../services/api/src/index.js";
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
  const org = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0];
  if (!org) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const organizationId = org.id;
  const owner = (await admin.query(
    `SELECT id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const context = {
    organizationId,
    userId: owner.id,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.activities.manage"],
    roleSlugs: ["organization_owner"],
  };

  async function withTx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, organizationId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }

  async function findBySubject(subject) {
    const result = await admin.query(
      `SELECT id, status FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='call' AND subject=$2 LIMIT 1`,
      [organizationId, subject],
    );
    return result.rows[0] || null;
  }

  console.log(`Seeding F013 Calls demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. An in-progress call — CallDetailScreen/CallListScreen had no
  // example of a live, mid-call state (Start hidden, Complete/Cancel shown).
  const inProgressSubject = "Quarterly review call — Suvidha Logistics";
  let inProgress = await findBySubject(inProgressSubject);
  if (!inProgress) {
    const created = await withTx((client) =>
      createCrmCall(client, context, {
        entityType: "general",
        mode: "schedule",
        subject: inProgressSubject,
        direction: "outbound",
        phoneNumber: "+91 9000000001",
        dueAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    );
    await withTx((client) => startCrmCall(client, context, created.id));
    console.log(`Created + started: ${inProgressSubject}`);
    inProgress = { id: created.id, status: "in_progress" };
  } else {
    console.log(`Already present (status=${inProgress.status}): ${inProgressSubject}`);
  }

  // --- 2. A cancelled call — neither screen had an example of the
  // cancelled terminal state (distinct from completed).
  const cancelledSubject = "Pricing call — Suvidha procurement";
  let cancelled = await findBySubject(cancelledSubject);
  if (!cancelled) {
    const created = await withTx((client) =>
      createCrmCall(client, context, {
        entityType: "general",
        mode: "schedule",
        subject: cancelledSubject,
        direction: "inbound",
        phoneNumber: "+91 9000000002",
        dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
    );
    await withTx((client) => cancelCrmCall(client, context, created.id));
    console.log(`Created + cancelled: ${cancelledSubject}`);
    cancelled = { id: created.id, status: "cancelled" };
  } else {
    console.log(`Already present (status=${cancelled.status}): ${cancelledSubject}`);
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
