#!/usr/bin/env node
// Enriches the existing "Vercentlabs" Contacts dataset with F003-specific
// states that the base demo seed never produces: an activated F008
// duplicate-rule set for contacts (without it, tenant.crm_duplicate_rules
// has zero rows and findContactDuplicates always returns [] — same
// dormant-until-activated situation as Accounts before the F002 pass),
// archived/reactivatable contacts, a genuinely multi-Account contact
// relationship, a standalone (no-Account) contact, and a multi-role
// Opportunity Contacts tab — so every F003 screen has real, non-empty data
// instead of placeholders. Governed domain functions only, never raw
// INSERTs for operational records. Local-only, same convention as the
// other scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  addContactAccountRelationship,
  addOpportunityContactRole,
  archiveCrmContact,
  createCrmContact,
  getActiveDuplicateRules,
  upsertDuplicateRule,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  throw new Error("Refusing to run against a non-local database.");
}

const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();

  const org = (await admin.query(`SELECT id FROM organizations WHERE name = $1 LIMIT 1`, [ORG_NAME])).rows[0];
  if (!org) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const organizationId = org.id;

  const company = (await admin.query(`SELECT id FROM companies WHERE organization_id = $1 LIMIT 1`, [organizationId])).rows[0];
  const branch = company ? (await admin.query(`SELECT id FROM branches WHERE company_id = $1 LIMIT 1`, [company.id])).rows[0] : null;
  const owner = (await admin.query(
    `SELECT u.id FROM users u JOIN organization_memberships om ON om.user_id = u.id WHERE om.organization_id = $1 AND om.status = 'active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!owner) throw new Error("No active member found for this organization.");

  const context = {
    organizationId,
    userId: owner.id,
    activeCompanyId: company?.id ?? null,
    activeBranchId: branch?.id ?? null,
    allowAllCompanies: true,
    permissions: ["crm.accounts.manage", "crm.accounts.view_sensitive", "crm.contacts.view_sensitive", "crm.opportunities.manage"],
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

  console.log(`Enriching F003 Contacts demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. Activate F008 duplicate-detection rules for contacts ---
  const existingRules = await withTx((client) => getActiveDuplicateRules(client, context, "contact"));
  const ruleExists = (signal, method) => existingRules.some((r) => r.signal === signal && r.method === method);
  const rulesToEnsure = [
    { signal: "email", method: "exact", weight: 100, blocking: true },
    { signal: "mobile", method: "normalized", weight: 90, blocking: true },
    { signal: "name", method: "normalized", weight: 100, blocking: true },
    { signal: "name", method: "fuzzy", weight: 40, blocking: false, fuzzyThreshold: 0.55 },
  ];
  for (const rule of rulesToEnsure) {
    if (ruleExists(rule.signal, rule.method)) {
      console.log(`  duplicate rule (already active): contact/${rule.signal}/${rule.method}`);
      continue;
    }
    await withTx((client) => upsertDuplicateRule(client, context, { entityType: "contact", enabled: true, ...rule }));
    console.log(`  duplicate rule activated: contact/${rule.signal}/${rule.method}`);
  }

  // --- 2. Archive two contacts so the Archive/Reactivate screens have a
  // real inactive record to show (the base seed never archives anyone).
  // Excludes every contact this script (or the F002 pass) uses as a hero
  // elsewhere — archiving them would break those other screenshots/steps,
  // exactly what happened the first time this ran against Rohan Gupta. ---
  const heroContactNames = ["Rohan", "Sneha", "Aditya", "Dhruv", "Ira", "Prisha"];
  const alreadyInactive = Number((await admin.query(
    `SELECT count(*)::int AS count FROM tenant.contacts WHERE organization_id=$1 AND status='inactive'`,
    [organizationId],
  )).rows[0].count);
  if (alreadyInactive >= 2) {
    console.log(`  archived contacts (already have ${alreadyInactive}): skipping`);
  } else {
    const archiveCandidates = (await admin.query(
      `SELECT id, first_name, last_name, updated_at FROM tenant.contacts
       WHERE organization_id=$1 AND status='active' AND NOT (first_name = ANY($2::text[]))
       ORDER BY created_at ASC LIMIT ${2 - alreadyInactive}`,
      [organizationId, heroContactNames],
    )).rows;
    for (const candidate of archiveCandidates) {
      await withTx((client) => archiveCrmContact(client, context, candidate.id, {}));
      console.log(`  archived: ${candidate.first_name} ${candidate.last_name || ""}`);
    }
  }

  // --- 3. A genuinely multi-Account contact relationship: Rohan Gupta
  // (Suvidha Logistics' contact) also gets an "affiliated" relationship
  // with Redwood Infra Projects, so ContactRelationshipsPanel shows more
  // than the single backfilled row. ---
  const rohan = (await admin.query(
    `SELECT c.id FROM tenant.contacts c JOIN tenant.business_parties p ON p.id=c.party_id
     WHERE p.organization_id=$1 AND p.display_name='Suvidha Logistics Pvt Ltd' AND c.status='active' LIMIT 1`,
    [organizationId],
  )).rows[0];
  const redwood = (await admin.query(
    `SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name='Redwood Infra Projects' LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (rohan && redwood) {
    const existingRelationship = (await admin.query(
      `SELECT id FROM tenant.crm_contact_account_relationships WHERE organization_id=$1 AND contact_id=$2 AND party_id=$3`,
      [organizationId, rohan.id, redwood.id],
    )).rows[0];
    if (existingRelationship) {
      console.log("  multi-account relationship (already exists): Rohan Gupta -> Redwood Infra Projects");
    } else {
      await withTx((client) =>
        addContactAccountRelationship(client, context, rohan.id, {
          accountId: redwood.id,
          relationshipType: "affiliated",
          stakeholderRole: "technical",
          notes: "Advises Redwood on logistics integration for the ERP rollout.",
        }),
      );
      console.log("  multi-account relationship: Rohan Gupta -> Redwood Infra Projects (affiliated, technical)");
    }
  }

  // --- 4. One standalone Contact (no Account) — F003's own gap-closure
  // (migration 058) made party_id nullable; the base seed never exercises
  // that path. ---
  const standaloneEmail = "vikram.desai@independent-consultant.example";
  const existingStandalone = (await admin.query(
    `SELECT id FROM tenant.contacts WHERE organization_id=$1 AND email=$2`,
    [organizationId, standaloneEmail],
  )).rows[0];
  if (existingStandalone) {
    console.log("  standalone contact (already exists): Vikram Desai");
  } else {
    await withTx((client) =>
      createCrmContact(client, context, {
        firstName: "Vikram",
        lastName: "Desai",
        designation: "Independent Procurement Consultant",
        email: standaloneEmail,
        mobile: "+91 9845011223",
      }),
    );
    console.log("  standalone contact: Vikram Desai (no Account)");
  }

  // --- 5. A multi-role Opportunity Contacts tab: Amberfield Realty has
  // two real contacts (Ira Chawla, Prisha Thakur) and an open deal — add
  // both with different roles so the new panel shows more than one row. ---
  const amberfieldRealtyOpp = (await admin.query(
    `SELECT o.id FROM tenant.crm_opportunities o JOIN tenant.business_parties p ON p.id=o.party_id
     WHERE p.organization_id=$1 AND p.display_name='Amberfield Realty' AND o.status='open' LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (amberfieldRealtyOpp) {
    const realtyContacts = (await admin.query(
      `SELECT c.id, c.first_name FROM tenant.contacts c JOIN tenant.business_parties p ON p.id=c.party_id
       WHERE p.organization_id=$1 AND p.display_name='Amberfield Realty' AND c.status='active' ORDER BY c.first_name`,
      [organizationId],
    )).rows;
    const roleFor = { Ira: "decision_maker", Prisha: "champion" };
    for (const contact of realtyContacts) {
      const existingRole = (await admin.query(
        `SELECT id FROM tenant.crm_opportunity_contact_roles WHERE organization_id=$1 AND opportunity_id=$2 AND contact_id=$3`,
        [organizationId, amberfieldRealtyOpp.id, contact.id],
      )).rows[0];
      if (existingRole) {
        console.log(`  opportunity contact role (already exists): ${contact.first_name} on Amberfield Realty deal`);
        continue;
      }
      await withTx((client) =>
        addOpportunityContactRole(client, context, amberfieldRealtyOpp.id, {
          contactId: contact.id,
          role: roleFor[contact.first_name] || "influencer",
        }),
      );
      console.log(`  opportunity contact role: ${contact.first_name} -> ${roleFor[contact.first_name] || "influencer"} on Amberfield Realty deal`);
    }
  } else {
    console.log("  Amberfield Realty open opportunity not found — skipping multi-role opportunity contacts step.");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
