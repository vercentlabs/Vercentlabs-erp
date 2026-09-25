#!/usr/bin/env node
// Enriches the existing "VercentLabs" Accounts dataset (created by
// seed-vercentlabs-demo-data.mjs) with F002-specific relationship data that
// script never touches: legal name/GSTIN/PAN (realistic Indian B2B tax
// identifiers, and the only way to exercise F008 duplicate detection, which
// is otherwise completely inert — tenant.crm_duplicate_rules is empty for
// every organization until a rule is explicitly activated), account
// hierarchy (parent/child groups), account plans + stakeholders,
// communications, and customer-service events — so every tab under
// AccountDetailScreen (Overview's Tax section, 360 view, Hierarchy, Account
// plan, Activity, Duplicates) has real, non-empty data instead of "Not set"
// placeholders. Uses the app's own governed domain functions from
// services/api, never raw INSERTs for operational records. Local-only, same
// convention as seed-vercentlabs-demo-data.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  updateCrmAccount,
  createCrmRecord,
  setAccountParent,
  recordCustomerServiceEvent,
  upsertDuplicateRule,
  getActiveDuplicateRules,
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

const ORG_NAME = process.env.SEED_ORG_NAME || "VercentLabs";

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const STATE_GST_CODES = {
  Maharashtra: "27", Karnataka: "29", Gujarat: "24", Kerala: "32", Telangana: "36",
  Haryana: "06", "Tamil Nadu": "33", Delhi: "07", Rajasthan: "08", "Madhya Pradesh": "23",
  "Uttar Pradesh": "09", "Andhra Pradesh": "37", Chandigarh: "04",
};
let panSequence = 1000;
function fakeGstin(state) {
  const code = STATE_GST_CODES[state] || "27";
  const pan = fakePan();
  // Real GSTIN shape: 2-digit state + 10-char PAN + 1 entity digit + 'Z' +
  // 1 checksum char = 15 total (business_parties.gstin's TEXT_LIMITS cap).
  return `${code}${pan}1Z${randomOf(["A", "B", "C", "D", "E"])}`;
}
function fakePan() {
  panSequence += 1;
  const letters = () => String.fromCharCode(65 + randomInt(0, 25));
  // Real PAN shape: 5 letters + 4 digits + 1 letter = 10 chars.
  return `${letters()}${letters()}${letters()}${letters()}${letters()}${String(panSequence).padStart(4, "0")}${letters()}`;
}
function legalFormFor(displayName) {
  if (/Pvt Ltd$/.test(displayName)) return displayName.replace(/Pvt Ltd$/, "Private Limited");
  if (/Ltd$/.test(displayName)) return displayName.replace(/Ltd$/, "Limited");
  return `${displayName} Private Limited`;
}

const STAKEHOLDER_ROLES = ["economic_buyer", "decision_maker", "champion", "influencer", "technical"];
const INFLUENCE_LEVELS = ["low", "medium", "high", "critical"];
const SENTIMENTS = ["strong_supporter", "supporter", "neutral", "detractor"];
const ACCOUNT_TIERS = ["strategic", "enterprise", "growth"];
const LIFECYCLE_STAGES = ["active", "onboarding", "renewal"];
const HEALTH_STATUSES = ["healthy", "watch", "at_risk"];

const COMM_TEMPLATES = [
  { channel: "email", direction: "outbound", subject: "Quarterly business review — proposed agenda" },
  { channel: "email", direction: "inbound", subject: "RE: Renewal terms for next fiscal year" },
  { channel: "call", direction: "outbound", subject: "Check-in call on rollout progress" },
  { channel: "whatsapp", direction: "inbound", subject: "Quick question on the last invoice" },
  { channel: "call", direction: "inbound", subject: "Escalation — support ticket follow-up" },
  { channel: "email", direction: "outbound", subject: "Sharing the updated implementation timeline" },
];

const SERVICE_EVENTS = [
  { eventType: "case_opened", status: "open", priority: "high", title: "Delayed shipment for last order batch" },
  { eventType: "case_resolved", status: "resolved", priority: "medium", title: "Invoice mismatch on GST line item — resolved" },
];

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
    permissions: ["crm.accounts.manage", "crm.accounts.view_sensitive"],
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

  console.log(`Enriching Accounts/F002 demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. Activate F008 duplicate-detection rules for accounts ---
  // Without this, tenant.crm_duplicate_rules has zero rows for every
  // organization and findAccountDuplicates always returns [] — the
  // Duplicates panel/workspace and merge-preview screens would have nothing
  // to show no matter what account data exists.
  const existingRules = await withTx((client) => getActiveDuplicateRules(client, context, "account"));
  const ruleExists = (signal, method) => existingRules.some((r) => r.signal === signal && r.method === method);
  const rulesToEnsure = [
    { signal: "gstin", method: "exact", weight: 100, blocking: true },
    { signal: "pan", method: "exact", weight: 90, blocking: true },
    { signal: "legal_name", method: "normalized", weight: 100, blocking: true },
    { signal: "legal_name", method: "fuzzy", weight: 40, blocking: false, fuzzyThreshold: 0.55 },
  ];
  for (const rule of rulesToEnsure) {
    if (ruleExists(rule.signal, rule.method)) {
      console.log(`  duplicate rule (already active): account/${rule.signal}/${rule.method}`);
      continue;
    }
    await withTx((client) => upsertDuplicateRule(client, context, { entityType: "account", enabled: true, ...rule }));
    console.log(`  duplicate rule activated: account/${rule.signal}/${rule.method}`);
  }

  // --- 2. Resolve the account groups we're going to enrich ---
  const allAccounts = (await admin.query(
    `SELECT id, display_name AS "displayName", legal_name AS "legalName", gstin, industry,
            (SELECT state FROM tenant.addresses a WHERE a.organization_id=business_parties.organization_id AND a.party_id=business_parties.id AND a.is_primary LIMIT 1) AS state
     FROM tenant.business_parties
     WHERE organization_id = $1 AND party_type IN ('customer','both','prospect') AND archived_at IS NULL
     ORDER BY created_at ASC`,
    [organizationId],
  )).rows;

  const byRoot = (root) => allAccounts.filter((a) => a.displayName.startsWith(root));
  const redwood = byRoot("Redwood");
  const amberfield = byRoot("Amberfield");
  const ACCOUNTS_BASE_NAMES = [
    "Suvidha Logistics Pvt Ltd", "Nimbus Retail Solutions", "Bluepeak Manufacturing Co", "Coastal Foods Exports",
    "Zenith Analytics Pvt Ltd", "Green Valley Agro Industries", "Skyline Constructions Pvt Ltd",
    "Meridian Healthcare Systems", "Orbit Textiles Ltd", "Prime Financial Consultants",
  ];
  const baseAccounts = allAccounts.filter((a) => ACCOUNTS_BASE_NAMES.includes(a.displayName));

  if (redwood.length < 2 || amberfield.length < 2) {
    console.log("  Redwood/Amberfield account groups not found (re-run seed-vercentlabs-demo-data.mjs first) — skipping hierarchy-dependent steps.");
  }

  const taxTargets = [...baseAccounts, ...redwood, ...amberfield];

  // --- 3. Legal name + GSTIN + PAN + a real primary address (skipped for
  // accounts already set, and deliberately skipped for the "Bluebell Data
  // Systems" pair if present — that pair's mismatched legal_name is what
  // makes it a real, organically occurring F008 duplicate candidate once
  // the rules above are active). The original demo seed script passed
  // city/state to createCrmAccount, but account-operations.js's
  // upsertPrimaryAddress silently no-ops without an addressLine1 — every
  // account org-wide ended up with zero rows in tenant.addresses despite
  // apparently having a city/state, so Overview's Address panel and the
  // Accounts list's Location column always read "Not provided". ---
  const ADDRESS_POOL = [
    { line1: "402, Cerebrum IT Park, Kalyani Nagar", city: "Pune", state: "Maharashtra", postalCode: "411006" },
    { line1: "14th Floor, Prestige Tech Park, Kadubeesanahalli", city: "Bengaluru", state: "Karnataka", postalCode: "560103" },
    { line1: "B-Wing, GIFT City, Gandhinagar Road", city: "Ahmedabad", state: "Gujarat", postalCode: "382355" },
    { line1: "3rd Floor, Marine Drive Business Centre", city: "Kochi", state: "Kerala", postalCode: "682031" },
    { line1: "Plot 9, HITEC City, Madhapur", city: "Hyderabad", state: "Telangana", postalCode: "500081" },
    { line1: "Survey No. 112, MIDC Industrial Area", city: "Nashik", state: "Maharashtra", postalCode: "422007" },
    { line1: "Tower C, Cyber Hub, DLF Phase 2", city: "Gurugram", state: "Haryana", postalCode: "122002" },
    { line1: "Old No. 12, Anna Salai", city: "Chennai", state: "Tamil Nadu", postalCode: "600002" },
    { line1: "Ring Road, Textile Market Complex", city: "Surat", state: "Gujarat", postalCode: "395002" },
    { line1: "Nariman Point, Maker Chambers", city: "Mumbai", state: "Maharashtra", postalCode: "400021" },
  ];
  for (const [index, acc] of taxTargets.entries()) {
    const address = ADDRESS_POOL[index % ADDRESS_POOL.length];
    if (acc.gstin) {
      console.log(`  tax details (already set): ${acc.displayName}`);
    } else {
      const legalName = legalFormFor(acc.displayName);
      const gstin = fakeGstin(address.state);
      const pan = gstin.slice(2, 12);
      await withTx((client) => updateCrmAccount(client, context, acc.id, { legalName, gstin, pan }, {}));
      acc.legalName = legalName;
      acc.gstin = gstin;
      console.log(`  tax details: ${acc.displayName} (${gstin})`);
    }

    const existingAddress = (await admin.query(
      `SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND status='active'`,
      [organizationId, acc.id],
    )).rows[0];
    if (existingAddress) {
      console.log(`  address (already set): ${acc.displayName}`);
      continue;
    }
    await withTx((client) =>
      updateCrmAccount(client, context, acc.id, {
        addressLine1: address.line1,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        countryCode: "IN",
      }, {}),
    );
    console.log(`  address: ${acc.displayName} (${address.city}, ${address.state})`);
  }

  // --- 4. Account hierarchy: two realistic group structures ---
  async function buildHierarchy(group, label) {
    if (group.length < 2) return;
    const [parent, ...children] = group;
    for (const child of children) {
      const current = (await admin.query(
        `SELECT parent_party_id AS "parentPartyId" FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
        [organizationId, child.id],
      )).rows[0];
      if (current?.parentPartyId === parent.id) {
        console.log(`  hierarchy (already set): ${child.displayName} -> ${parent.displayName}`);
        continue;
      }
      await withTx((client) => setAccountParent(client, context, child.id, parent.id, `Part of the ${label} group of companies`));
      console.log(`  hierarchy: ${child.displayName} -> ${parent.displayName}`);
    }
  }
  await buildHierarchy(redwood, "Redwood");
  await buildHierarchy(amberfield, "Amberfield");

  // --- 5. Account plans + stakeholders + communications + service events
  // for three "hero" accounts: the Redwood and Amberfield group parents
  // (showcasing hierarchy + a fully worked account plan together) plus one
  // ordinary flagship account with no hierarchy, for contrast. ---
  const heroAccounts = [redwood[0], amberfield[0], baseAccounts.find((a) => a.displayName === "Suvidha Logistics Pvt Ltd")].filter(Boolean);

  for (const acc of heroAccounts) {
    const contactsRows = (await admin.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", designation FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2`,
      [organizationId, acc.id],
    )).rows;

    // Account plan (unique per party — idempotent by existence check)
    let plan = (await admin.query(
      `SELECT id FROM tenant.crm_account_plans WHERE organization_id=$1 AND party_id=$2`,
      [organizationId, acc.id],
    )).rows[0];
    if (!plan) {
      plan = await withTx((client) =>
        createCrmRecord(client, context, "account-plans", {
          partyId: acc.id,
          accountTier: randomOf(ACCOUNT_TIERS),
          lifecycleStage: randomOf(LIFECYCLE_STAGES),
          // jsonb columns — the generic resource-mutation-service binds
          // fields as plain parameters with no ::jsonb cast, so a raw JS
          // array here would be sent using pg's default ARRAY wire format
          // and fail to cast; every other jsonb write in this codebase
          // JSON.stringify()s first (see task-operations.js, core-acceptance.js).
          objectives: JSON.stringify(["Expand footprint to two additional branches", "Migrate remaining manual workflows onto the platform"]),
          risks: JSON.stringify(["Renewal decision-maker is new to the account since last quarter"]),
          whiteSpace: JSON.stringify(["Add-on analytics module", "Multi-branch rollout"]),
          renewalDate: daysAgo(-randomInt(60, 180)).slice(0, 10),
          annualRevenue: randomInt(2000, 9000) * 1000,
          potentialRevenue: randomInt(9000, 15000) * 1000,
          healthScore: randomInt(55, 92),
          healthStatus: randomOf(HEALTH_STATUSES),
        }),
      );
      console.log(`  account plan: ${acc.displayName}`);
    } else {
      console.log(`  account plan (already exists): ${acc.displayName}`);
    }

    // Stakeholders
    const existingStakeholders = (await admin.query(
      `SELECT id FROM tenant.crm_account_stakeholders WHERE organization_id=$1 AND account_plan_id=$2`,
      [organizationId, plan.id],
    )).rows;
    const stakeholderTarget = 3;
    for (let i = existingStakeholders.length; i < stakeholderTarget; i += 1) {
      const contact = contactsRows[i % contactsRows.length];
      await withTx((client) =>
        createCrmRecord(client, context, "account-stakeholders", {
          accountPlanId: plan.id,
          contactId: contact?.id,
          name: contact ? `${contact.firstName} ${contact.lastName}` : `Stakeholder ${i + 1}`,
          title: contact?.designation || "Procurement Manager",
          stakeholderRole: randomOf(STAKEHOLDER_ROLES),
          influenceLevel: randomOf(INFLUENCE_LEVELS),
          sentiment: randomOf(SENTIMENTS),
          engagementScore: randomInt(40, 95),
        }),
      );
      console.log(`    stakeholder for ${acc.displayName}`);
    }

    // Communications
    const existingComms = (await admin.query(
      `SELECT id FROM tenant.crm_communications WHERE organization_id=$1 AND party_id=$2`,
      [organizationId, acc.id],
    )).rows;
    for (let i = existingComms.length; i < COMM_TEMPLATES.length; i += 1) {
      const template = COMM_TEMPLATES[i];
      const contact = contactsRows[i % contactsRows.length];
      await withTx((client) =>
        createCrmRecord(client, context, "communications", {
          partyId: acc.id,
          contactId: contact?.id,
          channel: template.channel,
          direction: template.direction,
          subject: template.subject,
          fromAddress: template.direction === "inbound" ? `${(contact?.firstName || "contact").toLowerCase()}@example.in` : "sales@vercentlabs.example",
          status: "logged",
          occurredAt: daysAgo(randomInt(1, 45)),
        }),
      );
      console.log(`    communication for ${acc.displayName}: ${template.subject}`);
    }

    // Customer-service events
    for (let i = 0; i < SERVICE_EVENTS.length; i += 1) {
      const event = SERVICE_EVENTS[i];
      await withTx((client) =>
        recordCustomerServiceEvent(client, context, acc.id, {
          externalSystem: "manual",
          externalCaseId: `SEED-${acc.id.slice(0, 8)}-${i}`,
          eventType: event.eventType,
          title: event.title,
          status: event.status,
          priority: event.priority,
          occurredAt: daysAgo(randomInt(2, 30)),
        }),
      );
    }
    console.log(`    service events for ${acc.displayName}`);
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
