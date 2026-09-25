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

const ORG_NAME = process.env.SEED_ORG_NAME || "VercentLabs";

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

const CITY_STATE = [
  { city: "Pune", state: "Maharashtra" }, { city: "Bengaluru", state: "Karnataka" },
  { city: "Ahmedabad", state: "Gujarat" }, { city: "Kochi", state: "Kerala" },
  { city: "Hyderabad", state: "Telangana" }, { city: "Nashik", state: "Maharashtra" },
  { city: "Gurugram", state: "Haryana" }, { city: "Chennai", state: "Tamil Nadu" },
  { city: "Surat", state: "Gujarat" }, { city: "Mumbai", state: "Maharashtra" },
  { city: "Delhi", state: "Delhi" }, { city: "Jaipur", state: "Rajasthan" },
  { city: "Lucknow", state: "Uttar Pradesh" }, { city: "Indore", state: "Madhya Pradesh" },
  { city: "Coimbatore", state: "Tamil Nadu" }, { city: "Nagpur", state: "Maharashtra" },
  { city: "Vadodara", state: "Gujarat" }, { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Visakhapatnam", state: "Andhra Pradesh" }, { city: "Chandigarh", state: "Chandigarh" },
];

// The original, hand-picked 10 accounts / 14 leads from the first seed pass
// (kept verbatim so the idempotency checks below keep recognizing them),
// plus a much larger combinatorial pool (root x business-type) so the org
// looks like it has hundreds of real records instead of a small fixed set.
const ACCOUNTS_BASE = [
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

const LEAD_COMPANIES_BASE = [
  "Horizon Freight Pvt Ltd", "Vantage Point Studios", "Copper Leaf Hospitality", "Bright Path Ed-Tech",
  "Silverline Realty", "TrueNorth Insurance Brokers", "Aster Pharma Distributors", "Nova Print Solutions",
  "Everest Cold Storage", "Lakeside Furniture Exports", "Falcon Security Services", "Rampart Auto Components",
  "Cedar Grove Interiors", "Pinnacle IT Staffing",
];

const NAME_ROOTS = [
  "Suvidha", "Nimbus", "Bluepeak", "Coastal", "Zenith", "Green Valley", "Skyline", "Meridian", "Orbit", "Prime",
  "Horizon", "Vantage", "Copper Leaf", "Bright Path", "Silverline", "TrueNorth", "Aster", "Nova", "Everest", "Lakeside",
  "Falcon", "Rampart", "Cedar Grove", "Pinnacle", "Crimson", "Ashford", "Larkspur", "Whitfield", "Ironclad", "Solstice",
  "Bayline", "Redwood", "Amberfield", "Northgate", "Clearwater", "Stonebridge", "Windermere", "Highcastle", "Marigold", "Cobalt",
  "Sundew", "Ridgeline", "Vermillion", "Sapphire Bay", "Golden Arc", "Wavecrest", "Ironwood", "Palm Grove", "Silver Birch", "Amber Sky",
  "Newgate", "Fairview", "Kestrel", "Osprey", "Trident", "Emberstone", "Brightline", "Bluebell", "Riverside", "Hillcrest",
];

const BUSINESS_SUFFIXES = [
  "Logistics Pvt Ltd", "Retail Solutions", "Manufacturing Co", "Foods Exports", "Analytics Pvt Ltd", "Agro Industries",
  "Constructions Pvt Ltd", "Healthcare Systems", "Textiles Ltd", "Financial Consultants", "Freight Pvt Ltd", "Studios",
  "Hospitality", "Ed-Tech", "Realty", "Insurance Brokers", "Pharma Distributors", "Print Solutions", "Cold Storage",
  "Furniture Exports", "Security Services", "Auto Components", "Interiors", "IT Staffing", "Energy Solutions",
  "Consulting Group", "Media Networks", "Data Systems", "Apparel Ltd", "Beverages Pvt Ltd", "Packaging Industries",
  "Chemicals Pvt Ltd", "Electronics Ltd", "Engineering Works", "Infra Projects", "Wellness Pvt Ltd", "Travels & Tours",
  "Publishing House", "Digital Solutions", "Renewables Pvt Ltd",
];

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateCompanyNames(count, excludeNames) {
  const excludeSet = new Set(excludeNames);
  const combos = [];
  for (const root of NAME_ROOTS) {
    for (const suffix of BUSINESS_SUFFIXES) {
      const name = `${root} ${suffix}`;
      if (!excludeSet.has(name)) combos.push(name);
    }
  }
  return shuffle(combos).slice(0, count);
}

// Overridable so a cleanup/top-up pass (e.g. closing an activity-coverage
// gap left by an earlier interrupted run) can ask for zero additional
// accounts/leads instead of piling on yet another random batch — each run
// draws its own fresh random sample from the combinatorial pool, so
// repeated runs are additive by design, not idempotent at a fixed target.
const NEW_ACCOUNT_COUNT = Number(process.env.SEED_NEW_ACCOUNTS ?? 90);
const NEW_LEAD_COUNT = Number(process.env.SEED_NEW_LEADS ?? 190);
const generatedNames = generateCompanyNames(
  NEW_ACCOUNT_COUNT + NEW_LEAD_COUNT,
  [...ACCOUNTS_BASE.map((a) => a.name), ...LEAD_COMPANIES_BASE],
);

const ACCOUNTS = [
  ...ACCOUNTS_BASE,
  ...generatedNames.slice(0, NEW_ACCOUNT_COUNT).map((name) => ({ name, industry: randomOf(INDUSTRIES), ...randomOf(CITY_STATE) })),
];

const LEAD_COMPANIES = [...LEAD_COMPANIES_BASE, ...generatedNames.slice(NEW_ACCOUNT_COUNT)];

const FIRST_NAMES = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Ananya", "Diya", "Saanvi", "Aadhya", "Kavya", "Myra", "Anika", "Riya", "Priya", "Neha", "Rohan", "Kabir", "Aryan", "Dhruv", "Karan", "Meera", "Pooja", "Sneha", "Tanvi", "Isha", "Yash", "Advait", "Nikhil", "Om", "Parth", "Rudra", "Shaurya", "Veer", "Zara", "Ira", "Navya", "Prisha", "Aanya", "Siya", "Trisha", "Vanya"];
const LAST_NAMES = ["Sharma", "Verma", "Iyer", "Nair", "Reddy", "Rao", "Kulkarni", "Mehta", "Gupta", "Agarwal", "Malhotra", "Bose", "Chatterjee", "Pillai", "Menon", "Desai", "Joshi", "Kapoor", "Bhatt", "Chawla", "Bhatia", "Khanna", "Trivedi", "Shetty", "Ghosh", "Mukherjee", "Saxena", "Das", "Pandey", "Thakur"];
const DESIGNATIONS = ["Chief Executive Officer", "Chief Financial Officer", "VP Operations", "Procurement Manager", "IT Director", "Head of Sales", "Finance Manager", "Operations Head", "General Manager", "Business Development Manager"];

function randomPersonName() {
  return { firstName: randomOf(FIRST_NAMES), lastName: randomOf(LAST_NAMES) };
}
function phoneNumber() {
  return `+91 ${randomInt(70000, 99999)}${randomInt(10000, 99999)}`;
}

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
  // F007's directed transition graph may be the strictly-sequential 5-stage
  // default (new -> attempting -> contacted -> working -> nurturing) rather
  // than the legacy 3-stage new/contacted/working set with a direct
  // new -> contacted edge, so this walks one hop at a time by sort_order
  // instead of assuming any stage is directly reachable from "new".
  const leadStageRows = (await admin.query(`SELECT id, code, sort_order FROM tenant.crm_lead_stages WHERE organization_id = $1 ORDER BY sort_order`, [organizationId])).rows;
  const contactedStage = leadStageRows.find((s) => s.code === "contacted");
  const workingStage = leadStageRows.find((s) => s.code === "working");
  function stagesUpTo(targetStage) {
    if (!targetStage) return [];
    return leadStageRows.filter((s) => s.code !== "new" && s.sort_order <= targetStage.sort_order);
  }

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
    const hops = roll < 0.35 ? stagesUpTo(contactedStage) : roll < 0.55 ? stagesUpTo(workingStage) : [];
    for (const stage of hops) {
      await withTx((client) => transitionLeadStage(client, context, leadRecords[i].id, { stageId: stage.id }));
    }
  }
  console.log("  moved a realistic subset of newly created leads to Contacted/Working");

  // --- Opportunities (linked to accounts) ---
  // Top up each account to a randomly chosen target opportunity count
  // (0-2, ~85% of accounts get at least one) rather than "one or none" —
  // idempotent by counting what already exists rather than a single
  // exists/skip check, so re-running only ever adds the shortfall.
  const opportunityRecords = [];
  for (const record of accountRecords) {
    const existingRows = (await admin.query(
      `SELECT id, name FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2`,
      [organizationId, record.id],
    )).rows;
    opportunityRecords.push(...existingRows);
    for (const row of existingRows) console.log(`  opportunity (already exists): ${row.name}`);

    const targetCount = Math.random() > 0.15 ? randomInt(1, 2) : 0;
    const accInfo = ACCOUNTS.find((a) => slugify(a.name) === slugify(record.displayName || ""));
    const usedTemplates = new Set();
    for (let i = existingRows.length; i < targetCount; i += 1) {
      let templateIndex = randomInt(0, OPPORTUNITY_TEMPLATES.length - 1);
      if (usedTemplates.size < OPPORTUNITY_TEMPLATES.length) {
        while (usedTemplates.has(templateIndex)) templateIndex = randomInt(0, OPPORTUNITY_TEMPLATES.length - 1);
      }
      usedTemplates.add(templateIndex);
      const label = OPPORTUNITY_TEMPLATES[templateIndex](accInfo?.name ?? record.displayName ?? "Account");
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
  }

  // --- Activities (tasks, calls, meetings, follow-ups) ---
  // Targets every lead/opportunity in the ORG with zero activities so far —
  // not just this run's local leadRecords/opportunityRecords. Each run's
  // ACCOUNTS/LEAD_COMPANIES draw an independent random sample from the
  // combinatorial pool, so a prior run's records are largely invisible to
  // this run's own arrays; scanning the whole org (and re-querying fresh
  // after this run's own creates) is what actually makes this step
  // resumable after an interrupted run, regardless of which run or process
  // created which record.
  async function idsWithoutActivities(entityType, ids) {
    if (!ids.length) return new Set();
    const rows = (await admin.query(
      `SELECT DISTINCT entity_id FROM tenant.crm_activities WHERE organization_id = $1 AND entity_type = $2 AND entity_id = ANY($3::uuid[])`,
      [organizationId, entityType, ids],
    )).rows;
    const withActivities = new Set(rows.map((r) => r.entity_id));
    return new Set(ids.filter((id) => !withActivities.has(id)));
  }
  const allLeadRows = (await admin.query(`SELECT id, first_name AS "firstName" FROM tenant.crm_leads WHERE organization_id = $1`, [organizationId])).rows;
  const allOppRows = (await admin.query(`SELECT id, name FROM tenant.crm_opportunities WHERE organization_id = $1`, [organizationId])).rows;
  const leadIdsNeedingActivities = await idsWithoutActivities("lead", allLeadRows.map((r) => r.id));
  const oppIdsNeedingActivities = await idsWithoutActivities("opportunity", allOppRows.map((r) => r.id));
  const activityTargets = [
    ...allLeadRows.filter((r) => leadIdsNeedingActivities.has(r.id)).map((r) => ({ entityType: "lead", entityId: r.id, label: r.firstName })),
    ...allOppRows.filter((r) => oppIdsNeedingActivities.has(r.id)).map((r) => ({ entityType: "opportunity", entityId: r.id, label: r.name })),
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
      // Exact millisecond arithmetic, not another daysFromNow(+1) call: two
      // separate setDate() calls can land on opposite sides of a DST
      // transition (observed: a Southern Hemisphere DST start landed one
      // pair 1 hour over), and "> 24 hours" then rejects the meeting.
      const meetingStart = new Date();
      meetingStart.setDate(meetingStart.getDate() + randomInt(1, 14));
      const meetingEnd = new Date(meetingStart.getTime() + 60 * 60 * 1000);
      await withTx((client) =>
        createCrmMeeting(client, context, {
          subject: `${randomOf(MEETING_SUBJECTS)} — ${target.label}`,
          locationType: "online",
          meetingUrl: "https://meet.vercentlabs.example/room",
          entityType: target.entityType,
          entityId: target.entityId,
          startAt: meetingStart.toISOString(),
          endAt: meetingEnd.toISOString(),
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
