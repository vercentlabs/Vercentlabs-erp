#!/usr/bin/env node
// Vercentlabs CRM demo — engagement and intelligence. Runs after the
// foundation, base and lifecycle seeds. Fills every remaining CRM surface
// that shows records (360 views, Inbox, campaigns, reports) through the
// governed functions and registered CRM resources, with text that reads like
// the work of a real Indian B2B software sales team:
//   notes · email/WhatsApp/call communications · campaigns, members and
//   attribution touchpoints · consent · lead tags · account plans and
//   stakeholders · buying committees · relationship map · account signals ·
//   recorded conversations and insights · pipeline inspections · deal risks ·
//   recommendations · AI predictions and feedback · partners and partner
//   deals · privacy requests · engagement templates · meeting links ·
//   playbooks · field visits · data-quality scores · saved/scheduled reports
// Idempotent per section (skips a section that already has its volume).
import {
  assignRecordTag,
  createCrmAccount,
  createCrmNote,
  createCrmRecord,
  createReportDefinition,
  createReportSchedule,
  recordLeadTouchpoint,
} from "../../services/api/src/index.js";
import { between, chance, daysFromNow, log, openSeedKit, pick, random } from "./crm-seed-kit.mjs";

const kit = await openSeedKit();
const { db, organizationId, withTx } = kit;
const q = async (sql, params = []) => (await db.query(sql, [organizationId, ...params])).rows;
const ownerRow = await kit.owner();
const owner = await kit.contextFor(ownerRow.id);
const { companyId } = await kit.company();
const contexts = new Map();
const ctx = async (userId) => {
  if (!userId) return owner;
  if (!contexts.has(userId)) contexts.set(userId, await kit.contextFor(userId));
  return contexts.get(userId);
};
const failures = [];
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (error) {
    failures.push(`${label}: ${error.code ?? ""} ${error.message}`);
    return null;
  }
}
const create = (context, resource, input) => attempt(resource, () => withTx((client) => createCrmRecord(client, context, resource, { companyId, ...input })));
async function section(label, table, target, fn) {
  const have = await kit.count(table);
  if (have >= target) return log(`${label}: already ${have}`);
  await fn(target - have);
  log(`${label}: ${await kit.count(table)}`);
}
const person = async (name) => (await q(`SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.full_name=$2`, [name]))[0]?.id;
const people = {
  marketing: await person("Farhan Qureshi"),
  success: await person("Divya Pillai"),
  partners: await person("Sameer Gupta"),
  ops: await person("Neha Bhatia"),
  admin: await person("Anjali Verma"),
  head: await person("Rahul Deshpande"),
  westManager: await person("Sneha Iyer"),
};
if (!people.marketing) throw new Error("Run seed-vercentlabs-crm-foundation.mjs first.");

const accounts = await q(`SELECT p.id, p.display_name AS name, p.owner_user_id, p.industry FROM tenant.business_parties p WHERE p.organization_id=$1 AND p.party_type='customer' ORDER BY p.created_at`);
const contacts = await q(`SELECT c.id, c.first_name, c.last_name, c.designation, c.email, c.party_id FROM tenant.contacts c WHERE c.organization_id=$1 AND c.status='active'`);
const leads = await q(`SELECT l.id, l.first_name, l.last_name, l.company_name, l.email, l.owner_user_id, l.created_at, l.record_status FROM tenant.crm_leads l WHERE l.organization_id=$1 ORDER BY l.created_at`);
const opps = await q(`SELECT o.id, o.name, o.party_id, o.owner_user_id, o.status, o.amount, o.expected_close_date, o.created_at FROM tenant.crm_opportunities o WHERE o.organization_id=$1 ORDER BY o.created_at`);
const openOpps = opps.filter((opp) => opp.status === "open");
const contactsByAccount = new Map();
for (const contact of contacts) {
  if (!contactsByAccount.has(contact.party_id)) contactsByAccount.set(contact.party_id, []);
  contactsByAccount.get(contact.party_id).push(contact);
}
const accountName = new Map(accounts.map((account) => [account.id, account.name]));
const ago = (days) => daysFromNow(-days);

// ------------------------------------------------------------------ notes
const NOTE_BODIES = [
  (o) => `Discovery recap: ${o} runs Tally for accounts and Excel for inventory across three godowns. Pain is month-end stock reconciliation — takes the team four days.`,
  (o) => `Spoke to the finance head at ${o}. They want e-invoicing and GST returns out of the box; currently paying a CA firm to file.`,
  (o) => `${o} asked for references in their industry. Shared two customer case studies and offered a reference call.`,
  (o) => `Procurement at ${o} needs three quotes before approval. We are one of two shortlisted; the other is a Zoho partner.`,
  (o) => `Security questionnaire from ${o} received — 42 questions, mostly on data residency. Looping in Neha for the standard responses.`,
  (o) => `Demo feedback from ${o}: loved the mobile order entry, concerned about migrating 8 years of historical data.`,
  (o) => `Commercials: ${o} is pushing for a 15% discount on a three-year commitment. Manager approval needed above 10%.`,
  (o) => `Implementation plan agreed with ${o}: finance module first (6 weeks), then sales and inventory in phase two.`,
  (o) => `${o} decision is with the MD; he returns from Dubai on Monday. Champion expects a decision within two weeks.`,
  (o) => `Renewal risk at ${o}: usage of the reports module dropped since their MIS executive resigned. Offered a free training session.`,
];
await section("notes", "tenant.crm_notes", 320, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const onDeal = chance(0.55) && opps.length;
    const target = onDeal ? pick(opps) : pick(leads);
    const org = onDeal ? accountName.get(target.party_id) ?? "the customer" : target.company_name;
    const context = await ctx(target.owner_user_id);
    await attempt("note", () =>
      withTx((client) =>
        createCrmNote(client, context, onDeal ? "opportunity" : "lead", target.id, {
          body: pick(NOTE_BODIES)(org),
          isPinned: chance(0.12),
          visibility: chance(0.15) ? "private" : "shared",
        }),
      ),
    );
  }
  await db.query(`UPDATE tenant.crm_notes SET created_at = now() - (random()*200) * interval '1 day' WHERE organization_id=$1 AND created_at > now() - interval '1 hour'`, [organizationId]);
});

// --------------------------------------------------------- communications
const EMAIL_THREADS = [
  ["Proposal for ERP implementation", "Please find attached our proposal covering licences, implementation and first-year support. Happy to walk your team through it this week."],
  ["Re: Demo recording and next steps", "Thanks for your time today. The recording is attached, along with the migration checklist we discussed."],
  ["Revised commercials", "As discussed, we have revised the implementation fee and added two days of on-site training at no cost."],
  ["Reference customers", "Sharing contacts at two customers in your industry who have agreed to speak with you."],
  ["Re: GST e-invoicing questions", "Yes, IRN generation and e-way bills are built in. I've attached a short note on how it works with your transporter."],
  ["Meeting confirmation", "Confirming our meeting on Thursday at 11 am at your Andheri office. I'll bring the solution consultant."],
  ["Contract for review", "Sharing the MSA and order form for your legal team's review. Redlines are welcome in tracked changes."],
];
const WHATSAPP = [
  "Hi, sharing the brochure as promised. Let me know a good time to call.",
  "Reached your office, waiting at reception.",
  "Thank you for the meeting today! Will send the proposal by tomorrow EOD.",
  "Sir, gentle reminder about the pending PO. Please let me know if anything is needed from our side.",
  "Demo link for tomorrow 3 pm: we'll use Google Meet.",
];
await section("communications", "tenant.crm_communications", 380, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const onDeal = chance(0.6) && opps.length;
    const target = onDeal ? pick(opps) : pick(leads);
    const contact = onDeal ? pick(contactsByAccount.get(target.party_id) ?? [null]) : null;
    const email = contact?.email ?? target.email;
    const channel = pick(["email", "email", "email", "whatsapp", "call", "sms"]);
    const direction = chance(0.6) ? "outbound" : "inbound";
    const [subject, body] = channel === "email" ? pick(EMAIL_THREADS) : [null, channel === "call" ? pick(["Call logged: discussed rollout timeline and pricing.", "Call logged: customer asked for a reference in pharma.", "Call logged: procurement confirmed budget approval."]) : pick(WHATSAPP)];
    const context = await ctx(target.owner_user_id);
    await create(context, "communications", {
      channel,
      direction,
      leadId: onDeal ? null : target.id,
      opportunityId: onDeal ? target.id : null,
      partyId: onDeal ? target.party_id : null,
      contactId: contact?.id ?? null,
      provider: channel === "email" ? "gmail" : channel === "whatsapp" ? "whatsapp_business" : "manual",
      subject: subject ? (direction === "inbound" ? `Re: ${subject.replace(/^Re: /, "")}` : subject) : null,
      body,
      fromAddress: direction === "inbound" ? email : "sales@vercentlabs.com",
      toAddresses: direction === "inbound" ? ["sales@vercentlabs.com"] : email ? [email] : [],
      status: direction === "inbound" ? "received" : pick(["sent", "delivered", "read", "delivered"]),
      occurredAt: ago(between(0, 240)),
    });
  }
});

// ---------------------------------------------------------------- campaigns
const CAMPAIGNS = [
  ["Tally to ERP Migration Webinar", "webinar", "completed", -300, -299, 60000],
  ["IMTEX Bengaluru 2026 Stall", "event", "completed", -250, -245, 850000],
  ["GST e-Invoicing Readiness Mailer", "email", "completed", -220, -190, 45000],
  ["Google Search — ERP for Manufacturers", "advertising", "completed", -200, -110, 420000],
  ["LinkedIn — CFO Thought Leadership", "social", "completed", -180, -120, 280000],
  ["Customer Referral Programme FY26", "referral", "active", -170, 60, 150000],
  ["India Warehousing Show Delhi", "event", "completed", -140, -137, 620000],
  ["Partner Co-marketing — Pune SI Network", "partner", "active", -120, 45, 200000],
  ["Outbound — Gujarat Textile Cluster", "outbound", "completed", -100, -40, 90000],
  ["Q3 Product Launch Newsletter", "email", "completed", -75, -70, 30000],
  ["Webinar: Multi-branch Inventory Control", "webinar", "completed", -45, -44, 55000],
  ["Google Search — CRM for SMB", "advertising", "active", -30, 60, 350000],
  ["Aahar Food Expo 2026", "event", "planned", 25, 29, 480000],
  ["Year-end Upgrade Offer", "email", "planned", 40, 70, 40000],
];
await section("campaigns", "tenant.crm_campaigns", CAMPAIGNS.length, async () => {
  const existing = new Set((await q(`SELECT name FROM tenant.crm_campaigns WHERE organization_id=$1`)).map((row) => row.name));
  for (const [index, [name, campaignType, status, start, end, budget]] of CAMPAIGNS.entries()) {
    if (existing.has(name)) continue;
    await create(owner, "campaigns", {
      code: `CMP-${String(index + 101).padStart(4, "0")}`,
      name,
      campaignType,
      status,
      startDate: ago(-start).slice(0, 10),
      endDate: ago(-end).slice(0, 10),
      budget,
      expectedRevenue: budget * between(6, 14),
      actualCost: status === "planned" ? 0 : Math.round(budget * (0.8 + random() * 0.3)),
      ownerUserId: people.marketing,
      description: `${name}. Run by demand generation for the ${pick(["West", "South", "North", "national"])} market.`,
    });
  }
});
const campaigns = await q(`SELECT id, name, campaign_type, status, start_date FROM tenant.crm_campaigns WHERE organization_id=$1 ORDER BY start_date`);
if ((await kit.count("tenant.crm_campaign_members")) < 600) {
  for (const lead of leads) {
    const eligible = campaigns.filter((campaign) => campaign.status !== "planned" && new Date(campaign.start_date) <= new Date(lead.created_at.getTime() + 20 * 86400000));
    for (const campaign of eligible) {
      if (!chance(0.18)) continue;
      const status = lead.record_status === "converted" && chance(0.4) ? "converted" : pick(["sent", "sent", "responded", "attended", "unsubscribed", "responded"]);
      await db.query(
        `INSERT INTO tenant.crm_campaign_members(organization_id,campaign_id,lead_id,member_status,responded_at,converted_at,created_by)
         SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM tenant.crm_campaign_members WHERE organization_id=$1 AND campaign_id=$2 AND lead_id=$3)`,
        [organizationId, campaign.id, lead.id, status, ["responded", "attended", "converted"].includes(status) ? lead.created_at : null, status === "converted" ? lead.created_at : null, people.marketing],
      );
    }
  }
  log(`campaign members: ${await kit.count("tenant.crm_campaign_members")}`);
}
await section("attribution touchpoints", "tenant.crm_marketing_touchpoints", 650, async (need) => {
  const members = await q(`SELECT m.lead_id, m.member_status, c.id AS campaign_id, c.campaign_type, c.start_date FROM tenant.crm_campaign_members m JOIN tenant.crm_campaigns c ON c.id=m.campaign_id AND c.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.lead_id IS NOT NULL`);
  let made = 0;
  for (const member of members) {
    if (made >= need) break;
    const events = { email: ["sent", "opened", "clicked"], webinar: ["registered", "attended"], event: ["registered", "attended"], advertising: ["impression", "clicked"], social: ["impression", "clicked"], referral: ["responded"], partner: ["responded"], outbound: ["sent", "responded"] }[member.campaign_type] ?? ["responded"];
    for (const [step, eventType] of events.entries()) {
      if (step > 0 && !["responded", "attended", "converted"].includes(member.member_status) && chance(0.5)) break;
      const occurred = new Date(new Date(member.start_date).getTime() + (step * 2 + between(0, 3)) * 86400000);
      if (occurred > new Date()) break;
      const done = await attempt("touchpoint", () =>
        withTx((client) => recordLeadTouchpoint(client, owner, member.lead_id, { campaignId: member.campaign_id, channel: member.campaign_type, eventType, occurredAt: occurred.toISOString(), metadata: { seeded: false } })),
      );
      if (done) made += 1;
    }
    if (member.member_status === "converted")
      await attempt("touchpoint", () => withTx((client) => recordLeadTouchpoint(client, owner, member.lead_id, { campaignId: member.campaign_id, channel: member.campaign_type, eventType: "converted", occurredAt: new Date(new Date(member.start_date).getTime() + 12 * 86400000).toISOString() })));
  }
});

// --------------------------------------------------------- consent & tags
await section("consent events", "tenant.crm_consent_events", 260, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const lead = pick(leads);
    await create(owner, "consent-events", {
      leadId: lead.id,
      channel: pick(["email", "email", "whatsapp", "sms", "call"]),
      purpose: pick(["marketing", "sales", "marketing", "service"]),
      action: chance(0.9) ? "granted" : pick(["withdrawn", "suppressed"]),
      lawfulBasis: pick(["consent", "consent", "legitimate_interest", "contract"]),
      source: pick(["form", "form", "manual", "import", "preference_center"]),
      evidence: { note: pick(["Website enquiry form checkbox", "Verbal consent recorded on discovery call", "Trade show registration form", "Unsubscribe link in newsletter"]) },
      occurredAt: new Date(lead.created_at).toISOString(),
    });
  }
});
if ((await kit.count("tenant.crm_lead_tags")) < 200) {
  const tags = await q(`SELECT id, name FROM tenant.crm_tags WHERE organization_id=$1`);
  for (const lead of leads.filter((row) => row.record_status === "active")) {
    if (!chance(0.45)) continue;
    const context = await ctx(lead.owner_user_id);
    for (const tag of [pick(tags), ...(chance(0.3) ? [pick(tags)] : [])])
      await attempt("tag", () => withTx((client) => assignRecordTag(client, context, "lead", lead.id, tag.id)));
  }
  log(`lead tags: ${await kit.count("tenant.crm_lead_tags")}`);
}

// ------------------------------------------- account plans & stakeholders
const bigAccounts = accounts.slice(0, 70);
await section("account plans", "tenant.crm_account_plans", 60, async (need) => {
  for (const account of bigAccounts.slice(0, need)) {
    const health = between(35, 95);
    await create(await ctx(account.owner_user_id), "account-plans", {
      partyId: account.id,
      ownerUserId: account.owner_user_id,
      executiveSponsorUserId: pick([people.head, people.westManager]),
      accountTier: pick(["strategic", "enterprise", "enterprise", "growth", "growth", "standard"]),
      lifecycleStage: pick(["active", "active", "onboarding", "renewal", "at_risk"]),
      objectives: JSON.stringify(pick(["Expand from finance to inventory and sales in FY27.", "Standardise all 6 plants on one ERP by March.", "Cut month-end close from 8 days to 3.", "Roll out field sales app to 40 reps."]).split(/(?<=\.) /)),
      risks: JSON.stringify([pick(["IT head leaving in Q4.", "Budget review after new CFO joins.", "Competitor pitching a bundled offer.", "Low adoption in the Surat branch."])]),
      whiteSpace: JSON.stringify([pick(["Payroll and HR module not yet sold.", "Two sister companies still on Tally.", "No service desk module.", "Warehouse module for the new DC."])]),
      successPlan: JSON.stringify({ cadence: "Quarterly business review", measures: ["Active users", "Month-end close days", "Support tickets"], owner: "Named customer success manager" }),
      renewalDate: ago(-between(20, 330)).slice(0, 10),
      annualRevenue: between(8, 60) * 100000,
      potentialRevenue: between(20, 150) * 100000,
      healthScore: health,
      healthStatus: health > 75 ? "healthy" : health > 60 ? "watch" : health > 45 ? "at_risk" : "critical",
      lastReviewedAt: ago(between(5, 80)),
      nextReviewAt: ago(-between(10, 60)),
      status: "active",
    });
  }
});
const plans = await q(`SELECT id, party_id FROM tenant.crm_account_plans WHERE organization_id=$1`);
await section("account stakeholders", "tenant.crm_account_stakeholders", 150, async () => {
  for (const plan of plans) {
    for (const contact of (contactsByAccount.get(plan.party_id) ?? []).slice(0, 3)) {
      await create(owner, "account-stakeholders", {
        accountPlanId: plan.id,
        contactId: contact.id,
        name: `${contact.first_name} ${contact.last_name}`,
        title: contact.designation,
        stakeholderRole: pick(["economic_buyer", "decision_maker", "champion", "influencer", "user", "technical", "procurement"]),
        influenceLevel: pick(["low", "medium", "high", "critical"]),
        sentiment: pick(["strong_supporter", "supporter", "supporter", "neutral", "detractor"]),
        engagementScore: between(20, 95),
        notes: pick(["Prefers WhatsApp over email.", "Joined two QBRs this year.", "Former user of SAP B1.", "Signs off anything above ₹10 lakh."]),
        status: "active",
      });
    }
  }
});

// ------------------------------------------------------ buying committees
await section("buying committees", "tenant.crm_buying_committees", 55, async (need) => {
  for (const opp of openOpps.filter((row) => contactsByAccount.get(row.party_id)?.length).slice(0, need)) {
    const committee = await create(await ctx(opp.owner_user_id), "buying-committees", {
      partyId: opp.party_id,
      opportunityId: opp.id,
      name: `${accountName.get(opp.party_id)} evaluation committee`,
      decisionProcess: pick(["Tender via procurement; MD signs off.", "IT and finance jointly evaluate, CFO approves.", "Board approval needed above ₹25 lakh."]),
      decisionDate: opp.expected_close_date ? new Date(opp.expected_close_date).toISOString().slice(0, 10) : null,
      coverageScore: between(30, 95),
      status: "active",
    });
    if (!committee) continue;
    for (const contact of contactsByAccount.get(opp.party_id).slice(0, 4))
      await create(owner, "buying-committee-members", {
        committeeId: committee.id,
        contactId: contact.id,
        name: `${contact.first_name} ${contact.last_name}`,
        memberRole: pick(["economic_buyer", "decision_maker", "champion", "influencer", "technical", "procurement", "user"]),
        influenceLevel: pick(["medium", "high", "critical", "low"]),
        sentiment: pick(["supporter", "strong_supporter", "neutral", "detractor", "unknown"]),
        engagementScore: between(15, 95),
        authorityConfirmed: chance(0.5),
        relationshipOwnerUserId: opp.owner_user_id,
        gaps: chance(0.3) ? "Not yet met the finance controller." : null,
        status: "active",
      });
  }
});

// ------------------------------------------------ relationships & signals
await section("relationship edges", "tenant.crm_relationship_edges", 90, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const account = pick(accounts.filter((row) => (contactsByAccount.get(row.id) ?? []).length >= 2));
    if (!account) break;
    const [from, to] = contactsByAccount.get(account.id);
    await create(owner, "relationship-edges", {
      fromEntityType: "contact",
      fromEntityId: from.id,
      toEntityType: chance(0.7) ? "contact" : "user",
      toEntityId: chance(0.7) ? to.id : account.owner_user_id,
      relationshipType: pick(["reports_to", "knows", "influences", "introduced_by", "champions"]),
      strength: between(30, 95),
      source: pick(["manual", "manual", "integration"]),
      validFrom: ago(between(60, 400)).slice(0, 10),
      notes: pick(["Worked together at their previous company.", "Reports directly to the CFO.", "Introduced us at the IMTEX expo.", null]),
      status: "active",
    });
  }
});
const SIGNALS = [
  ["intent", "Visited pricing page 6 times this week"],
  ["engagement", "Opened the proposal 4 times"],
  ["product_usage", "Active users up 22% this month"],
  ["financial", "Announced a new plant in Sanand"],
  ["service", "Three P1 support tickets in 10 days"],
  ["renewal", "Renewal due in 45 days"],
  ["competitive", "Attended a competitor's webinar"],
  ["news", "Raised Series B funding"],
];
await section("account signals", "tenant.crm_account_signals", 130, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const account = pick(accounts);
    const [signalType, title] = pick(SIGNALS);
    await create(await ctx(account.owner_user_id), "account-signals", {
      partyId: account.id,
      signalType,
      title,
      description: `${title} — ${account.name}.`,
      signalValue: between(1, 100),
      score: between(20, 95),
      occurredAt: ago(between(0, 90)),
      source: pick(["website", "product", "news", "support", "email"]),
      status: chance(0.85) ? "active" : "dismissed",
    });
  }
});

// ------------------------------------------------ conversations & insights
await section("conversations", "tenant.crm_conversations", 110, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const opp = pick(opps);
    const started = new Date(Date.now() - between(1, 200) * 86400000);
    const conversation = await create(await ctx(opp.owner_user_id), "conversations", {
      opportunityId: opp.id,
      partyId: opp.party_id,
      contactId: pick(contactsByAccount.get(opp.party_id) ?? [{ id: null }]).id,
      channel: pick(["call", "meeting", "video", "video", "email_thread"]),
      provider: pick(["google_meet", "zoom", "microsoft_teams", "exotel"]),
      title: pick(["Discovery call", "Solution demo", "Commercial negotiation", "Implementation kickoff", "Technical deep-dive", "QBR"]) + ` — ${accountName.get(opp.party_id)}`,
      startedAt: started.toISOString(),
      endedAt: new Date(started.getTime() + between(20, 70) * 60000).toISOString(),
      transcriptStatus: pick(["ready", "ready", "ready", "not_requested"]),
      consentStatus: "granted",
      status: "completed",
    });
    if (!conversation) continue;
    for (const [insightType, title, content] of [
      ["summary", "Call summary", pick(["Customer confirmed budget of ₹40 lakh and wants go-live before April.", "Discussed data migration; they will share masters by Friday.", "Negotiated payment terms: 40-40-20 milestone split agreed."])],
      [pick(["objection", "commitment", "next_action", "risk"]), pick(["Price objection", "Commitment", "Next action", "Risk flagged"]), pick(["Felt the per-user price is high versus Zoho.", "CFO committed to a decision by month end.", "Send the revised SOW and schedule a legal call.", "Their IT head was not on the call again."])],
    ])
      await create(owner, "conversation-insights", {
        conversationId: conversation.id,
        insightType,
        title,
        content,
        score: between(40, 95),
        modelProvider: "anthropic",
        modelName: "claude-sonnet-5",
        requiresReview: chance(0.3),
        reviewStatus: pick(["approved", "approved", "pending"]),
      });
  }
});

// --------------------------------------- inspections, risks, recommendations
await section("pipeline inspections", "tenant.crm_pipeline_inspections", Math.min(160, openOpps.length), async (need) => {
  for (const opp of openOpps.slice(0, need)) {
    const health = between(30, 95);
    await create(owner, "pipeline-inspections", {
      opportunityId: opp.id,
      inspectedAt: ago(between(0, 6)),
      stageAgeDays: between(2, 70),
      daysSinceActivity: between(0, 35),
      closeDateSlipDays: chance(0.3) ? between(7, 60) : 0,
      amountChange: chance(0.2) ? -between(1, 8) * 50000 : 0,
      probabilityChange: chance(0.2) ? pick([-15, -10, 10, 15]) : 0,
      healthScore: health,
      healthStatus: health > 75 ? "healthy" : health > 60 ? "watch" : health > 45 ? "at_risk" : "critical",
      issues: JSON.stringify(health < 60 ? ["No activity in 3 weeks", "Close date slipped twice"] : []),
      recommendedActions: JSON.stringify(health < 60 ? ["Book a call with the economic buyer", "Confirm the decision date"] : []),
      calculationVersion: "inspection-2026.09",
    });
  }
});
const RISKS = [
  ["stale_activity", "No activity for 21 days"],
  ["close_date_slip", "Close date moved twice"],
  ["missing_stakeholder", "Economic buyer not engaged"],
  ["missing_next_step", "No next step recorded"],
  ["competitor", "Competitor offering 20% lower price"],
  ["pricing", "Discount above approval threshold"],
];
await section("deal risks", "tenant.crm_deal_risks", 75, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const opp = pick(openOpps);
    const [riskType, title] = pick(RISKS);
    await create(await ctx(opp.owner_user_id), "deal-risks", {
      opportunityId: opp.id,
      riskType,
      severity: pick(["low", "medium", "medium", "high", "critical"]),
      title,
      description: `${title} on ${opp.name}.`,
      detectedAt: ago(between(0, 30)),
      status: pick(["open", "open", "acknowledged", "resolved"]),
    });
  }
});
await section("recommendations", "tenant.crm_recommendations", 95, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const onDeal = chance(0.6);
    const target = onDeal ? pick(openOpps) : pick(leads.filter((row) => row.record_status === "active"));
    const [recommendationType, title] = pick([
      ["next_best_action", "Schedule a demo with the finance team"],
      ["follow_up", "Follow up on the proposal sent 9 days ago"],
      ["stakeholder", "Engage the CFO — not yet met"],
      ["cross_sell", "Pitch the payroll module"],
      ["upsell", "Offer the multi-branch add-on"],
      ["risk_mitigation", "Share a reference customer to counter the competitor"],
      ["data_quality", "Add a phone number and GSTIN"],
    ]);
    await create(owner, "recommendations", {
      entityType: onDeal ? "opportunity" : "lead",
      entityId: target.id,
      recommendationType,
      title,
      rationale: "Based on recent activity, stage age and similar won deals.",
      priority: pick(["low", "medium", "medium", "high", "urgent"]),
      confidence: Number((0.55 + random() * 0.4).toFixed(2)),
      source: pick(["rules", "ai", "ai"]),
      modelProvider: "anthropic",
      modelName: "claude-sonnet-5",
      dueAt: ago(-between(1, 14)),
      status: pick(["open", "open", "accepted", "completed", "rejected"]),
    });
  }
});

// ------------------------------------------------------ AI predictions
await section("AI predictions", "tenant.crm_ai_predictions", 160, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const onDeal = chance(0.55);
    const target = onDeal ? pick(openOpps) : pick(leads);
    const score = Number((0.1 + random() * 0.85).toFixed(3));
    await create(owner, "ai-predictions", {
      entityType: onDeal ? "opportunity" : "lead",
      entityId: target.id,
      predictionType: onDeal ? "opportunity_win" : "lead_conversion",
      score,
      label: score > 0.7 ? "likely" : score > 0.4 ? "possible" : "unlikely",
      explanation: score > 0.7
        ? { summary: "Engaged decision maker, recent demo, budget confirmed.", factors: ["stakeholder_engagement", "recent_demo", "budget_confirmed"] }
        : { summary: "Low engagement and no decision date.", factors: ["low_engagement", "no_decision_date"] },
      modelProvider: "vercentlabs",
      modelName: onDeal ? "win-propensity" : "lead-propensity",
      modelVersion: "2026.09",
      generatedAt: ago(between(0, 20)),
      status: "active",
    });
  }
});
await section("AI feedback", "tenant.crm_ai_feedback", 60, async (need) => {
  const predictions = await q(`SELECT id FROM tenant.crm_ai_predictions WHERE organization_id=$1 LIMIT $2`, [need]);
  for (const prediction of predictions)
    await create(owner, "ai-feedback", {
      predictionId: prediction.id,
      userId: pick([people.head, people.westManager, people.ops]),
      outcome: pick(["correct", "correct", "accepted", "incorrect", "modified"]),
      feedback: pick(["Matches what the rep is seeing.", "Too optimistic — champion left.", "Useful signal.", null]),
    });
});

// ---------------------------------------------------------------- partners
const PARTNERS = [
  ["Sahyadri Systems LLP", "system_integrator", "gold", "West"],
  ["NexaTech Solutions", "reseller", "silver", "South"],
  ["Kaveri Consulting Services", "system_integrator", "platinum", "South"],
  ["Indus Business Advisors", "referral", "registered", "North"],
  ["Pragati Infotech", "reseller", "gold", "West"],
  ["DataBridge Integrations", "technology", "silver", "National"],
  ["Capital Region ERP Partners", "distributor", "gold", "North"],
  ["Coromandel Digital", "system_integrator", "silver", "South"],
  ["Narmada Tax Consultants", "referral", "registered", "West"],
];
await section("partner accounts", "tenant.crm_partner_accounts", PARTNERS.length, async () => {
  for (const [name, partnerType, tier, region] of PARTNERS) {
    // A partner is also a business party (they resell to customers and bill
    // us for services), created through the governed Account path.
    const existingParty = (await q(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, [name]))[0];
    const party = existingParty ?? (await attempt(`partner party ${name}`, () =>
      withTx((client) => createCrmAccount(client, owner, { displayName: name, partyType: "both", industry: "IT Services", countryCode: "IN", currencyCode: "INR", website: `https://www.${name.toLowerCase().replace(/[^a-z]+/g, "")}.in` })),
    ));
    if (!party) continue;
    await create(owner, "partner-accounts", {
      partyId: party.id,
      name,
      partnerType,
      tier,
      region,
      ownerUserId: people.partners,
      agreementStart: ago(between(200, 700)).slice(0, 10),
      agreementEnd: ago(-between(100, 500)).slice(0, 10),
      referralPercent: partnerType === "referral" ? 10 : partnerType === "reseller" ? 20 : 15,
      status: "active",
    });
  }
});
const partners = await q(`SELECT id, name FROM tenant.crm_partner_accounts WHERE organization_id=$1`);
await section("partner deals", "tenant.crm_partner_deals", 45, async (need) => {
  if (!partners.length) return;
  for (const [index, opp] of opps.slice(0, need).entries()) {
    const partner = pick(partners);
    await create(owner, "partner-deals", {
      partnerAccountId: partner.id,
      opportunityId: opp.id,
      dealRegistrationCode: `DR-${new Date().getFullYear()}-${String(index + 1).padStart(4, "0")}`,
      registeredAt: new Date(opp.created_at).toISOString(),
      expiresAt: new Date(new Date(opp.created_at).getTime() + 120 * 86400000).toISOString(),
      partnerOwnerName: pick(["Suresh Patil", "Lakshmi Narayanan", "Harpreet Singh", "Deepak Jain", "Farida Sheikh"]),
      internalOwnerUserId: people.partners,
      expectedValue: Number(opp.amount ?? 0),
      currencyCode: "INR",
      contributionPercent: pick([10, 15, 20, 25]),
      notes: pick(["Partner sourced; leading implementation.", "Co-sell; partner owns the relationship.", "Referral only."]),
      status: opp.status === "won" ? "won" : opp.status === "lost" ? "lost" : pick(["approved", "active", "submitted"]),
    });
  }
});

// ------------------------------------------ privacy, templates, meeting links
await section("privacy requests", "tenant.crm_privacy_requests", 18, async (need) => {
  for (let index = 0; index < need; index += 1) {
    const lead = pick(leads);
    const status = pick(["received", "verification_pending", "in_progress", "completed", "completed", "rejected"]);
    await create(owner, "privacy-requests", {
      requestType: pick(["access", "export", "deletion", "correction", "restriction", "consent_withdrawal"]),
      subjectType: "lead",
      subjectId: lead.id,
      requesterName: `${lead.first_name} ${lead.last_name}`,
      requesterEmail: lead.email,
      identityVerifiedAt: ["received", "verification_pending"].includes(status) ? null : ago(between(2, 60)),
      dueAt: ago(-between(-20, 30)),
      status,
      resolutionNotes: status === "completed" ? "Exported the lead's data and emailed it on a password-protected link." : null,
      completedAt: status === "completed" ? ago(between(1, 40)) : null,
      assignedTo: people.admin,
    });
  }
});
const TEMPLATES = [
  ["email", "First follow-up after enquiry", "Thanks for your interest in Vercentlabs", "Hi {{firstName}},\n\nThanks for reaching out. I'd love to understand how your team manages accounts and inventory today. Would a 20-minute call this week work?\n\nRegards,\n{{senderName}}"],
  ["email", "Proposal cover email", "Proposal for {{companyName}}", "Hi {{firstName}},\n\nPlease find our proposal attached. It covers licences, implementation and first-year support.\n\n{{senderName}}"],
  ["email", "Post-demo recap", "Recording and next steps from today's demo", "Hi {{firstName}},\n\nThank you for your time today. The recording and our migration checklist are attached."],
  ["whatsapp", "Meeting reminder", null, "Hi {{firstName}}, reminder for our meeting tomorrow at {{time}}. See you then!"],
  ["whatsapp", "Brochure share", null, "Hi {{firstName}}, sharing our brochure as discussed: {{link}}"],
  ["call_script", "Discovery call script", null, "1. Current system and pain points\n2. Number of users and branches\n3. Compliance needs (GST, e-invoicing)\n4. Timeline and budget\n5. Decision process"],
  ["sms", "Payment reminder", null, "Dear {{firstName}}, a gentle reminder that invoice {{invoice}} is due on {{date}}. — Vercentlabs"],
  ["snippet", "GST e-invoicing answer", null, "Yes — IRN generation, QR codes and e-way bills are built in, and filed through the GSP of your choice."],
];
await section("engagement templates", "tenant.crm_engagement_templates", TEMPLATES.length, async () => {
  for (const [templateType, name, subjectTemplate, bodyTemplate] of TEMPLATES)
    await create(owner, "engagement-templates", { templateType, name, subjectTemplate, bodyTemplate, languageCode: "en", ownerUserId: people.marketing, isShared: true, version: 1, status: "active" });
});
await section("meeting links", "tenant.crm_meeting_links", 6, async () => {
  for (const [name, key, minutes] of [["Priya Kulkarni", "priya-demo", 30], ["Meera Shah", "meera-discovery", 30], ["Vikram Nair", "vikram-demo", 45], ["Ananya Reddy", "ananya-intro", 20], ["Aditya Saxena", "aditya-demo", 45], ["Divya Pillai", "divya-qbr", 60]]) {
    const userId = await person(name);
    await create(await ctx(userId), "meeting-links", {
      ownerUserId: userId,
      name: minutes >= 45 ? "Product demo" : minutes === 60 ? "Quarterly business review" : "Introductory call",
      slug: key,
      durationMinutes: minutes,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      timezone: "Asia/Kolkata",
      // The shape the slot calculator reads: weekday -> [{ start, end }] in the link timezone.
      availability: { monday: [{ start: "10:00", end: "13:00" }, { start: "14:30", end: "18:00" }], tuesday: [{ start: "10:00", end: "18:00" }], wednesday: [{ start: "10:00", end: "18:00" }], thursday: [{ start: "10:00", end: "18:00" }], friday: [{ start: "10:00", end: "16:00" }] },
      meetingProvider: "google_meet",
      locationTemplate: "Google Meet link sent on booking",
      status: "active",
    });
  }
});

// ---------------------------------------------------------------- playbooks
const pipelineRows = await q(`SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND is_default`);
await section("playbooks", "tenant.crm_playbooks", 3, async () => {
  for (const [name, framework, description] of [
    ["MEDDICC qualification", "meddic", "Metrics, economic buyer, decision criteria and process, paper process, pain, champion, competition."],
    ["Mid-market ERP discovery", "bant", "Budget, authority, need and timeline for 20–200 user deals."],
    ["Renewal health check", "custom", "Adoption, value realised and expansion signals before renewal."],
  ])
    await create(owner, "playbooks", { pipelineId: pipelineRows[0]?.id ?? null, name, framework, description, guidance: "Complete before moving past Solution Demo.", status: "active" });
});
const playbooks = await q(`SELECT id, name FROM tenant.crm_playbooks WHERE organization_id=$1`);
await section("playbook questions", "tenant.crm_playbook_questions", 18, async () => {
  const QUESTIONS = [
    ["metrics", "What measurable outcome will this deliver?", "text"],
    ["economic_buyer", "Who signs the purchase order?", "text"],
    ["decision_criteria", "What are their top three evaluation criteria?", "text"],
    ["decision_date", "When will they decide?", "date"],
    ["budget_confirmed", "Is budget approved?", "boolean"],
    ["users", "How many users?", "number"],
  ];
  for (const playbook of playbooks)
    for (const [sequence, [questionKey, prompt, responseType]] of QUESTIONS.entries())
      await create(owner, "playbook-questions", { playbookId: playbook.id, questionKey, prompt, responseType, required: sequence < 3, blocksStageExit: false, sequence: sequence + 1, scoringWeight: 10, status: "active" });
});
await section("playbook responses", "tenant.crm_playbook_responses", 120, async (need) => {
  const questions = await q(`SELECT id, playbook_id, question_key, response_type FROM tenant.crm_playbook_questions WHERE organization_id=$1`);
  let made = 0;
  for (const opp of openOpps) {
    if (made >= need) break;
    const playbook = pick(playbooks);
    for (const question of questions.filter((row) => row.playbook_id === playbook.id)) {
      const response = { text: pick(["Reduce stock write-offs by 30%", "The MD, Mr. Shah", "GST compliance, mobile app, local support", "Faster month-end close"]), date: ago(-between(10, 60)).slice(0, 10), boolean: chance(0.6), number: between(15, 180) }[question.response_type];
      const done = await create(await ctx(opp.owner_user_id), "playbook-responses", { playbookId: playbook.id, questionId: question.id, opportunityId: opp.id, response: { value: response }, respondedBy: opp.owner_user_id, respondedAt: ago(between(1, 40)), source: "manual" });
      if (done) made += 1;
    }
  }
});

// --------------------------------------------------------- field visits
await section("field visits", "tenant.crm_field_visits", 70, async (need) => {
  const CITY_AREAS = ["MIDC Bhosari, Pune", "Andheri East, Mumbai", "Peenya Industrial Area, Bengaluru", "Guindy, Chennai", "Naroda GIDC, Ahmedabad", "Okhla Phase II, New Delhi", "HITEC City, Hyderabad", "Sachin GIDC, Surat"];
  for (let index = 0; index < need; index += 1) {
    const opp = pick(opps);
    const offset = between(-60, 20);
    const planned = new Date(Date.now() + offset * 86400000);
    planned.setHours(pick([10, 11, 12, 14, 15, 16]), 0, 0, 0);
    const done = offset < 0;
    await create(await ctx(opp.owner_user_id), "field-visits", {
      partyId: opp.party_id,
      opportunityId: opp.id,
      ownerUserId: opp.owner_user_id,
      visitType: pick(["customer_visit", "demo", "site_survey", "review", "prospecting"]),
      plannedStartAt: planned.toISOString(),
      plannedEndAt: new Date(planned.getTime() + 90 * 60000).toISOString(),
      actualStartAt: done ? planned.toISOString() : null,
      actualEndAt: done ? new Date(planned.getTime() + between(45, 120) * 60000).toISOString() : null,
      address: pick(CITY_AREAS),
      objective: pick(["Walk the warehouse floor with the stores manager.", "On-site demo for plant heads.", "Review phase-one go-live issues.", "Meet the MD for commercial closure."]),
      outcome: done ? pick(["Agreed on scope for phase two.", "Stores team wants barcode scanning.", "MD asked for a revised quote.", "Positive; decision next week."]) : null,
      status: done ? pick(["completed", "completed", "completed", "missed"]) : pick(["planned", "confirmed"]),
    });
  }
});

// ----------------------------------------------------- data quality scores
await section("data quality scores", "tenant.crm_data_quality_scores", 200, async (need) => {
  const scored = new Set((await q(`SELECT entity_id FROM tenant.crm_data_quality_scores WHERE organization_id=$1 AND entity_type='lead'`)).map((row) => row.entity_id));
  for (const lead of leads.filter((row) => !scored.has(row.id)).slice(0, need)) {
    const completeness = between(40, 100);
    const validity = between(60, 100);
    const freshness = between(30, 100);
    const duplicateRisk = between(0, 40);
    await create(owner, "data-quality-scores", {
      entityType: "lead",
      entityId: lead.id,
      completenessScore: completeness,
      validityScore: validity,
      freshnessScore: freshness,
      duplicateRiskScore: duplicateRisk,
      overallScore: Math.round((completeness + validity + freshness + (100 - duplicateRisk)) / 4),
      issues: JSON.stringify(completeness < 70 ? ["Missing phone number", "Missing industry"] : []),
      calculatedAt: ago(between(0, 7)),
      calculationVersion: "dq-2026.09",
    });
  }
});

// ---------------------------------------------------- saved & scheduled reports
const managerSession = await ctx(people.westManager);
const reportSession = { ...managerSession, roleSlugs: managerSession.roleSlugs };
const modules = ["crm"];
const REPORTS = [
  ["Pipeline by stage — West", "crm.pipeline_analysis", { groupBy: "stage", teamId: null }],
  ["Pipeline by owner", "crm.pipeline_analysis", { groupBy: "owner", sortBy: "open_pipeline", sortDirection: "desc" }],
  ["Forecast by team", "crm.pipeline_analysis", { groupBy: "team" }],
  ["Deals by close month", "crm.pipeline_analysis", { groupBy: "close_month" }],
  ["Pipeline by lead source", "crm.pipeline_analysis", { groupBy: "source" }],
  ["Open leads — Maharashtra", "crm.leads", { status: "working" }],
];
const existingReports = new Set((await db.query(`SELECT name FROM report_definitions WHERE organization_id=$1`, [organizationId])).rows.map((row) => row.name));
for (const [name, datasetKey, filters] of REPORTS) {
  if (existingReports.has(name)) continue;
  const clean = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null));
  const definition = await attempt(`report ${name}`, () => withTx((client) => createReportDefinition(client, reportSession, modules, { name, datasetKey, filters: clean })));
  if (definition && ["Pipeline by owner", "Forecast by team"].includes(name))
    await attempt(`schedule ${name}`, () =>
      withTx((client) =>
        createReportSchedule(client, reportSession, modules, {
          definitionId: definition.id,
          frequency: name === "Pipeline by owner" ? "weekly" : "monthly",
          timeOfDay: "08:30",
          timezone: "Asia/Kolkata",
          weekday: name === "Pipeline by owner" ? 1 : null,
          monthDay: name === "Forecast by team" ? 1 : null,
          recipients: [people.westManager, people.head],
        }),
      ),
    );
}
log(`saved reports: ${(await db.query(`SELECT count(*)::int n FROM report_definitions WHERE organization_id=$1`, [organizationId])).rows[0].n}`);

if (failures.length) {
  log(`\n${failures.length} record(s) skipped (first 20):`);
  for (const failure of [...new Set(failures)].slice(0, 30)) log(`  ${failure}`);
}
await kit.close();
