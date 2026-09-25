#!/usr/bin/env node
// Screenshot review (2026-09-25) found screens that were empty only because
// the demo org had no data for them. Fills each gap through governed paths:
//  - privacy retention policies (the org predates the default-policy
//    migration; the same three defaults are added, one activated via
//    updatePrivacyRetentionPolicy),
//  - account and contact custom fields with values (createCustomFieldDefinition
//    / setCustomFieldValues),
//  - a buying committee with members on a live deal (Relationship coverage),
//  - a won deal that came from a converted lead (Lead sources "won revenue"),
//  - a closed forecast period with a captured prediction (forecast accuracy),
//  - a lead stage override with a realistic reason (lead pipeline history).
// Local-only, idempotent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  capturePredictiveForecast, createCrmRecord, decideLeadQualification, createCustomFieldDefinition, moveOpportunityStage,
  setCustomFieldValues, transitionLeadStage, updateCrmRecord, updatePrivacyRetentionPolicy,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const OVERRIDE_NOTE = "Customer confirmed budget on a call; moving straight to discovery.";

async function main() {
  const db = new Client({ connectionString });
  await db.connect();
  const organizationId = (await db.query(`SELECT id FROM organizations WHERE name='Vercentlabs' LIMIT 1`)).rows[0].id;
  const owner = (await db.query(`SELECT id FROM users WHERE email='atharva.chavan@vercentlabs.com'`)).rows[0].id;
  const context = {
    organizationId, userId: owner, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.settings.manage", "crm.opportunities.manage", "crm.accounts.manage", "crm.leads.manage", "crm.leads.view_sensitive", "crm.privacy.manage", "crm.forecast.manage", "crm.leads.stage_override"],
    roleSlugs: ["organization_owner"],
  };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  async function tx(fn) {
    await db.query("BEGIN");
    try { await setTenantContext(db, organizationId); const r = await fn(db); await db.query("COMMIT"); return r; }
    catch (e) { await db.query("ROLLBACK"); throw e; }
  }
  console.log("Seeding screenshot-gap demo data...");

  // 1. Retention policies (same defaults migration 029 gives every org).
  for (const [subjectType, name, days, action] of [["lead", "Inactive lead retention", 730, "anonymize"], ["contact", "Inactive contact retention", 2555, "anonymize"], ["party", "Inactive account retention", 2555, "restrict"]]) {
    await db.query(
      `INSERT INTO tenant.crm_privacy_retention_policies(organization_id,subject_type,name,retention_days,action,status,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,'inactive',$6,$6) ON CONFLICT (organization_id,subject_type,name) DO NOTHING`,
      [organizationId, subjectType, name, days, action, owner],
    );
  }
  const leadPolicy = await one(`SELECT id,status FROM tenant.crm_privacy_retention_policies WHERE organization_id=$1 AND subject_type='lead'`, [organizationId]);
  if (leadPolicy.status !== "active") {
    await tx((c) => updatePrivacyRetentionPolicy(c, context, leadPolicy.id, { status: "active", retentionDays: 730, action: "anonymize" }));
    console.log("Retention: lead policy activated");
  } else console.log("Already present: retention policies");

  // 2. Account and contact custom fields.
  const account = await one(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name='Suvidha Logistics Pvt Ltd'`, [organizationId]);
  const contact = await one(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND first_name='Rohan' AND last_name='Gupta' LIMIT 1`, [organizationId]);
  for (const def of [
    { entityType: "party", fieldKey: "annual_it_budget", label: "Annual IT budget (INR)", dataType: "currency" },
    { entityType: "party", fieldKey: "customer_tier", label: "Customer tier", dataType: "select", options: ["Strategic", "Growth", "Standard"] },
    { entityType: "contact", fieldKey: "preferred_channel", label: "Preferred channel", dataType: "select", options: ["Email", "Phone", "WhatsApp"] },
    { entityType: "contact", fieldKey: "decision_influence", label: "Influence on decision (%)", dataType: "percentage" },
  ]) {
    const exists = await one(`SELECT 1 FROM custom_field_definitions WHERE organization_id=$1 AND entity_type=$2 AND field_key=$3`, [organizationId, def.entityType, def.fieldKey]);
    if (!exists) { await tx((c) => createCustomFieldDefinition(c, context, def)); console.log(`Custom field: ${def.label}`); }
  }
  const accountValues = await one(`SELECT count(*)::int n FROM custom_field_values WHERE organization_id=$1 AND entity_id=$2`, [organizationId, account.id]);
  if (!accountValues.n) {
    await tx((c) => setCustomFieldValues(c, context, "party", account.id, { annual_it_budget: 4500000, customer_tier: "Growth" }));
    await tx((c) => setCustomFieldValues(c, context, "party", account.id, { customer_tier: "Strategic" }));
    console.log("Custom field values on Suvidha Logistics (with one change in history)");
  }
  if (contact) {
    const contactValues = await one(`SELECT count(*)::int n FROM custom_field_values WHERE organization_id=$1 AND entity_id=$2`, [organizationId, contact.id]);
    if (!contactValues.n) { await tx((c) => setCustomFieldValues(c, context, "contact", contact.id, { preferred_channel: "Email", decision_influence: 40 })); console.log("Custom field values on Rohan Gupta"); }
  }

  // 3. Buying committee on a live Suvidha deal.
  const deal = await one(`SELECT id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name='Suvidha Logistics Pvt Ltd — Custom Reporting Add-on'`, [organizationId]);
  let committee = await one(`SELECT id FROM tenant.crm_buying_committees WHERE organization_id=$1 AND opportunity_id=$2`, [organizationId, deal.id]);
  if (!committee) {
    committee = await tx((c) => createCrmRecord(c, context, "buying-committees", { partyId: account.id, opportunityId: deal.id, name: "Reporting add-on decision group", decisionProcess: "CFO approves after operations sign-off", decisionDate: "2026-11-15", coverageScore: 70, status: "active" }));
    for (const member of [
      { name: "Rohan Gupta", memberRole: "economic_buyer", influenceLevel: "critical", sentiment: "supporter", contactId: contact?.id ?? null },
      { name: "Meera Iyer", memberRole: "champion", influenceLevel: "high", sentiment: "strong_supporter" },
      { name: "Vikram Shah", memberRole: "technical", influenceLevel: "medium", sentiment: "neutral" },
      { name: "Anil Kapoor", memberRole: "procurement", influenceLevel: "medium", sentiment: "detractor", gaps: "Wants a 3-year price lock" },
    ]) await tx((c) => createCrmRecord(c, context, "buying-committee-members", { committeeId: committee.id, status: "active", ...member }));
    console.log("Buying committee with 4 members");
  } else console.log("Already present: buying committee");

  // 4. A won deal that came from a converted lead.
  const wonFromLead = await one(`SELECT count(*)::int n FROM tenant.crm_opportunities WHERE organization_id=$1 AND lead_id IS NOT NULL AND status='won'`, [organizationId]);
  if (!wonFromLead.n) {
    const fromLead = await one(`SELECT o.id,o.updated_at,o.stage_id FROM tenant.crm_opportunities o WHERE o.organization_id=$1 AND o.lead_id IS NOT NULL AND o.status='open' ORDER BY o.amount DESC NULLS LAST LIMIT 1`, [organizationId]);
    const wonStage = await one(`SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND name='Closed Won'`, [organizationId]);
    const reason = await one(`SELECT id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND code='WON_RELATIONSHIP'`, [organizationId]);
    if (fromLead) {
      await tx((c) => moveOpportunityStage(c, context, fromLead.id, wonStage.id, null, { outcomeReasonId: reason.id, outcomeNotes: "Came in through the trade show; signed after the pilot.", expectedUpdatedAt: fromLead.updated_at.toISOString(), expectedStageId: fromLead.stage_id }));
      console.log("Won a deal that came from a converted lead");
    }
  } else console.log("Already present: won deal from a lead");

  // 5. Forecast accuracy: prediction captured for September, then the period closed.
  const sept = await one(`SELECT id,status,updated_at FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND period_start='2026-09-01' AND period_end='2026-09-30'`, [organizationId]);
  if (sept && sept.status !== "closed") {
    const snap = await one(`SELECT 1 FROM tenant.crm_predictive_forecast_snapshots WHERE organization_id=$1 AND forecast_period_id=$2`, [organizationId, sept.id]);
    if (!snap) await tx((c) => capturePredictiveForecast(c, context, { forecastPeriodId: sept.id }));
    const fresh = await one(`SELECT updated_at FROM tenant.crm_forecast_periods WHERE id=$1`, [sept.id]);
    await tx((c) => updateCrmRecord(c, context, "forecast-periods", sept.id, { status: "closed" }, { expectedUpdatedAt: fresh.updated_at.toISOString() }));
    console.log("September 2026: prediction captured and period closed");
  } else console.log("Already present: closed September period");

  // 6. A lead stage override with a realistic reason.
  const overrideDone = await one(`SELECT 1 FROM tenant.crm_lead_stage_events WHERE organization_id=$1 AND override_reason=$2`, [organizationId, OVERRIDE_NOTE]);
  if (!overrideDone) {
    const lead = await one(`SELECT l.id,l.updated_at FROM tenant.crm_leads l WHERE l.organization_id=$1 AND l.record_status='active' AND l.status='new' AND l.qualification_state='not_reviewed' AND l.email IS NOT NULL ORDER BY l.created_at DESC LIMIT 1`, [organizationId]);
    await tx((c) => transitionLeadStage(c, context, lead.id, { stageCode: "working", overrideUsed: true, overrideReason: OVERRIDE_NOTE, note: OVERRIDE_NOTE, expectedUpdatedAt: lead.updated_at.toISOString() }));
    console.log("Lead stage override recorded");
  } else console.log("Already present: lead stage override");

  // 7. A realistic unqualified decision (older demo reasons carry seed wording in immutable history).
  const UNQUAL_TEXT = "Chose to renew their current ERP for two more years; revisit in 2028.";
  const unq = await one(`SELECT 1 FROM tenant.crm_leads WHERE organization_id=$1 AND qualification_reason_text=$2`, [organizationId, UNQUAL_TEXT]);
  if (!unq) {
    const lead = await one(`SELECT id,updated_at FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' AND qualification_state='not_reviewed' AND company_name IS NOT NULL AND email IS NOT NULL ORDER BY created_at LIMIT 1`, [organizationId]);
    await tx((c) => decideLeadQualification(c, context, lead.id, { decision: "unqualified", reasonCode: "no_current_requirement", reasonText: UNQUAL_TEXT, note: "Spoke with the CFO; they are happy with the incumbent for now.", expectedUpdatedAt: lead.updated_at.toISOString() }));
    console.log("Realistic unqualified decision recorded");
  } else console.log("Already present: realistic unqualified decision");

  console.log("Done.");
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
