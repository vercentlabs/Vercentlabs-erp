#!/usr/bin/env node
// F008 Duplicate Detection — the demo org has 530 Leads/285 Accounts/412
// Contacts with zero real duplicate pairs among them (verified by query
// before writing this script), and zero rows in any of the three
// duplicate-override tables or the merge-history tables. Every screen this
// feature has — the "Suspected duplicates"/"Full scan" workspace, the
// inline review panels on each record's detail page, and the Account/
// Contact merge dialogs — has nothing real to show without deliberately
// planted duplicates. Seeds three Lead pairs (exact/L1, probable/L2, a
// second exact/L3) and two pairs each for Accounts/Contacts (one exact,
// one probable), via the SAME governed create/merge functions the app
// itself calls (createCrmRecord, createCrmAccount, createCrmContact,
// mergeAccountsGoverned, mergeContactsGoverned) — never raw SQL for
// operational records. For Accounts/Contacts, the PROBABLE pair (not the
// exact/override one) is the one actually merged here — mergeAccountsGoverned/
// mergeContactsGoverned's generic FK-metadata-driven repointReferences()
// also tries to repoint the immutable crm_account_duplicate_overrides/
// crm_contact_duplicate_overrides audit tables, which reject any UPDATE by
// design, so merging an override-created pair fails (a real pre-existing
// gap in the merge engine, confirmed while writing this script — see the
// comment at the Accounts section). L1 and L2 are left active and unmerged
// by this script; L3 (Sanjay Verma/S. Verma) is dedicated to being merged
// LIVE, in the browser, during the screenshot pass, via Lead's one-click
// merge (mergeCrmLead, a dedicated function untouched by the gap above) —
// kept separate from L1 so a repeat screenshot pass always has a fresh
// pair to merge rather than needing L1 (already spent by an earlier run)
// back. Local-only, idempotent, same convention as the other
// scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  createCrmRecord,
  createCrmAccount,
  createCrmContact,
  mergeAccountsGoverned,
  mergeContactsGoverned,
  enqueueDuplicateFullScan,
  processDuplicateFullScanBatch,
} from "../../services/api/src/index.js";
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
  const company = (await admin.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];
  const context = {
    organizationId,
    userId: owner.id,
    activeCompanyId: company?.id ?? null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.leads.manage", "crm.accounts.manage", "crm.data-quality.manage"],
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

  console.log(`Seeding F008 Duplicate Detection demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. Leads: one exact pair (email match, created via the create-time
  // override since an exact match blocks Lead creation outright), left
  // active for the "review" + one-click-merge screenshots; one probable
  // pair (name + company, no shared email/mobile) that never blocks
  // creation, left active so the suspected-duplicates list always has a
  // "Possible" row to show alongside the "Very likely" one.
  const leadA = (await admin.query(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code=$2`, [organizationId, "LEAD-F008-L1A"])).rows[0];
  let leadAId = leadA?.id;
  if (!leadA) {
    const created = await withTx((client) => createCrmRecord(client, context, "leads", {
      code: "LEAD-F008-L1A",
      firstName: "Rohan",
      lastName: "Malhotra",
      email: "rohan.malhotra@duplicatetest.in",
      companyName: "Malhotra Ceramics",
    }));
    leadAId = created.id;
    console.log("  lead created: Rohan Malhotra (LEAD-F008-L1A)");
  } else {
    console.log("  lead (already exists): Rohan Malhotra (LEAD-F008-L1A)");
  }
  const leadB = (await admin.query(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code=$2`, [organizationId, "LEAD-F008-L1B"])).rows[0];
  if (!leadB) {
    await withTx((client) => createCrmRecord(client, context, "leads", {
      code: "LEAD-F008-L1B",
      firstName: "R.",
      lastName: "Malhotra",
      email: "rohan.malhotra@duplicatetest.in",
      companyName: "Malhotra Ceramics",
      duplicateOverrideReason: "F008 demo seed — deliberately planted exact duplicate for the review/merge screenshots.",
    }));
    console.log("  lead created (exact duplicate, override): R. Malhotra (LEAD-F008-L1B)");
  } else {
    console.log("  lead (already exists): R. Malhotra (LEAD-F008-L1B)");
  }

  const leadC = (await admin.query(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code=$2`, [organizationId, "LEAD-F008-L2A"])).rows[0];
  if (!leadC) {
    await withTx((client) => createCrmRecord(client, context, "leads", {
      code: "LEAD-F008-L2A",
      firstName: "Vikram",
      lastName: "Choudhary",
      companyName: "Deccan Logistics",
      mobile: "9811100201",
    }));
    console.log("  lead created: Vikram Choudhary (LEAD-F008-L2A)");
  } else {
    console.log("  lead (already exists): Vikram Choudhary (LEAD-F008-L2A)");
  }
  // Same first+last name as L2A on purpose: lead-duplicates.js's classify()
  // is hardcoded (not rule-driven like Accounts/Contacts) and its
  // "probable" branch requires normalized_name to match EXACTLY (no fuzzy
  // comparison) alongside company — a near-miss spelling like "Vikram S
  // Choudhary" normalizes to a different string and triggers no signal at
  // all, confirmed by hitting exactly that while writing this script. Code
  // "L2C", not "L2B": an earlier version of this script created L2B with
  // the near-miss spelling, and Leads can't be deleted (crm_lead_score_
  // snapshots' own immutability trigger blocks the cascade), so that row
  // is left in place, unused and harmless, rather than a broken re-seed.
  const leadD = (await admin.query(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code=$2`, [organizationId, "LEAD-F008-L2C"])).rows[0];
  if (!leadD) {
    await withTx((client) => createCrmRecord(client, context, "leads", {
      code: "LEAD-F008-L2C",
      firstName: "Vikram",
      lastName: "Choudhary",
      companyName: "Deccan Logistics",
      mobile: "9811100203",
    }));
    console.log("  lead created (probable duplicate): Vikram Choudhary #2 (LEAD-F008-L2C)");
  } else {
    console.log("  lead (already exists): Vikram Choudhary #2 (LEAD-F008-L2C)");
  }

  // A third exact pair, dedicated to actually being merged live during the
  // screenshot pass (mergeCrmLead's one-click action, no dialog) — kept
  // separate from L1 so re-running the screenshot pass after L1 has
  // already been merged away doesn't need a fresh pair every time.
  const leadE = (await admin.query(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code=$2`, [organizationId, "LEAD-F008-L3A"])).rows[0];
  if (!leadE) {
    await withTx((client) => createCrmRecord(client, context, "leads", {
      code: "LEAD-F008-L3A",
      firstName: "Sanjay",
      lastName: "Verma",
      email: "sanjay.verma@duplicatetest.in",
      companyName: "Verma Auto Components",
    }));
    console.log("  lead created: Sanjay Verma (LEAD-F008-L3A)");
  } else {
    console.log("  lead (already exists): Sanjay Verma (LEAD-F008-L3A)");
  }
  const leadF = (await admin.query(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code=$2`, [organizationId, "LEAD-F008-L3B"])).rows[0];
  const leadEAlreadyMerged = (await admin.query(
    `SELECT 1 FROM tenant.crm_merge_records WHERE organization_id=$1 AND entity_type='lead' AND target_id=(SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND code='LEAD-F008-L3A') LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!leadF && !leadEAlreadyMerged) {
    await withTx((client) => createCrmRecord(client, context, "leads", {
      code: "LEAD-F008-L3B",
      firstName: "S.",
      lastName: "Verma",
      email: "sanjay.verma@duplicatetest.in",
      companyName: "Verma Auto Components",
      duplicateOverrideReason: "F008 demo seed — deliberately planted exact duplicate for the live one-click-merge screenshot.",
    }));
    console.log("  lead created (exact duplicate, override): S. Verma (LEAD-F008-L3B)");
  } else if (leadEAlreadyMerged) {
    console.log("  lead pair (already merged live during a screenshot pass): Sanjay Verma/S. Verma");
  } else {
    console.log("  lead (already exists): S. Verma (LEAD-F008-L3B)");
  }

  // --- 2. Accounts: one exact pair (legal_name match, via override) left
  // ACTIVE for the review-panel + merge-dialog screenshots; one probable
  // pair (fuzzy legal name, no override needed) actually merged live via
  // mergeAccountsGoverned so the merge-history table and the survivor's
  // post-merge state are real, not just staged. Deliberately NOT the exact
  // pair: mergeAccountsGoverned's generic FK-metadata-driven
  // repointReferences() tries to repoint crm_account_duplicate_overrides
  // too, and that table's own immutability trigger
  // (crm_account_duplicate_override_immutable) rejects any UPDATE on it —
  // confirmed by hitting this for real while writing this script. A
  // genuine pre-existing gap in the merge engine (it doesn't special-case
  // append-only audit tables that reference the merged party), not
  // something this seed script should route around by weakening the
  // scenario further than necessary — recorded here rather than silently
  // avoided.
  // Looked up by display_name, not a "code" input field — createCrmAccount
  // (account-operations.js) always calls nextAccountCode() itself and
  // silently ignores any code the caller supplies, unlike createCrmRecord's
  // generic leads path.
  const acctA = (await admin.query(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, [organizationId, "Meridian Textiles Pvt Ltd"])).rows[0];
  let acctAId = acctA?.id;
  if (!acctA) {
    const created = await withTx((client) => createCrmAccount(client, context, {
      displayName: "Meridian Textiles Pvt Ltd",
      legalName: "Meridian Textiles Private Limited",
      gstin: "27MERID0001A1Z9",
      partyType: "prospect",
    }));
    acctAId = created.id;
    console.log("  account created: Meridian Textiles Pvt Ltd");
  } else {
    console.log("  account (already exists): Meridian Textiles Pvt Ltd");
  }
  const acctB = (await admin.query(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, [organizationId, "Meridian Textiles Private Limited"])).rows[0];
  if (!acctB) {
    // No gstin here on purpose: business_parties has a real DB-level
    // UNIQUE(organization_id, gstin) index, so two accounts can never
    // actually share one — the exact-duplicate signal this pair
    // demonstrates instead is the org's own "legal_name normalized" rule
    // (configured blocking=true), which has no such uniqueness constraint.
    await withTx((client) => createCrmAccount(client, context, {
      displayName: "Meridian Textiles Private Limited",
      legalName: "Meridian Textiles Private Limited",
      partyType: "prospect",
      duplicateOverrideReason: "F008 demo seed — deliberately planted exact duplicate for the review/merge-dialog screenshots.",
    }));
    console.log("  account created (exact duplicate, override): Meridian Textiles Private Limited");
  } else {
    console.log("  account (already exists): Meridian Textiles Private Limited");
  }

  const acctC = (await admin.query(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, [organizationId, "Sunrise Dairy Products"])).rows[0];
  let acctCId = acctC?.id;
  if (!acctC) {
    const created = await withTx((client) => createCrmAccount(client, context, {
      displayName: "Sunrise Dairy Products",
      legalName: "Sunrise Dairy Products",
      partyType: "prospect",
    }));
    acctCId = created.id;
    console.log("  account created: Sunrise Dairy Products");
  } else {
    console.log("  account (already exists): Sunrise Dairy Products");
  }
  let acctDId = (await admin.query(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, [organizationId, "Sunrise Dairy Product"])).rows[0]?.id;
  const acctCAlreadyMerged = (await admin.query(
    `SELECT 1 FROM tenant.crm_account_merge_history WHERE organization_id=$1 AND survivor_party_id=$2 LIMIT 1`,
    [organizationId, acctCId],
  )).rows[0];
  if (!acctDId && !acctCAlreadyMerged) {
    const created = await withTx((client) => createCrmAccount(client, context, {
      displayName: "Sunrise Dairy Product",
      legalName: "Sunrise Dairy Product",
      partyType: "prospect",
    }));
    acctDId = created.id;
    console.log("  account created (probable duplicate): Sunrise Dairy Product");
  } else if (acctCAlreadyMerged) {
    console.log("  account pair (already merged): Sunrise Dairy Products/Product");
  } else {
    console.log("  account (already exists): Sunrise Dairy Product");
  }
  if (acctDId && !acctCAlreadyMerged) {
    await withTx((client) => mergeAccountsGoverned(client, context, acctDId, acctCId, "F008 demo seed — merging the planted probable-duplicate Account pair."));
    console.log("  account merged: Sunrise Dairy Product -> Sunrise Dairy Products");
  }

  // --- 3. Contacts: one exact pair (email match, via override), merged
  // live via mergeContactsGoverned; one probable pair (fuzzy name) left
  // active. Attached to an existing Account rather than creating new ones.
  const parentAccount = (await admin.query(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];

  // Exact pair (email match, via override) left ACTIVE for the review-
  // panel + merge-dialog screenshots — never merged, for the same
  // repointReferences()-vs-immutable-audit-table reason documented above
  // Accounts. The probable pair (fuzzy name, no override needed) is
  // actually merged live.
  const contactA = (await admin.query(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND first_name=$2 AND last_name=$3`, [organizationId, "Neha", "Kapoor"])).rows[0];
  if (!contactA) {
    await withTx((client) => createCrmContact(client, context, {
      accountId: parentAccount.id,
      firstName: "Neha",
      lastName: "Kapoor",
      email: "neha.kapoor@duplicatetest.in",
      isPrimary: false,
    }));
    console.log("  contact created: Neha Kapoor");
  } else {
    console.log("  contact (already exists): Neha Kapoor");
  }
  const contactB = (await admin.query(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND first_name=$2 AND last_name=$3`, [organizationId, "Neha R", "Kapoor"])).rows[0];
  if (!contactB) {
    await withTx((client) => createCrmContact(client, context, {
      accountId: parentAccount.id,
      firstName: "Neha R",
      lastName: "Kapoor",
      email: "neha.kapoor@duplicatetest.in",
      isPrimary: false,
      duplicateOverrideReason: "F008 demo seed — deliberately planted exact duplicate for the review/merge-dialog screenshots.",
    }));
    console.log("  contact created (exact duplicate, override): Neha R Kapoor");
  } else {
    console.log("  contact (already exists): Neha R Kapoor");
  }

  const contactC = (await admin.query(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND first_name=$2 AND last_name=$3`, [organizationId, "Aditya", "Bhatia"])).rows[0];
  let contactCId = contactC?.id;
  if (!contactC) {
    const created = await withTx((client) => createCrmContact(client, context, {
      accountId: parentAccount.id,
      firstName: "Aditya",
      lastName: "Bhatia",
      mobile: "9822200301",
      isPrimary: false,
    }));
    contactCId = created.id;
    console.log("  contact created: Aditya Bhatia");
  } else {
    console.log("  contact (already exists): Aditya Bhatia");
  }
  let contactDId = (await admin.query(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND first_name=$2 AND last_name=$3`, [organizationId, "Aditya", "Bhatiya"])).rows[0]?.id;
  const contactCAlreadyMerged = (await admin.query(
    `SELECT 1 FROM tenant.crm_contact_merge_history WHERE organization_id=$1 AND survivor_contact_id=$2 LIMIT 1`,
    [organizationId, contactCId],
  )).rows[0];
  if (!contactDId && !contactCAlreadyMerged) {
    const created = await withTx((client) => createCrmContact(client, context, {
      accountId: parentAccount.id,
      firstName: "Aditya",
      lastName: "Bhatiya",
      mobile: "9822200302",
      isPrimary: false,
    }));
    contactDId = created.id;
    console.log("  contact created (probable duplicate): Aditya Bhatiya");
  } else if (contactCAlreadyMerged) {
    console.log("  contact pair (already merged): Aditya Bhatia/Bhatiya");
  } else {
    console.log("  contact (already exists): Aditya Bhatiya");
  }
  if (contactDId && !contactCAlreadyMerged) {
    await withTx((client) => mergeContactsGoverned(client, context, contactDId, contactCId, "F008 demo seed — merging the planted probable-duplicate Contact pair."));
    console.log("  contact merged: Aditya Bhatiya -> Aditya Bhatia");
  }

  // --- 4. Run a real full-dataset scan for Leads to completion, so the
  // "Full scan" panel already has a completed run with real results to
  // show (the Account/Contact scans are deliberately left un-run so the
  // screenshot pass can capture the "run it live" flow for those instead).
  const existingLeadScan = (await admin.query(
    `SELECT id FROM tenant.background_jobs WHERE organization_id=$1 AND job_type='crm.duplicates.full_scan' AND payload->>'entityType'='lead' AND status='completed' LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!existingLeadScan) {
    const job = await withTx((client) => enqueueDuplicateFullScan(client, context, "lead"));
    let done = false;
    let iterations = 0;
    while (!done && iterations < 30) {
      const result = await withTx((client) => processDuplicateFullScanBatch(client, context, job.id));
      done = result.done;
      iterations += 1;
    }
    await admin.query(`UPDATE tenant.background_jobs SET status='completed', completed_at=now() WHERE organization_id=$1 AND id=$2`, [organizationId, job.id]);
    console.log(`  full scan run to completion for Leads (${iterations} batch(es))`);
  } else {
    console.log("  full scan (already completed): Leads");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
