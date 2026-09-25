#!/usr/bin/env node
// F014 Meetings — the demo org has 194 real planned online Meetings but none in
// any other state (no in-progress, cancelled, held or no-show) and none
// in-person. Seeds one of each through the app's own governed functions
// (createCrmMeeting, startCrmMeeting, cancelCrmMeeting) — never raw SQL.
// Local-only, idempotent by distinctive subject.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmMeeting, startCrmMeeting, cancelCrmMeeting } from "../../services/api/src/index.js";
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
  async function exists(subject) {
    const r = await admin.query(
      `SELECT id FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='meeting' AND subject=$2 LIMIT 1`,
      [organizationId, subject],
    );
    return r.rows.length > 0;
  }

  console.log(`Seeding F014 Meetings demo data for "${ORG_NAME}" (${organizationId})...`);
  const hour = 60 * 60_000;
  const attendees = [
    { email: "priya.nair@example.com", name: "Priya Nair", responseStatus: "accepted" },
    { email: "rohan.mehta@example.com", name: "Rohan Mehta", responseStatus: "needs_action" },
  ];

  const inProgress = "Site visit — Pune warehouse";
  if (!(await exists(inProgress))) {
    const created = await withTx((c) =>
      createCrmMeeting(c, context, {
        entityType: "general", mode: "schedule", subject: inProgress,
        locationType: "in_person", location: "Head Office, Pune",
        startAt: new Date(Date.now() - 10 * 60_000).toISOString(), endAt: new Date(Date.now() + hour).toISOString(), attendees,
      }),
    );
    await withTx((c) => startCrmMeeting(c, context, created.id));
    console.log(`Created + started: ${inProgress}`);
  } else console.log(`Already present: ${inProgress}`);

  const cancelled = "Vendor sync — integration partner";
  if (!(await exists(cancelled))) {
    const created = await withTx((c) =>
      createCrmMeeting(c, context, {
        entityType: "general", mode: "schedule", subject: cancelled,
        locationType: "online", meetingUrl: "https://meet.example.com/vendor-sync",
        startAt: new Date(Date.now() + 26 * hour).toISOString(), endAt: new Date(Date.now() + 27 * hour).toISOString(), attendees,
      }),
    );
    await withTx((c) => cancelCrmMeeting(c, context, created.id));
    console.log(`Created + cancelled: ${cancelled}`);
  } else console.log(`Already present: ${cancelled}`);

  const held = "Product walkthrough — Suvidha operations team";
  if (!(await exists(held))) {
    await withTx((c) =>
      createCrmMeeting(c, context, {
        entityType: "general", mode: "log", subject: held,
        locationType: "online", meetingUrl: "https://meet.example.com/walkthrough",
        occurredAt: new Date(Date.now() - 3 * hour).toISOString(), durationMinutes: 45,
        outcomeCode: "held", outcome: "Walked through the pipeline module; customer asked for a follow-up demo on reporting.", attendees,
      }),
    );
    console.log(`Logged: ${held}`);
  } else console.log(`Already present: ${held}`);

  const noShow = "Renewal discussion — Suvidha finance";
  if (!(await exists(noShow))) {
    await withTx((c) =>
      createCrmMeeting(c, context, {
        entityType: "general", mode: "log", subject: noShow,
        locationType: "phone",
        occurredAt: new Date(Date.now() - 26 * hour).toISOString(), durationMinutes: 0,
        outcomeCode: "no_show", outcome: "Customer did not join; will reschedule.", attendees,
      }),
    );
    console.log(`Logged: ${noShow}`);
  } else console.log(`Already present: ${noShow}`);

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
