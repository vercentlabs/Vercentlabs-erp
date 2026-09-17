#!/usr/bin/env node
// Populates the "VercentLabs" organization with realistic-looking CRM demo
// data (Accounts, Contacts, Leads, Opportunities, Tasks, Calls, Meetings,
// Follow-ups) using the app's own governed domain functions from
// services/api — never raw INSERTs for operational records — so every
// business rule (duplicate detection, initial-stage resolution, score
// calculation, assignment, etc.) runs exactly as it would for a real user
// clicking through the UI. Local-only: refuses to run against a
// non-localhost database, same convention as scripts/qa/set-qa-password.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  createCrmAccount,
  createCrmContact,
  createCrmRecord,
  createCrmTask,
  createCrmCall,
  createCrmMeeting,
  createCrmFollowUp,
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

const ORG_NAME = "VercentLabs";

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function calendarDateFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function slugify(name) {
  // Longest alternatives first: "co\.?" alone would otherwise match inside
  // "Consultants"/"Components" before those full-word alternatives get a
  // chance, leaving a mangled remainder (e.g. "primefinancialnsultants").
  return name.toLowerCase().replace(/\b(pvt ltd|industries|consultants|solutions|components|systems|services|exports|ltd|co\.?)\b/gi, "").trim().replace(/[^a-z0-9]+/g, "");
}

const INDUSTRIES = ["Logistics", "Retail Technology", "Manufacturing", "Food & Beverage", "Data & Analytics", "Agriculture", "Construction", "Healthcare", "Textiles", "Financial Services"];

const ACCOUNTS = [
  { name: "Suvidha Logistics Pvt Ltd", industry: "Logistics", city: "Pune", state: "Maharashtra" },
  { name: "Nimbus Retail Solutions", industry: "Retail Technology", city: "Bengaluru", state: "Karnataka" },
  { name: "Bluepeak Manufacturing Co", industry: "Manufacturing", city: "Ahmedabad", state: "Gujarat" },
  { name: "Coastal Foods Exports", industry: "Food & Beverage", city: "Kochi", state: "Kerala" },
  { name: "Zenith Analytics Pvt Ltd", industry: "Data & Analytics", city: "Hyderabad", state: "Telangana" },
  { name: "Green Valley Agro Industries", industry: "Agriculture", city: "Nashik", state: "Maharashtra" },
  { name: "Skyline Constructions Pvt Ltd", industry: "Construction", city: "Gurugram", state: "Haryana" },
  { name: "Meridian Healthcare Systems", industry: "Healthcare", city: "Chennai", state: "Tamil Nadu" },
  { name: "Orbit Textiles Ltd", industry: "Textiles", city: "Surat", state: "Gujarat" },
  { name: "Prime Financial Consultants", industry: "Financial Services", city: "Mumbai", state: "Maharashtra" },
];

const FIRST_NAMES = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Ananya", "Diya", "Saanvi", "Aadhya", "Kavya", "Myra", "Anika", "Riya", "Priya", "Neha", "Rohan", "Kabir", "Aryan", "Dhruv", "Karan", "Meera", "Pooja", "Sneha", "Tanvi", "Isha"];
const LAST_NAMES = ["Sharma", "Verma", "Iyer", "Nair", "Reddy", "Rao", "Kulkarni", "Mehta", "Gupta", "Agarwal", "Malhotra", "Bose", "Chatterjee", "Pillai", "Menon", "Desai", "Joshi", "Kapoor", "Bhatt", "Chawla"];
const DESIGNATIONS = ["Chief Executive Officer", "Chief Financial Officer", "VP Operations", "Procurement Manager", "IT Director", "Head of Sales", "Finance Manager", "Operations Head", "General Manager", "Business Development Manager"];

function randomPersonName() {
  return { firstName: randomOf(FIRST_NAMES), lastName: randomOf(LAST_NAMES) };
}
function phoneNumber() {
  return `+91 ${randomInt(70000, 99999)}${randomInt(10000, 99999)}`;
}

const LEAD_COMPANIES = [
  "Horizon Freight Pvt Ltd", "Vantage Point Studios", "Copper Leaf Hospitality", "Bright Path Ed-Tech",
  "Silverline Realty", "TrueNorth Insurance Brokers", "Aster Pharma Distributors", "Nova Print Solutions",
  "Everest Cold Storage", "Lakeside Furniture Exports", "Falcon Security Services", "Rampart Auto Components",
  "Cedar Grove Interiors", "Pinnacle IT Staffing",
];

const OPPORTUNITY_TEMPLATES = [
  (company) => `${company} — Annual Platform License Renewal`,
  (company) => `${company} — ERP Implementation Phase 2`,
  (company) => `${company} — Warehouse Automation Rollout`,
  (company) => `${company} — CRM Migration Project`,
  (company) => `${company} — Multi-branch Expansion Deal`,
  (company) => `${company} — Custom Reporting Add-on`,
  (company) => `${company} — Support & Maintenance Contract`,
  (company) => `${company} — New Site Onboarding`,
];

const TASK_SUBJECTS = ["Send updated proposal", "Follow up on pricing questions", "Prepare contract draft", "Share product comparison sheet", "Confirm stakeholder list", "Review procurement checklist"];
const CALL_SUBJECTS = ["Discovery call", "Pricing discussion", "Technical requirements call", "Check-in call", "Renewal discussion"];
const MEETING_SUBJECTS = ["Product demo", "Requirements workshop", "Contract review meeting", "Kickoff meeting", "Quarterly business review"];
const FOLLOWUP_SUBJECTS = ["Follow up after demo", "Check on decision timeline", "Send reminder about pending signature", "Follow up on trial feedback"];

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
    permissions: [],
    roleSlugs: ["organization_owner"],
  };

  const sourceRows = (await admin.query(`SELECT id, name FROM tenant.crm_lead_sources WHERE organization_id = $1 AND status = 'active'`, [organizationId])).rows;
  const leadStageRows = (await admin.query(`SELECT id, code FROM tenant.crm_lead_stages WHERE organization_id = $1`, [organizationId])).rows;
  const contactedStage = leadStageRows.find((s) => s.code === "contacted");
  const workingStage = leadStageRows.find((s) => s.code === "working");

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

  console.log(`Seeding realistic CRM demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- Accounts + Contacts ---
  // Idempotent: a prior run of this script may have already committed some
  // or all of these (each withTx() call commits independently), so every
  // create is guarded by an existence check keyed on the same display
  // name / company name this script always uses, rather than assuming a
  // clean slate.
  const accountRecords = [];
  for (const acc of ACCOUNTS) {
    const existing = (await admin.query(
      `SELECT id, display_name AS "displayName" FROM tenant.business_parties WHERE organization_id = $1 AND display_name = $2 LIMIT 1`,
      [organizationId, acc.name],
    )).rows[0];
    if (existing) {
      accountRecords.push(existing);
      console.log(`  account (already exists): ${acc.name}`);
      continue;
    }

    const slug = slugify(acc.name);
    const record = await withTx((client) =>
      createCrmAccount(client, context, {
        displayName: acc.name,
        industry: acc.industry,
        website: `https://www.${slug}.in`,
        phone: phoneNumber(),
        email: `contact@${slug}.in`,
        city: acc.city,
        state: acc.state,
        countryCode: "IN",
        currencyCode: "INR",
        partyType: "customer",
      }),
    );
    accountRecords.push(record);
    console.log(`  account: ${acc.name}`);

    const contactCount = randomInt(1, 2);
    for (let i = 0; i < contactCount; i += 1) {
      const person = randomPersonName();
      const contactSlug = `${person.firstName}.${person.lastName}`.toLowerCase();
      await withTx((client) =>
        createCrmContact(client, context, {
          firstName: person.firstName,
          lastName: person.lastName,
          designation: randomOf(DESIGNATIONS),
          email: `${contactSlug}@${slug}.in`,
          mobile: phoneNumber(),
          accountId: record.id,
        }),
      );
      console.log(`    contact: ${person.firstName} ${person.lastName}`);
    }
  }

  // --- Leads (standalone prospects, not yet linked to an account) ---
  const leadRecords = [];
  const newlyCreatedLeadIds = new Set();
  for (const leadCompany of LEAD_COMPANIES) {
    const existing = (await admin.query(
      `SELECT id, status, first_name AS "firstName" FROM tenant.crm_leads WHERE organization_id = $1 AND company_name = $2 LIMIT 1`,
      [organizationId, leadCompany],
    )).rows[0];
    if (existing) {
      leadRecords.push(existing);
      console.log(`  lead (already exists): ${leadCompany}`);
      continue;
    }

    const person = randomPersonName();
    const slug = slugify(leadCompany);
    const record = await withTx((client) =>
      createCrmRecord(client, context, "leads", {
        firstName: person.firstName,
        lastName: person.lastName,
        email: `${person.firstName}.${person.lastName}@${slug}.in`.toLowerCase(),
        mobile: phoneNumber(),
        companyName: leadCompany,
        jobTitle: randomOf(DESIGNATIONS),
        industry: randomOf(INDUSTRIES),
        sourceId: sourceRows.length ? randomOf(sourceRows).id : undefined,
        priority: randomOf(["low", "medium", "high", "urgent"]),
        rating: randomOf(["cold", "warm", "hot"]),
        city: randomOf(["Mumbai", "Delhi", "Bengaluru", "Pune", "Chennai", "Kolkata", "Hyderabad"]),
        countryCode: "IN",
        nextFollowUpAt: Math.random() > 0.4 ? daysFromNow(randomInt(1, 14)) : undefined,
      }),
    );
    leadRecords.push(record);
    newlyCreatedLeadIds.add(record.id);
    console.log(`  lead: ${person.firstName} ${person.lastName} (${leadCompany})`);
  }

  // Move roughly half the NEWLY created leads out of "New" for realistic
  // stage variety — via the same transitionLeadStage domain function the
  // UI uses, not a direct status UPDATE (creation itself force-sets "new"
  // and forbids setting anything else, by design). Leads reused from a
  // prior run of this script are left as-is; they were already moved (or
  // deliberately left at New) the first time.
  const { transitionLeadStage } = await import("../../services/api/src/index.js");
  for (let i = 0; i < leadRecords.length; i += 1) {
    if (!newlyCreatedLeadIds.has(leadRecords[i].id)) continue;
    const roll = Math.random();
    if (roll < 0.35 && contactedStage) {
      await withTx((client) => transitionLeadStage(client, context, leadRecords[i].id, { stageId: contactedStage.id }));
    } else if (roll < 0.55 && contactedStage && workingStage) {
      await withTx((client) => transitionLeadStage(client, context, leadRecords[i].id, { stageId: contactedStage.id }));
      await withTx((client) => transitionLeadStage(client, context, leadRecords[i].id, { stageId: workingStage.id }));
    }
  }
  console.log("  moved a realistic subset of newly created leads to Contacted/Working");

  // --- Opportunities (linked to accounts) ---
  const opportunityRecords = [];
  for (const record of accountRecords) {
    const existingOpp = (await admin.query(
      `SELECT id, name FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2 LIMIT 1`,
      [organizationId, record.id],
    )).rows[0];
    if (existingOpp) {
      opportunityRecords.push(existingOpp);
      console.log(`  opportunity (already exists): ${existingOpp.name}`);
      continue;
    }
    if (Math.random() > 0.75) continue; // not every account has an open deal
    const accInfo = ACCOUNTS.find((a) => slugify(a.name) === slugify(record.displayName || ""));
    const label = (OPPORTUNITY_TEMPLATES[randomInt(0, OPPORTUNITY_TEMPLATES.length - 1)])(accInfo?.name ?? record.displayName ?? "Account");
    const opp = await withTx((client) =>
      createCrmRecord(client, context, "opportunities", {
        name: label,
        partyId: record.id,
        amount: randomInt(150, 5000) * 1000,
        currencyCode: "INR",
        expectedCloseDate: calendarDateFromNow(randomInt(15, 90)),
        nextStep: randomOf(["Awaiting stakeholder sign-off", "Send revised commercial terms", "Schedule technical review", "Confirm rollout timeline"]),
      }),
    );
    opportunityRecords.push(opp);
    console.log(`  opportunity: ${label}`);
  }

  // --- Activities (tasks, calls, meetings, follow-ups) ---
  const activityTargets = [
    ...leadRecords.map((r) => ({ entityType: "lead", entityId: r.id, label: r.firstName })),
    ...opportunityRecords.map((r) => ({ entityType: "opportunity", entityId: r.id, label: r.name })),
  ];

  for (const target of activityTargets) {
    if (Math.random() > 0.5) {
      await withTx((client) =>
        createCrmTask(client, context, {
          subject: `${randomOf(TASK_SUBJECTS)} — ${target.label}`,
          entityType: target.entityType,
          entityId: target.entityId,
          priority: randomOf(["low", "medium", "high"]),
          dueAt: daysFromNow(randomInt(-3, 10)),
        }),
      );
    }
    if (Math.random() > 0.65) {
      const callStartOffset = randomInt(1, 10);
      await withTx((client) =>
        createCrmCall(client, context, {
          subject: `${randomOf(CALL_SUBJECTS)} — ${target.label}`,
          direction: randomOf(["inbound", "outbound"]),
          phoneNumber: phoneNumber(),
          entityType: target.entityType,
          entityId: target.entityId,
          startAt: daysFromNow(callStartOffset),
          dueAt: daysFromNow(callStartOffset),
        }),
      );
    }
    if (Math.random() > 0.7) {
      const meetingStartOffset = randomInt(1, 14);
      await withTx((client) =>
        createCrmMeeting(client, context, {
          subject: `${randomOf(MEETING_SUBJECTS)} — ${target.label}`,
          locationType: "online",
          meetingUrl: "https://meet.vercentlabs.example/room",
          entityType: target.entityType,
          entityId: target.entityId,
          startAt: daysFromNow(meetingStartOffset),
          endAt: daysFromNow(meetingStartOffset + 1),
        }),
      );
    }
    if (Math.random() > 0.6) {
      await withTx((client) =>
        createCrmFollowUp(client, context, {
          subject: `${randomOf(FOLLOWUP_SUBJECTS)} — ${target.label}`,
          entityType: target.entityType,
          entityId: target.entityId,
          dueAt: daysFromNow(randomInt(1, 7)),
        }),
      );
    }
  }
  console.log(`  created activities across ${activityTargets.length} leads/opportunities`);

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
