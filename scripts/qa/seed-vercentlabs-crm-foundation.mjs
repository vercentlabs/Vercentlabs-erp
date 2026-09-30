#!/usr/bin/env node
// Vercentlabs CRM demo — foundation. The org had no company, no branch, no
// sales team, no pipeline and no reference data, so nothing else could be
// seeded realistically. Creates, through the app's own governed functions
// wherever one exists:
//   - the legal entity and head-office branch (createCompany/createBranch —
//     the primary branch also seeds the default master data)
//   - a 16-person commercial team with their real built-in roles
//   - two sales pipelines with stages, lead sources, won/lost reasons, tags,
//     competitors and exchange rates
//   - the sales organisation: teams, territories, members, assignments,
//     quarterly quotas and forecast periods
// Idempotent: every section checks what already exists. Local-only.
//   node scripts/qa/seed-vercentlabs-crm-foundation.mjs
import { randomBytes, randomUUID } from "node:crypto";

import {
  createBranch,
  createCompany,
  createCrmLeadSource,
  createCrmRecord,
  createSalesStage,
  ensureDefaultLeadStages,
  hashPassword,
  saveLeadAssignmentPolicy,
  setLeadAssigneeAvailability,
  setLeadAssignmentFallback,
} from "../../services/api/src/index.js";
import { permissionsForRole } from "../../packages/permissions/src/roles.js";
import { dateFromNow, log, openSeedKit } from "./crm-seed-kit.mjs";

const kit = await openSeedKit();
const { db, organizationId, withTx } = kit;
const ownerRow = await kit.owner();
if (!ownerRow) throw new Error("The organization has no owner.");
const ownerSession = {
  organizationId,
  userId: ownerRow.id,
  roleSlugs: ["organization_owner"],
  permissions: [...permissionsForRole("organization_owner")],
};

// ------------------------------------------------------------ company/branch
let { companyId, branchId } = await kit.company();
if (!companyId) {
  const company = await withTx((client) =>
    createCompany(client, ownerSession, {
      name: "Vercentlabs Technologies",
      legalName: "Vercentlabs Technologies Private Limited",
      code: "VLT",
      countryCode: "IN",
      baseCurrency: "INR",
      taxId: "27AAKCV4821M1Z6",
      isPrimary: true,
    }),
  );
  companyId = company.id;
  log(`company: ${company.name}`);
}
if (!branchId) {
  const branch = await withTx((client) =>
    createBranch(client, ownerSession, {
      companyId,
      name: "Pune Head Office",
      code: "PUN-HO",
      timezone: "Asia/Kolkata",
      isPrimary: true,
    }),
  );
  branchId = branch.id;
  log(`branch: ${branch.name}`);
}
for (const [table, column, value] of [
  ["membership_company_access", "company_id", companyId],
  ["membership_branch_access", "branch_id", branchId],
])
  await db.query(
    `INSERT INTO ${table}(organization_id,user_id,${column}) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [organizationId, ownerRow.id, value],
  );

// ---------------------------------------------------------------------- team
// Real people shapes: a sales head, three regional managers, eight sellers,
// operations, marketing, customer success, partnerships and a CRM admin.
export const TEAM = [
  { key: "head", name: "Rahul Deshpande", role: "sales_head", title: "VP, Sales" },
  { key: "west-mgr", name: "Sneha Iyer", role: "sales_manager", title: "Regional Sales Manager, West" },
  { key: "south-mgr", name: "Arvind Menon", role: "sales_manager", title: "Regional Sales Manager, South" },
  { key: "north-mgr", name: "Kunal Malhotra", role: "sales_manager", title: "Regional Sales Manager, North" },
  { key: "priya", name: "Priya Kulkarni", role: "sales_representative", title: "Account Executive" },
  { key: "rohan", name: "Rohan Joshi", role: "sales_representative", title: "Account Executive" },
  { key: "meera", name: "Meera Shah", role: "sales_representative", title: "Senior Account Executive" },
  { key: "ananya", name: "Ananya Reddy", role: "sales_representative", title: "Account Executive" },
  { key: "vikram", name: "Vikram Nair", role: "sales_representative", title: "Senior Account Executive" },
  { key: "karthik", name: "Karthik Raman", role: "sales_representative", title: "Account Executive" },
  { key: "ishita", name: "Ishita Kapoor", role: "sales_representative", title: "Account Executive" },
  { key: "aditya", name: "Aditya Saxena", role: "sales_representative", title: "Senior Account Executive" },
  { key: "ops", name: "Neha Bhatia", role: "sales_operations", title: "Sales Operations Lead" },
  { key: "marketing", name: "Farhan Qureshi", role: "marketing_manager", title: "Demand Generation Manager" },
  { key: "success", name: "Divya Pillai", role: "customer_success_manager", title: "Customer Success Manager" },
  { key: "partners", name: "Sameer Gupta", role: "partner_manager", title: "Partner Manager" },
  { key: "admin", name: "Anjali Verma", role: "crm_administrator", title: "CRM Administrator" },
];

const roleIds = Object.fromEntries(
  (await db.query(`SELECT slug, id FROM roles WHERE organization_id=$1`, [organizationId])).rows.map((row) => [row.slug, row.id]),
);
const people = {};
for (const person of TEAM) {
  const email = `${person.name.toLowerCase().replace(/\s+/g, ".")}@vercentlabs.com`;
  let user = (await db.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [email])).rows[0];
  if (!user) {
    const id = randomUUID();
    // A random password nobody knows: these are demo colleagues, not logins.
    // Use scripts/qa/set-qa-password.mjs to sign in as one of them.
    await db.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`,
      [id, email, person.name, await hashPassword(randomBytes(24).toString("base64url"))],
    );
    user = { id };
    log(`member: ${person.name} (${person.role})`);
  }
  await db.query(
    `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active') ON CONFLICT DO NOTHING`,
    [organizationId, user.id],
  );
  if (!roleIds[person.role]) throw new Error(`Role ${person.role} is not provisioned in this organization.`);
  const hasRole = (await db.query(
    `SELECT 1 FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2 AND role_id=$3 AND status='active'`,
    [organizationId, user.id, roleIds[person.role]],
  )).rows[0];
  if (!hasRole)
    await db.query(
      `INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now() - interval '400 days')`,
      [organizationId, user.id, roleIds[person.role]],
    );
  for (const [table, column, value] of [
    ["membership_company_access", "company_id", companyId],
    ["membership_branch_access", "branch_id", branchId],
  ])
    await db.query(`INSERT INTO ${table}(organization_id,user_id,${column}) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [organizationId, user.id, value]);
  people[person.key] = user.id;
}

const owner = await kit.contextFor(ownerRow.id);

// --------------------------------------------------------- lead stages
await withTx((client) => ensureDefaultLeadStages(client, owner));

// --------------------------------------------------------------- pipelines
async function pipeline(name, code, isDefault, stages) {
  let row = (await db.query(`SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND code=$2`, [organizationId, code])).rows[0];
  if (!row) {
    row = await withTx((client) => createCrmRecord(client, owner, "pipelines", { companyId, name, code, isDefault, status: "active", description: null }));
    log(`pipeline: ${name}`);
  }
  const existing = new Set((await db.query(`SELECT name FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2`, [organizationId, row.id])).rows.map((stage) => stage.name));
  for (const stage of stages)
    if (!existing.has(stage.name)) await withTx((client) => createSalesStage(client, owner, { pipelineId: row.id, ...stage }));
  return row.id;
}
await pipeline("New Business", "NEW-BUSINESS", true, [
  { name: "Qualification", stageType: "open", probability: 10, forecastCategory: "pipeline", staleAfterDays: 14 },
  { name: "Needs Analysis", stageType: "open", probability: 25, forecastCategory: "pipeline", staleAfterDays: 21 },
  { name: "Solution Demo", stageType: "open", probability: 40, forecastCategory: "best_case", staleAfterDays: 21 },
  { name: "Proposal", stageType: "open", probability: 60, forecastCategory: "best_case", staleAfterDays: 21 },
  { name: "Negotiation", stageType: "open", probability: 80, forecastCategory: "committed", staleAfterDays: 14 },
  { name: "Closed Won", stageType: "won" },
  { name: "Closed Lost", stageType: "lost" },
]);
await pipeline("Renewals & Expansion", "RENEWALS", false, [
  { name: "Renewal Due", stageType: "open", probability: 50, forecastCategory: "best_case", staleAfterDays: 30 },
  { name: "Commercial Review", stageType: "open", probability: 70, forecastCategory: "best_case", staleAfterDays: 21 },
  { name: "Contract Sent", stageType: "open", probability: 90, forecastCategory: "committed", staleAfterDays: 14 },
  { name: "Renewed", stageType: "won" },
  { name: "Churned", stageType: "lost" },
]);

// ----------------------------------------------------------- lead sources
const SOURCES = [
  ["Website enquiry", "website", "Contact-us and pricing-page forms on vercentlabs.com.", true],
  ["Customer referral", "referral", "Introductions from existing customers.", false],
  ["Channel partner", "partner", "Leads registered by implementation partners.", false],
  ["Trade show", "event", "Stalls at industry expos (IMTEX, India Warehousing Show, Aahar).", false],
  ["Google Ads", "advertising", "Search campaigns for ERP and CRM keywords.", false],
  ["LinkedIn", "social", "Sponsored content and InMail replies.", false],
  ["Email campaign", "email", "Nurture and product-launch newsletters.", false],
  ["Inbound call", "phone", "Calls to the sales line.", false],
  ["Webinar", "event", "Monthly product webinars.", false],
  ["IndiaMART", "other", "Buy-leads from the IndiaMART marketplace.", false],
];
const knownSources = new Set((await db.query(`SELECT lower(name) AS name FROM tenant.crm_lead_sources WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.name));
for (const [name, channel, description, isDefault] of SOURCES)
  if (!knownSources.has(name.toLowerCase()))
    await withTx((client) => createCrmLeadSource(client, owner, { name, channel, description, isDefault }));

// ------------------------------------------------------ won / lost reasons
const REASONS = [
  ["Price too high", "price", "lost"],
  ["Chose a competitor", "competition", "lost"],
  ["No budget this year", "budget", "lost"],
  ["Project postponed", "timing", "lost"],
  ["Missing functionality", "fit", "lost"],
  ["Went silent", "no_response", "lost"],
  ["Duplicate opportunity", "duplicate", "lost"],
  ["Best fit for requirements", "fit", "won"],
  ["Faster implementation timeline", "timing", "won"],
  ["Competitive pricing", "price", "won"],
  ["Existing relationship", "other", "won"],
  ["Stronger local support", "competition", "won"],
];
const knownReasons = new Set((await db.query(`SELECT lower(name) AS name FROM tenant.crm_lost_reasons WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.name));
let sequence = 10;
for (const [name, category, outcomeType] of REASONS) {
  sequence += 10;
  if (!knownReasons.has(name.toLowerCase()))
    await withTx((client) => createCrmRecord(client, owner, "lost-reasons", { name, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40), category, outcomeType, sequence, status: "active" }));
}

// --------------------------------------------------------------- tags
const TAGS = [
  ["Strategic account", "#4F46E5"], ["Hot prospect", "#DC2626"], ["Referral", "#059669"], ["Budget approved", "#0891B2"],
  ["Multi-branch", "#7C3AED"], ["GST compliance", "#CA8A04"], ["Needs demo", "#EA580C"], ["Upsell", "#16A34A"],
  ["Government", "#475569"], ["Renewal risk", "#B91C1C"],
];
const knownTags = new Set((await db.query(`SELECT lower(name) AS name FROM tenant.crm_tags WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.name));
for (const [name, color] of TAGS)
  if (!knownTags.has(name.toLowerCase())) await withTx((client) => createCrmRecord(client, owner, "tags", { name, color, status: "active" }));

// --------------------------------------------------------- competitors
const COMPETITORS = [
  ["Zoho CRM", "https://www.zoho.com/crm", "Low price, broad suite", "Customisation limits at scale"],
  ["Salesforce Sales Cloud", "https://www.salesforce.com", "Ecosystem, brand", "Cost and implementation effort"],
  ["Odoo", "https://www.odoo.com", "Open source, modular", "Partner-dependent quality"],
  ["SAP Business One", "https://www.sap.com", "ERP depth", "Heavy for mid-market sales teams"],
  ["Tally Prime", "https://tallysolutions.com", "Accounting familiarity in India", "No CRM or pipeline"],
  ["Microsoft Dynamics 365", "https://dynamics.microsoft.com", "Office 365 integration", "Licensing complexity"],
  ["LeadSquared", "https://www.leadsquared.com", "Lead capture, field sales", "Limited ERP integration"],
  ["Freshsales", "https://www.freshworks.com/crm", "Ease of use", "Thin reporting"],
];
const knownCompetitors = new Set((await db.query(`SELECT lower(name) AS name FROM tenant.crm_competitors WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.name));
for (const [name, website, strengths, weaknesses] of COMPETITORS)
  if (!knownCompetitors.has(name.toLowerCase()))
    await withTx((client) => createCrmRecord(client, owner, "competitors", { name, website, strengths, weaknesses, status: "active" }));

// -------------------------------------------------------- exchange rates
// Monthly reference rates for the currencies overseas customers pay in.
const RATES = { USD: 83.2, EUR: 90.4, GBP: 105.6, AED: 22.65, SGD: 61.8 };
for (let month = 0; month < 15; month += 1) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - month);
  const rateDate = date.toISOString().slice(0, 10);
  for (const [code, base] of Object.entries(RATES)) {
    const drift = 1 + Math.sin(month * 1.7 + code.charCodeAt(0)) * 0.012;
    await db.query(
      `INSERT INTO tenant.exchange_rates(organization_id,company_id,from_currency_code,to_currency_code,rate_date,rate,source,status,created_by,updated_by)
       SELECT $1,$2,$3,'INR',$4,$5,'RBI reference rate','active',$6,$6
        WHERE NOT EXISTS (SELECT 1 FROM tenant.exchange_rates WHERE organization_id=$1 AND from_currency_code=$3 AND to_currency_code='INR' AND rate_date=$4)`,
      [organizationId, companyId, code, rateDate, (base * drift).toFixed(4), ownerRow.id],
    );
  }
}

// ------------------------------------------------ sales organisation
async function team(code, name, managerKey, parentTeamId = null) {
  const existing = (await db.query(`SELECT id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND code=$2`, [organizationId, code])).rows[0];
  if (existing) return existing.id;
  const row = await withTx((client) =>
    createCrmRecord(client, owner, "sales-teams", { companyId, parentTeamId, code, name, managerUserId: people[managerKey], currencyCode: "INR", status: "active" }),
  );
  log(`team: ${name}`);
  return row.id;
}
const india = await team("IN-SALES", "India Sales", "head");
const regions = {
  west: { team: await team("IN-WEST", "West Region", "west-mgr", india), manager: "west-mgr", sellers: ["priya", "rohan", "meera"], states: ["Maharashtra", "Gujarat", "Goa", "Madhya Pradesh"] },
  south: { team: await team("IN-SOUTH", "South Region", "south-mgr", india), manager: "south-mgr", sellers: ["ananya", "vikram", "karthik"], states: ["Karnataka", "Tamil Nadu", "Telangana", "Kerala", "Andhra Pradesh"] },
  north: { team: await team("IN-NORTH", "North Region", "north-mgr", india), manager: "north-mgr", sellers: ["ishita", "aditya"], states: ["Delhi", "Haryana", "Uttar Pradesh", "Rajasthan", "Punjab", "Chandigarh"] },
};
async function member(teamId, key, memberRole, allocationPercent = 100) {
  const exists = (await db.query(`SELECT 1 FROM tenant.crm_sales_team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3`, [organizationId, teamId, people[key]])).rows[0];
  if (!exists)
    await withTx((client) =>
      createCrmRecord(client, owner, "sales-team-members", { companyId, teamId, userId: people[key], memberRole, allocationPercent, effectiveFrom: dateFromNow(-420), status: "active" }),
    );
}
await member(india, "head", "manager");
await member(india, "ops", "sales_ops");
for (const region of Object.values(regions)) {
  await member(region.team, region.manager, "manager");
  for (const seller of region.sellers) await member(region.team, seller, "seller");
}
await member(regions.west.team, "partners", "overlay", 50);
await member(regions.south.team, "success", "observer", 50);

async function territory(code, name, territoryType, parentTerritoryId, managerKey) {
  const existing = (await db.query(`SELECT id FROM tenant.crm_territories WHERE organization_id=$1 AND code=$2`, [organizationId, code])).rows[0];
  if (existing) return existing.id;
  const row = await withTx((client) =>
    createCrmRecord(client, owner, "territories", { companyId, parentTerritoryId, code, name, territoryType, managerUserId: managerKey ? people[managerKey] : null, status: "active" }),
  );
  log(`territory: ${name}`);
  return row.id;
}
async function assign(territoryId, assigneeType, assigneeId, assignmentRole) {
  const exists = (await db.query(
    `SELECT 1 FROM tenant.crm_territory_assignments WHERE organization_id=$1 AND territory_id=$2 AND assignee_id=$3 AND assignment_role=$4`,
    [organizationId, territoryId, assigneeId, assignmentRole],
  )).rows[0];
  if (!exists)
    await withTx((client) =>
      createCrmRecord(client, owner, "territory-assignments", { companyId, territoryId, assigneeType, assigneeId, assignmentRole, effectiveFrom: dateFromNow(-420), source: "manual" }),
    );
}
const indiaTerritory = await territory("T-IN", "India", "geographic", null, "head");
await assign(indiaTerritory, "team", india, "primary");
const STATE_CODES = { Maharashtra: "MH", Gujarat: "GJ", Goa: "GA", "Madhya Pradesh": "MP", Karnataka: "KA", "Tamil Nadu": "TN", Telangana: "TG", Kerala: "KL", "Andhra Pradesh": "AP", Delhi: "DL", Haryana: "HR", "Uttar Pradesh": "UP", Rajasthan: "RJ", Punjab: "PB", Chandigarh: "CH" };
for (const [key, region] of Object.entries(regions)) {
  const regionTerritory = await territory(`T-${key.toUpperCase()}`, `${key[0].toUpperCase()}${key.slice(1)} India`, "geographic", indiaTerritory, region.manager);
  await assign(regionTerritory, "team", region.team, "primary");
  await assign(regionTerritory, "user", people[region.manager], "manager");
  for (const [index, state] of region.states.entries()) {
    const stateTerritory = await territory(`T-${STATE_CODES[state]}`, state, "geographic", regionTerritory, region.manager);
    // Goa and Chandigarh are deliberately left without a primary seller:
    // real coverage gaps for the Sales Coverage screen to surface.
    if (state === "Goa" || state === "Chandigarh") continue;
    await assign(stateTerritory, "user", people[region.sellers[index % region.sellers.length]], "primary");
  }
}
const enterprise = await territory("T-ENT", "Enterprise Named Accounts", "named", indiaTerritory, "head");
await assign(enterprise, "user", people.meera, "primary");
await assign(enterprise, "user", people.vikram, "overlay");
const bfsi = await territory("T-BFSI", "BFSI Vertical", "industry", indiaTerritory, "north-mgr");
await assign(bfsi, "user", people.aditya, "primary");

// ------------------------------------------------ quarters, periods, quotas
function quarter(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + offset * 3, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
  const fy = start.getMonth() >= 3 ? start.getFullYear() + 1 : start.getFullYear();
  const q = Math.floor(((start.getMonth() + 9) % 12) / 3) + 1;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end), label: `Q${q} FY${String(fy).slice(2)}` };
}
const quarters = [-3, -2, -1, 0, 1].map(quarter);
for (const [index, q] of quarters.entries()) {
  const name = `${q.label} (${q.start.slice(0, 7)} to ${q.end.slice(0, 7)})`;
  const exists = (await db.query(`SELECT 1 FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND period_start=$2 AND period_type='quarter'`, [organizationId, q.start])).rows[0];
  if (!exists)
    await withTx((client) =>
      createCrmRecord(client, owner, "forecast-periods", {
        companyId,
        name,
        periodType: "quarter",
        periodStart: q.start,
        periodEnd: q.end,
        currencyCode: "INR",
        status: index === 4 ? "planned" : "open",
      }),
    );
}
// Quotas: sellers carry a quarterly bookings number; managers carry the team's.
const SELLER_QUOTA = { priya: 42, rohan: 36, meera: 60, ananya: 40, vikram: 55, karthik: 34, ishita: 38, aditya: 52 };
for (const q of quarters.slice(0, 4)) {
  for (const [key, lakhs] of Object.entries(SELLER_QUOTA)) {
    const exists = (await db.query(`SELECT 1 FROM tenant.crm_quota_plans WHERE organization_id=$1 AND user_id=$2 AND period_start=$3`, [organizationId, people[key], q.start])).rows[0];
    if (!exists)
      await withTx((client) =>
        createCrmRecord(client, owner, "quota-plans", {
          companyId,
          userId: people[key],
          name: `${q.label} bookings — ${TEAM.find((p) => p.key === key).name}`,
          quotaType: "bookings",
          periodStart: q.start,
          periodEnd: q.end,
          currencyCode: "INR",
          targetAmount: lakhs * 100000,
          stretchAmount: Math.round(lakhs * 1.2) * 100000,
          status: "active",
        }),
      );
  }
  for (const [regionKey, region] of Object.entries(regions)) {
    const exists = (await db.query(`SELECT 1 FROM tenant.crm_quota_plans WHERE organization_id=$1 AND team_id=$2 AND period_start=$3`, [organizationId, region.team, q.start])).rows[0];
    const lakhs = region.sellers.reduce((sum, key) => sum + SELLER_QUOTA[key], 0);
    if (!exists)
      await withTx((client) =>
        createCrmRecord(client, owner, "quota-plans", {
          companyId,
          teamId: region.team,
          name: `${q.label} bookings — ${regionKey[0].toUpperCase()}${regionKey.slice(1)} Region`,
          quotaType: "bookings",
          periodStart: q.start,
          periodEnd: q.end,
          currencyCode: "INR",
          targetAmount: lakhs * 100000,
          status: "active",
        }),
      );
  }
}

// ------------------------------------------------------ lead assignment
const sourceIds = Object.fromEntries((await db.query(`SELECT name, id FROM tenant.crm_lead_sources WHERE organization_id=$1`, [organizationId])).rows.map((row) => [row.name, row.id]));
const northTerritory = (await db.query(`SELECT id FROM tenant.crm_territories WHERE organization_id=$1 AND code='T-NORTH'`, [organizationId])).rows[0];
const POLICIES = [
  { name: "Hot leads — Enterprise desk (Meera Shah)", sequence: 10, mode: "fixed", assigneeUserId: people.meera, criteria: { leadGrade: "hot" } },
  { name: "Website enquiries — West round robin", sequence: 20, mode: "round_robin", memberUserIds: [people.priya, people.rohan, people.meera], criteria: { sourceId: sourceIds["Website enquiry"] } },
  { name: "Trade show leads — South round robin", sequence: 30, mode: "round_robin", memberUserIds: [people.ananya, people.vikram, people.karthik], criteria: { sourceId: sourceIds["Trade show"] } },
  ...(northTerritory ? [{ name: "North India — territory routing", sequence: 40, mode: "territory", territoryId: northTerritory.id, criteria: { countryCode: "IN" } }] : []),
  { name: "Everything else — workload balanced", sequence: 90, mode: "workload", memberUserIds: [people.priya, people.rohan, people.meera, people.ananya, people.vikram, people.karthik, people.ishita, people.aditya], criteria: {} },
];
const knownPolicies = new Set((await db.query(`SELECT name FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.name));
for (const policy of POLICIES) if (!knownPolicies.has(policy.name)) await withTx((client) => saveLeadAssignmentPolicy(client, owner, policy));
const fallback = (await db.query(`SELECT fallback_user_id FROM tenant.crm_lead_assignment_fallback WHERE organization_id=$1`, [organizationId])).rows[0];
if (!fallback?.fallback_user_id) await withTx((client) => setLeadAssignmentFallback(client, owner, people.head));
const leave = (await db.query(`SELECT 1 FROM tenant.crm_lead_assignee_availability WHERE organization_id=$1 AND user_id=$2 AND ends_at>now()`, [organizationId, people.karthik])).rows[0];
if (!leave)
  await withTx((client) =>
    setLeadAssigneeAvailability(client, owner, {
      userId: people.karthik,
      startsAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      endsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      reason: "Annual leave — family function in Madurai",
    }),
  );

log(`Foundation ready for ${organizationId}: ${Object.keys(people).length} team members.`);
await kit.close();
