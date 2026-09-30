#!/usr/bin/env node
// Vercentlabs CRM demo — lifecycle. Runs after the foundation and the base
// demo seed (accounts, contacts, leads, opportunities, activities all owned by
// the org owner and all created "today"). Turns that into a believable
// 14-month history through the governed domain functions:
//   - ownership by territory: each lead/account/opportunity goes to the
//     seller covering its state (a few leads stay unassigned for the queue)
//   - lead qualification decisions and lead conversions
//   - opportunities walked stage by stage; won/lost with real reasons
//   - buying roles, competitors and deal teams on opportunities
//   - activities reassigned to the record owner, many completed with outcomes
//   - forecast submissions and manager reviews, a closed quarter with
//     snapshots (so accuracy has history) and a current-quarter snapshot
// Only timestamps are backdated with SQL (the services stamp "now"); every
// state change goes through the service that owns it. Idempotent.
import { trainPredictiveLeadScoringModel } from "../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/predictive-model.js";
import {
  addOpportunityCompetitor,
  addOpportunityContactRole,
  addOpportunityTeamMember,
  assignLeadOwner,
  captureForecastPeriodSnapshot,
  completeCrmCall,
  completeCrmFollowUp,
  completeCrmMeeting,
  completeCrmTask,
  convertCrmLead,
  createLeadScoringModel,
  decideLeadQualification,
  moveOpportunityStage,
  reviewForecast,
  setForecastPeriodStatus,
  startCrmTask,
  submitForecast,
  transitionLeadStage,
  updateCrmRecord,
} from "../../services/api/src/index.js";
import { between, chance, log, openSeedKit, pick, random, weighted } from "./crm-seed-kit.mjs";

const kit = await openSeedKit();
const { db, organizationId, withTx } = kit;
const q = async (sql, params = []) => (await db.query(sql, [organizationId, ...params])).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const ownerRow = await kit.owner();
const owner = await kit.contextFor(ownerRow.id);
const failures = [];
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (error) {
    failures.push(`${label}: ${error.code ?? ""} ${error.message}`);
    return null;
  }
}

// ------------------------------------------------------------ the people
const person = async (name) => (await one(`SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.full_name=$2`, [name]))?.id;
const REGION_SELLERS = {
  west: ["Priya Kulkarni", "Rohan Joshi", "Meera Shah"],
  south: ["Ananya Reddy", "Vikram Nair", "Karthik Raman"],
  north: ["Ishita Kapoor", "Aditya Saxena"],
};
const REGION_MANAGER = { west: "Sneha Iyer", south: "Arvind Menon", north: "Kunal Malhotra" };
const STATE_REGION = {
  Maharashtra: "west", Gujarat: "west", Goa: "west", "Madhya Pradesh": "west",
  Karnataka: "south", "Tamil Nadu": "south", Telangana: "south", Kerala: "south", "Andhra Pradesh": "south",
  Delhi: "north", Haryana: "north", "Uttar Pradesh": "north", Rajasthan: "north", Punjab: "north", Chandigarh: "north",
};
const CITY_REGION = {
  Mumbai: "west", Pune: "west", Nashik: "west", Nagpur: "west", Ahmedabad: "west", Surat: "west", Vadodara: "west", Indore: "west", Bhopal: "west",
  Bengaluru: "south", Chennai: "south", Hyderabad: "south", Kochi: "south", Coimbatore: "south", Visakhapatnam: "south", Kolkata: "south",
  Delhi: "north", Gurugram: "north", Jaipur: "north", Lucknow: "north", Chandigarh: "north",
};
const ids = {};
for (const name of [...Object.values(REGION_SELLERS).flat(), ...Object.values(REGION_MANAGER), "Rahul Deshpande", "Neha Bhatia", "Divya Pillai", "Sameer Gupta"]) ids[name] = await person(name);
if (!ids["Priya Kulkarni"]) throw new Error("Run seed-vercentlabs-crm-foundation.mjs first.");
const contexts = {};
const ctx = async (userId) => (contexts[userId] ??= await kit.contextFor(userId));
const cursor = { west: 0, south: 0, north: 0 };
function sellerFor(region) {
  const list = REGION_SELLERS[region ?? pick(["west", "south", "north"])];
  // Senior AEs carry a heavier book.
  const name = chance(0.35) ? list.find((n) => ["Meera Shah", "Vikram Nair", "Aditya Saxena"].includes(n)) ?? list[0] : list[cursor[region] = ((cursor[region] ?? 0) + 1) % list.length];
  return ids[name];
}
const regionOfState = (state) => STATE_REGION[state] ?? null;

// --------------------------------------------- account & opportunity owners
const accounts = await q(
  `SELECT p.id, p.owner_user_id, a.state FROM tenant.business_parties p
     LEFT JOIN LATERAL (SELECT state FROM tenant.addresses ad WHERE ad.organization_id=p.organization_id AND ad.party_id=p.id ORDER BY ad.is_primary DESC LIMIT 1) a ON true
    WHERE p.organization_id=$1 AND p.party_type='customer'`,
);
const accountOwner = new Map();
for (const account of accounts) {
  let ownerId = account.owner_user_id;
  if (!ownerId || ownerId === ownerRow.id) {
    ownerId = sellerFor(regionOfState(account.state));
    await db.query(`UPDATE tenant.business_parties SET owner_user_id=$3 WHERE organization_id=$1 AND id=$2`, [organizationId, account.id, ownerId]);
  }
  accountOwner.set(account.id, ownerId);
}
log(`accounts owned by territory sellers: ${accounts.length}`);

// Leads: governed assignment, by city/state region; ~7% stay unassigned.
const leads = await q(`SELECT id, city, owner_user_id FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' ORDER BY created_at`);
let assigned = 0;
for (const lead of leads) {
  if (lead.owner_user_id && lead.owner_user_id !== ownerRow.id) continue;
  if (chance(0.07)) continue;
  const target = sellerFor(CITY_REGION[lead.city] ?? null);
  const ok = await attempt(`assign lead ${lead.id}`, () =>
    withTx((client) => assignLeadOwner(client, owner, lead.id, target, { reason: pick(["Territory routing", "Round-robin within region", "Account owner match", "Rebalanced workload"]) })),
  );
  if (ok) assigned += 1;
}
log(`leads assigned: ${assigned}`);

// ------------------------------------------------------- 14 months of age
// The base seed created everything today; spread creation across the last
// 14 months (older records are more likely closed/converted below).
await db.query(
  `UPDATE tenant.business_parties SET created_at = now() - (random()*420 + 30) * interval '1 day' WHERE organization_id=$1 AND created_at > now() - interval '2 days'`,
  [organizationId],
);
await db.query(
  `UPDATE tenant.contacts c SET created_at = GREATEST(p.created_at, now() - (random()*400 + 10) * interval '1 day')
     FROM tenant.business_parties p WHERE c.organization_id=$1 AND p.organization_id=c.organization_id AND p.id=c.party_id AND c.created_at > now() - interval '2 days'`,
  [organizationId],
);
await db.query(
  `UPDATE tenant.crm_leads SET created_at = now() - (power(random(),1.6)*420) * interval '1 day' WHERE organization_id=$1 AND created_at > now() - interval '2 days'`,
  [organizationId],
);

// ------------------------------------------------------- lead lifecycle
const leadStages = await q(`SELECT id, code, sort_order FROM tenant.crm_lead_stages WHERE organization_id=$1 AND status='active' ORDER BY sort_order`);
const openLeads = await q(
  `SELECT l.id, l.owner_user_id, l.status, l.qualification_state, l.created_at, l.company_name, l.first_name, l.last_name
     FROM tenant.crm_leads l WHERE l.organization_id=$1 AND l.record_status='active' ORDER BY l.created_at`,
);
let qualified = 0;
let unqualified = 0;
let moved = 0;
for (const lead of openLeads) {
  const actor = lead.owner_user_id ? await ctx(lead.owner_user_id) : owner;
  const ageDays = (Date.now() - new Date(lead.created_at).getTime()) / 86400000;
  // Older leads have progressed further through the lifecycle.
  const targetIndex = Math.min(leadStages.length - 1, Math.floor(weighted([[0, 3], [1, 3], [2, 3], [3, 2], [4, 1]]) + (ageDays > 120 ? 1 : 0)));
  const current = leadStages.findIndex((stage) => stage.code === lead.status);
  for (let index = current + 1; index <= targetIndex; index += 1) {
    const ok = await attempt(`lead stage ${lead.id}`, () =>
      withTx((client) => transitionLeadStage(client, actor, lead.id, { stageId: leadStages[index].id, note: pick(["Spoke with the decision maker.", "Requirements captured on call.", "Shared the product brochure.", "Awaiting internal budget discussion.", null]) ?? undefined })),
    );
    if (!ok) break;
    moved += 1;
  }
  if (lead.qualification_state !== "not_reviewed") continue;
  const roll = random();
  if (roll < 0.34 && ageDays > 20) {
    const ok = await attempt(`qualify ${lead.id}`, () =>
      withTx((client) => decideLeadQualification(client, actor, lead.id, { decision: "qualified", note: pick(["Budget confirmed for this financial year.", "Clear need: replacing spreadsheets across 3 branches.", "Decision maker engaged; wants a demo next week.", "Timeline Q-end, sponsor is the CFO."]) }))
        .catch(() => withTx((client) => decideLeadQualification(client, actor, lead.id, { decision: "qualified", overrideUsed: true, overrideReason: "Qualified on the discovery call ahead of the next scoring run.", note: "Strong fit confirmed by the regional manager." }))),
    );
    if (ok) qualified += 1;
  } else if (roll < 0.47 && ageDays > 15) {
    const reasonCode = pick(["no_current_requirement", "not_a_fit", "unable_to_reach", "budget_unavailable", "invalid_enquiry"]);
    const ok = await attempt(`unqualify ${lead.id}`, () =>
      withTx((client) => decideLeadQualification(client, actor, lead.id, { decision: "unqualified", reasonCode, note: { no_current_requirement: "Renewed their current system for two more years.", not_a_fit: "Single-user shop; needs a billing app, not an ERP.", unable_to_reach: "Five attempts over three weeks, no response.", budget_unavailable: "Capex frozen until next financial year.", invalid_enquiry: "Student project enquiry." }[reasonCode] })),
    );
    if (ok) unqualified += 1;
  }
}
log(`lead stage moves: ${moved}, qualified: ${qualified}, unqualified: ${unqualified}`);

// Conversions: qualified leads become Account + Contact + Opportunity.
const toConvert = await q(
  `SELECT id, owner_user_id, company_name FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' AND qualification_state='qualified' AND owner_user_id IS NOT NULL ORDER BY created_at LIMIT 90`,
);
let converted = 0;
for (const lead of toConvert) {
  if (!chance(0.8)) continue;
  const actor = await ctx(lead.owner_user_id);
  const result = await attempt(`convert ${lead.id}`, () =>
    withTx((client) =>
      convertCrmLead(client, actor, lead.id, {
        createOpportunity: true,
        opportunityName: `${lead.company_name} — ${pick(["ERP Implementation", "Sales & CRM Rollout", "Inventory and Warehouse Module", "Finance and GST Compliance Suite", "Multi-branch Deployment"])}`,
        amount: between(18, 420) * 10000,
        currencyCode: "INR",
        expectedCloseDate: new Date(Date.now() + between(20, 150) * 86400000).toISOString().slice(0, 10),
        nextStep: pick(["Solution demo with the finance team", "Share implementation plan", "Site visit to the main plant", "Commercial proposal"]),
      }),
    ),
  );
  if (result) converted += 1;
}
await db.query(
  `UPDATE tenant.crm_leads SET converted_at = GREATEST(created_at + interval '10 days', now() - (random()*330) * interval '1 day') WHERE organization_id=$1 AND record_status='converted' AND converted_at > now() - interval '2 days'`,
  [organizationId],
);
log(`leads converted: ${converted}`);

// --------------------------------------------------------- opportunities
const pipelines = await q(`SELECT id, code FROM tenant.crm_pipelines WHERE organization_id=$1`);
const stagesByPipeline = new Map();
for (const pipeline of pipelines)
  stagesByPipeline.set(pipeline.id, await q(`SELECT id, name, is_won, is_lost, sequence FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND status='active' ORDER BY sequence`, [pipeline.id]));
const wonReasons = await q(`SELECT id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND outcome_type IN ('won','both') AND status='active'`);
const lostReasons = await q(`SELECT id, name FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND outcome_type IN ('lost','both') AND status='active'`);
const competitors = await q(`SELECT id, name FROM tenant.crm_competitors WHERE organization_id=$1`);

// Opportunities belong to the account's owner.
const opps = await q(
  `SELECT id, party_id, owner_user_id, pipeline_id, stage_id, status, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 ORDER BY created_at`,
);
for (const opp of opps) {
  const target = accountOwner.get(opp.party_id) ?? sellerFor(null);
  if (opp.owner_user_id === target) continue;
  await attempt(`opp owner ${opp.id}`, () =>
    withTx((client) => updateCrmRecord(client, owner, "opportunities", opp.id, { ownerUserId: target }, { expectedUpdatedAt: opp.updated_at.toISOString() })),
  );
}
await db.query(
  `UPDATE tenant.crm_opportunities o SET created_at = GREATEST(p.created_at + interval '3 days', now() - (power(random(),1.3)*400 + 5) * interval '1 day')
     FROM tenant.business_parties p WHERE o.organization_id=$1 AND p.organization_id=o.organization_id AND p.id=o.party_id AND o.created_at > now() - interval '2 days'`,
  [organizationId],
);

const fresh = await q(`SELECT id, owner_user_id, pipeline_id, stage_id, status, created_at, updated_at, party_id FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open' ORDER BY created_at`);
let won = 0;
let lost = 0;
let stageMoves = 0;
for (const opp of fresh) {
  const stages = stagesByPipeline.get(opp.pipeline_id) ?? [];
  const openStages = stages.filter((stage) => !stage.is_won && !stage.is_lost);
  const ageDays = (Date.now() - new Date(opp.created_at).getTime()) / 86400000;
  // Older deals are more likely to be closed; recent ones are early-stage.
  const closeChance = Math.min(0.75, ageDays / 420);
  const outcome = chance(closeChance) ? (chance(0.46) ? "won" : "lost") : "open";
  const targetOpen = outcome === "open" ? Math.min(openStages.length - 1, weighted([[0, 5], [1, 4], [2, 3], [3, 3], [4, 2]])) : openStages.length - (chance(0.5) ? 1 : 2);
  const actor = opp.owner_user_id ? await ctx(opp.owner_user_id) : owner;
  let row = await one(`SELECT id, stage_id, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`, [opp.id]);
  let index = openStages.findIndex((stage) => stage.id === row.stage_id);
  for (let next = index + 1; next <= targetOpen; next += 1) {
    const done = await attempt(`stage ${opp.id}`, () =>
      withTx((client) => moveOpportunityStage(client, actor, opp.id, openStages[next].id, null, { expectedUpdatedAt: row.updated_at.toISOString(), expectedStageId: row.stage_id })),
    );
    if (!done) break;
    stageMoves += 1;
    row = await one(`SELECT id, stage_id, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`, [opp.id]);
  }
  if (outcome === "open") continue;
  const terminal = stages.find((stage) => (outcome === "won" ? stage.is_won : stage.is_lost));
  const reason = outcome === "won" ? pick(wonReasons) : pick(lostReasons);
  const note = outcome === "won"
    ? pick(["PO received; kickoff scheduled for next month.", "Signed after the final commercial round.", "Board approved the three-year agreement.", "Won against two shortlisted vendors."])
    : pick(["Went with a cheaper local vendor.", "Customer postponed the project to next year.", "Could not match the required integrations.", "No response after the proposal despite follow-ups."]);
  const closed = await attempt(`close ${opp.id}`, () =>
    withTx((client) => moveOpportunityStage(client, actor, opp.id, terminal.id, note, { expectedUpdatedAt: row.updated_at.toISOString(), expectedStageId: row.stage_id, outcomeReasonId: reason?.id })),
  );
  if (!closed) continue;
  if (outcome === "won") won += 1;
  else lost += 1;
  if (outcome === "lost" && /competitor/i.test(reason?.name ?? "") && competitors.length)
    await attempt(`competitor ${opp.id}`, () => withTx((client) => addOpportunityCompetitor(client, actor, opp.id, { competitorId: pick(competitors).id, isPrimary: true, notes: "Selected by the customer." })));
}
// Closed deals close on a real date between creation and today; open deals
// expect to close over the coming two quarters (some already slipped).
await db.query(
  `UPDATE tenant.crm_opportunities SET actual_close_date = (created_at + (random() * GREATEST(7, extract(day from now()-created_at))) * interval '1 day')::date,
          expected_close_date = (created_at + (random() * GREATEST(7, extract(day from now()-created_at))) * interval '1 day')::date
    WHERE organization_id=$1 AND status IN ('won','lost') AND actual_close_date >= current_date - 1`,
  [organizationId],
);
await db.query(
  `UPDATE tenant.crm_opportunities SET expected_close_date = current_date + ((random()*170)::int - 12)
    WHERE organization_id=$1 AND status='open' AND expected_close_date IS NOT NULL AND random() < 0.8`,
  [organizationId],
);
log(`opportunity stage moves: ${stageMoves}, won: ${won}, lost: ${lost}`);

// Buying roles, competitors, deal teams on open and won deals.
const roleSet = ["decision_maker", "economic_buyer", "champion", "influencer", "technical", "procurement", "user"];
const withContacts = await q(
  `SELECT o.id, o.owner_user_id, array_agg(c.id) AS contacts FROM tenant.crm_opportunities o
     JOIN tenant.contacts c ON c.organization_id=o.organization_id AND c.party_id=o.party_id
    WHERE o.organization_id=$1 AND NOT EXISTS (SELECT 1 FROM tenant.crm_opportunity_contact_roles r WHERE r.organization_id=o.organization_id AND r.opportunity_id=o.id)
    GROUP BY o.id, o.owner_user_id`,
);
let roles = 0;
for (const opp of withContacts) {
  const actor = opp.owner_user_id ? await ctx(opp.owner_user_id) : owner;
  for (const [index, contactId] of opp.contacts.slice(0, 3).entries()) {
    const ok = await attempt(`role ${opp.id}`, () =>
      withTx((client) => addOpportunityContactRole(client, actor, opp.id, { contactId, role: index === 0 ? pick(["decision_maker", "economic_buyer"]) : pick(roleSet) })),
    );
    if (ok) roles += 1;
  }
  if (chance(0.3) && competitors.length)
    await attempt(`competitor ${opp.id}`, () => withTx((client) => addOpportunityCompetitor(client, actor, opp.id, { competitorId: pick(competitors).id, isPrimary: false, notes: pick(["Incumbent at their sister company.", "Shortlisted alongside us.", "Quoted 20% lower.", "Customer evaluating a free trial."]) })));
  if (chance(0.2))
    await attempt(`team ${opp.id}`, () => withTx((client) => addOpportunityTeamMember(client, actor, opp.id, { userId: pick([ids["Neha Bhatia"], ids["Divya Pillai"], ids["Sameer Gupta"]]), teamRole: pick(["solution_consultant", "overlay", "contributor"]), accessLevel: "edit" })));
}
log(`buying roles: ${roles}`);

// ------------------------------------------------------------- activities
// Activities belong to whoever owns the record they are about; due dates
// spread around today; past ones mostly done, with real outcomes.
await db.query(
  `UPDATE tenant.crm_activities a SET assigned_to = COALESCE(l.owner_user_id, o.owner_user_id, p.owner_user_id, a.assigned_to)
     FROM tenant.crm_activities x
     LEFT JOIN tenant.crm_leads l ON l.organization_id=x.organization_id AND x.entity_type='lead' AND l.id=x.entity_id
     LEFT JOIN tenant.crm_opportunities o ON o.organization_id=x.organization_id AND x.entity_type='opportunity' AND o.id=x.entity_id
     LEFT JOIN tenant.business_parties p ON p.organization_id=x.organization_id AND x.entity_type='party' AND p.id=x.entity_id
    WHERE a.organization_id=$1 AND x.organization_id=a.organization_id AND x.id=a.id AND a.status NOT IN ('completed','cancelled')`,
  [organizationId],
);
await db.query(
  `UPDATE tenant.crm_activities SET due_at = date_trunc('hour', now() + ((random()*50) - 32) * interval '1 day') + (floor(random()*4)*15) * interval '1 minute',
          created_at = now() - (random()*60 + 35) * interval '1 day'
    WHERE organization_id=$1 AND status='planned' AND due_at IS NOT NULL AND created_at > now() - interval '2 days'`,
  [organizationId],
);
await db.query(
  `UPDATE tenant.crm_activities SET start_at = due_at, end_at = due_at + interval '45 minutes' WHERE organization_id=$1 AND activity_type='meeting' AND status='planned' AND due_at IS NOT NULL`,
  [organizationId],
);
const past = await q(
  `SELECT id, activity_type, assigned_to FROM tenant.crm_activities WHERE organization_id=$1 AND status='planned' AND due_at < now() - interval '1 day' ORDER BY due_at`,
);
let completed = 0;
for (const activity of past) {
  if (!chance(0.7)) continue; // the rest stay overdue — real follow-up debt
  const actor = activity.assigned_to ? await ctx(activity.assigned_to) : owner;
  const ok = await attempt(`complete ${activity.activity_type} ${activity.id}`, () =>
    withTx((client) => {
      if (activity.activity_type === "call")
        return completeCrmCall(client, actor, activity.id, weighted([
          [{ outcomeCode: "connected", outcome: pick(["Discussed rollout timeline; they want a phased go-live.", "Confirmed the demo date with the CFO.", "Walked through pricing; asked for a volume discount.", "Answered integration questions about Tally export."]) }, 6],
          [{ outcomeCode: "no_answer", outcome: "No answer; will retry tomorrow morning." }, 2],
          [{ outcomeCode: "voicemail", outcome: "Left a voicemail with the proposal highlights." }, 1],
          [{ outcomeCode: "callback_requested", outcome: "Asked us to call back after their month-end close." }, 1],
        ]));
      if (activity.activity_type === "meeting")
        return completeCrmMeeting(client, actor, activity.id, chance(0.88)
          ? { outcomeCode: "held", outcome: pick(["Demo went well; finance team liked the GST reports.", "Requirements workshop done; 12 user stories captured.", "Reviewed the contract redlines together.", "QBR: adoption up 18% quarter on quarter."]) }
          : { outcomeCode: "no_show", outcome: "Customer did not join; rescheduling." });
      if (activity.activity_type === "follow_up") return completeCrmFollowUp(client, actor, activity.id);
      if (activity.activity_type === "task") return completeCrmTask(client, actor, activity.id, { outcome: pick(["Sent.", "Done and shared with the customer.", "Completed; notes added to the opportunity.", "Reviewed with legal."]) });
      return null;
    }),
  );
  if (ok) completed += 1;
}
// A few tasks in progress, the way a real queue looks mid-week.
for (const task of await q(`SELECT id, assigned_to FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='task' AND status='planned' AND due_at BETWEEN now() AND now() + interval '5 days' LIMIT 25`)) {
  const actor = task.assigned_to ? await ctx(task.assigned_to) : owner;
  await attempt(`start task ${task.id}`, () => withTx((client) => startCrmTask(client, actor, task.id)));
}
// Completion happened around when it was due, not today.
await db.query(
  `UPDATE tenant.crm_activities SET completed_at = LEAST(now(), due_at + (random()*2) * interval '1 day') WHERE organization_id=$1 AND status='completed' AND completed_at > now() - interval '1 hour' AND due_at IS NOT NULL`,
  [organizationId],
);
log(`activities completed: ${completed}`);

// --------------------------------------------------------------- forecast
const periods = await q(`SELECT id, name, period_start, period_end, status FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND period_type='quarter' ORDER BY period_start`);
const today = new Date().toISOString().slice(0, 10);
const currentPeriod = periods.find((p) => p.period_start.toISOString().slice(0, 10) <= today && p.period_end.toISOString().slice(0, 10) >= today);
const lastPeriod = periods.filter((p) => p.period_end.toISOString().slice(0, 10) < today).at(-1);
for (const period of [lastPeriod, currentPeriod].filter(Boolean)) {
  for (const [region, sellers] of Object.entries(REGION_SELLERS)) {
    for (const name of sellers) {
      const seller = await ctx(ids[name]);
      const existing = await one(`SELECT id FROM tenant.crm_forecast_submissions WHERE organization_id=$1 AND period_id=$2 AND owner_user_id=$3 AND status<>'superseded'`, [period.id, ids[name]]);
      if (existing) continue;
      const commitLakhs = between(18, 55);
      const submission = await attempt(`forecast ${name}`, () =>
        withTx((client) => submitForecast(client, seller, { periodId: period.id, commitAmount: commitLakhs * 100000, bestCaseAmount: (commitLakhs + between(8, 25)) * 100000, notes: pick(["Two large deals in negotiation; legal review pending.", "Commit is contracted renewals plus one signed PO.", "Best case depends on the Surat plant expansion.", "Pipeline healthy; watching one slipped close date."]) })),
      );
      if (!submission?.submission) continue;
      const manager = await ctx(ids[REGION_MANAGER[region]]);
      const decision = weighted([["approve", 6], ["adjust", 3], ["reject", 1]]);
      await attempt(`review ${name}`, () =>
        withTx((client) =>
          reviewForecast(client, manager, {
            submissionId: submission.submission.id,
            decision,
            managerAdjustment: decision === "adjust" ? -between(2, 8) * 100000 : undefined,
            reason: { approve: "Matches the deal review.", adjust: "Negotiation deal likely to slip into next quarter.", reject: "Please split commit by customer before resubmitting." }[decision],
            expectedVersion: submission.submission.version,
          }),
        ),
      );
    }
  }
}
if (lastPeriod && lastPeriod.status !== "closed") {
  await attempt("freeze last quarter", () => withTx((client) => setForecastPeriodStatus(client, owner, { periodId: lastPeriod.id, status: "frozen" })));
  await attempt("close last quarter", () => withTx((client) => setForecastPeriodStatus(client, owner, { periodId: lastPeriod.id, status: "closed" })));
}
if (currentPeriod) await attempt("current snapshot", () => withTx((client) => captureForecastPeriodSnapshot(client, owner, { periodId: currentPeriod.id, source: "manual", captureKey: `seed:${today}` })));
log("forecast: submissions, reviews and snapshots recorded");

// --------------------------------------------- predictive lead scoring
// Train the lead-propensity model on the qualification/conversion history
// created above (Settings > Lead scoring does the same). It stays a draft;
// seed-vercentlabs-lead-propensity-f027-data.mjs activates it.
const predictive = await one(`SELECT id FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND model_type='predictive' LIMIT 1`);
if (!predictive) {
  const model = await attempt("predictive model", () => withTx((client) => createLeadScoringModel(client, owner, { name: "Lead propensity", modelType: "predictive", trainingVariables: ["sourceId", "industry", "countryCode", "rating", "priority"] })));
  if (model?.id) await attempt("train predictive model", () => withTx((client) => trainPredictiveLeadScoringModel(client, owner, model.id)));
  log("predictive lead model trained");
}

if (failures.length) {
  log(`\n${failures.length} record(s) skipped (first 15):`);
  for (const failure of failures.slice(0, 15)) log(`  ${failure}`);
}
await kit.close();
