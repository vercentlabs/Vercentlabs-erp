#!/usr/bin/env node
// F017 Notes and attachments — the demo org has zero Notes and zero CRM
// attachments. Seeds, on one real open Opportunity, a shared pinned note, a
// private note, a note edited twice (body, then private -> shared, so the
// history dialog shows a visibility change), an archived note, and two files
// (one with a replacement version). Uses the governed domain functions
// (createCrmNote/updateCrmNote/archiveCrmNote/createCrmAttachment) and the
// same validation + scan primitives the upload route uses — never raw SQL.
// Local-only, idempotent by distinctive note text / file name.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmNote, updateCrmNote, archiveCrmNote, createCrmAttachment, scanAttachmentForUpload } from "../../services/api/src/index.js";
import { attachmentStorageKey, sha256, validateAttachment } from "../../packages/document-engine/src/index.js";
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
const OPPORTUNITY_NAME = "Suvidha Logistics Pvt Ltd — Custom Reporting Add-on";

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
  if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const owner = (await admin.query(
    `SELECT id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const opportunity = (await admin.query(`SELECT id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2 LIMIT 1`, [organizationId, OPPORTUNITY_NAME])).rows[0];
  if (!opportunity) throw new Error(`Opportunity "${OPPORTUNITY_NAME}" not found.`);
  const context = {
    organizationId, userId: owner.id, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.leads.view_sensitive"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  const noteExists = async (needle) => (await admin.query(
    `SELECT id FROM tenant.crm_notes WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 AND (body LIKE $3 OR id IN (SELECT note_id FROM tenant.crm_note_versions WHERE organization_id=$1 AND body LIKE $3)) LIMIT 1`,
    [organizationId, opportunity.id, `%${needle}%`])).rows[0];

  console.log(`Seeding F017 Notes and attachments demo data on "${OPPORTUNITY_NAME}"...`);

  if (!(await noteExists("Steering committee prefers a phased rollout"))) {
    const n = await withTx((c) => createCrmNote(c, context, "opportunity", opportunity.id, { body: "Steering committee prefers a phased rollout: reporting first, dashboards in phase two.", isPinned: true }));
    console.log(`Created pinned shared note ${n.id}`);
  } else console.log("Already present: pinned shared note");

  if (!(await noteExists("Champion hinted that budget is approved"))) {
    await withTx((c) => createCrmNote(c, context, "opportunity", opportunity.id, { body: "Champion hinted that budget is approved but not yet announced — keep this between us until the RFP goes out.", visibility: "private" }));
    console.log("Created private note");
  } else console.log("Already present: private note");

  if (!(await noteExists("Procurement contact is Meera"))) {
    const n = await withTx((c) => createCrmNote(c, context, "opportunity", opportunity.id, { body: "Procurement contact is Meera. Draft pricing shared.", visibility: "private" }));
    const v2 = await withTx((c) => updateCrmNote(c, context, n.id, { body: "Procurement contact is Meera (procurement@suvidha.example). Revised pricing shared on the 22nd.", expectedVersion: n.version }));
    await withTx((c) => updateCrmNote(c, context, n.id, { visibility: "shared", expectedVersion: v2.version }));
    console.log("Created note edited twice (body, then private -> shared)");
  } else console.log("Already present: edited note");

  if (!(await noteExists("Superseded call summary"))) {
    const n = await withTx((c) => createCrmNote(c, context, "opportunity", opportunity.id, { body: "Superseded call summary — replaced by the pricing thread above." }));
    await withTx((c) => archiveCrmNote(c, context, n.id, { expectedVersion: n.version }));
    console.log("Created + archived note");
  } else console.log("Already present: archived note");

  async function upload(fileName, mimeType, text, replacesLogicalId) {
    const bytes = Buffer.from(text, "utf8");
    const validated = validateAttachment({ fileName, mimeType, sizeBytes: bytes.length });
    const { scanStatus } = await scanAttachmentForUpload(bytes, validated.mimeType, process.env);
    const id = randomUUID();
    return withTx((c) => createCrmAttachment(c, context, "opportunity", opportunity.id, {
      id, fileName: validated.fileName, storageKey: attachmentStorageKey({ organizationId, attachmentId: id, fileName: validated.fileName }),
      mimeType: validated.mimeType, sizeBytes: validated.sizeBytes, content: bytes, contentSha256: sha256(bytes), scanStatus, replacesLogicalId,
    }));
  }
  const fileExists = async (name) => (await admin.query(
    `SELECT logical_id FROM public.attachments WHERE organization_id=$1 AND entity_type='crm.opportunity' AND entity_id=$2 AND file_name=$3 AND is_current LIMIT 1`,
    [organizationId, opportunity.id, name])).rows[0];

  if (!(await fileExists("reporting-requirements.txt"))) {
    const v1 = await upload("reporting-requirements.txt", "text/plain", "Reporting requirements v1\n- Monthly pipeline by region\n- Win/loss by source\n");
    await upload("reporting-requirements.txt", "text/plain", "Reporting requirements v2\n- Monthly pipeline by region\n- Win/loss by source\n- Forecast accuracy by owner\n", v1.logicalId);
    console.log("Uploaded reporting-requirements.txt (2 versions)");
  } else console.log("Already present: reporting-requirements.txt");

  if (!(await fileExists("pricing-summary.csv"))) {
    await upload("pricing-summary.csv", "text/csv", "item,qty,unit_price\nCustom reporting add-on,1,240000\nImplementation,1,90000\n");
    console.log("Uploaded pricing-summary.csv");
  } else console.log("Already present: pricing-summary.csv");

  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
