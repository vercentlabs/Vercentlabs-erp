#!/usr/bin/env node
// Vercentlabs CRM demo — depth. The last pass after foundation, base,
// lifecycle, engagement and the per-feature enrichers. Fills the remaining
// user-facing surfaces through their governed functions:
//   product catalogue (master data) and opportunity line items · revenue
//   splits and recurring revenue · win/loss reviews · mutual action plans ·
//   conversation insights · email signatures · web-to-lead capture forms ·
//   lead behaviour (web) events · public meeting bookings · lead import
//   history (F021) · custom record types, fields and records · sales
//   sequences · and the scheduled jobs a live org would have run (daily
//   pipeline snapshot, lead SLA scan) through the worker's own handlers.
// Idempotent per section.
import {
  addOpportunityItem,
  bookMeeting,
  getMeetingAvailability,
  openLeadSlaCase,
  recordLeadResponse,
  updateCrmRecord,
  commitLeadImport,
  createBusinessDataRecord,
  createCrmRecord,
  previewLeadImport,
  recordLeadBehaviorEvent,
  saveLeadForm,
  saveMutualActionPlan,
  saveOpportunityRecurringRevenue,
  saveOpportunityRevenueSplits,
  submitWinLossReview,
  upsertEmailSignature,
} from "../../services/api/src/index.js";
import { buildSystemContext } from "../../services/worker/src/system-context.js";
import { capturePipelineDailySnapshotHandler } from "../../services/worker/src/handlers/crm-pipeline-snapshot-capture.js";
import { detectLeadSlaBreachesHandler } from "../../services/worker/src/handlers/crm-lead-sla-scan.js";
import { between, chance, daysFromNow, log, openSeedKit, pick } from "./crm-seed-kit.mjs";

const kit = await openSeedKit();
const { db, organizationId, withTx } = kit;
const q = async (sql, params = []) => (await db.query(sql, [organizationId, ...params])).rows;
const ownerRow = await kit.owner();
const owner = await kit.contextFor(ownerRow.id);
const { companyId, branchId } = await kit.company();
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
async function section(label, table, target, fn, where = "true") {
  const have = await kit.count(table, where);
  if (have >= target) return log(`${label}: already ${have}`);
  await fn(target - have);
  log(`${label}: ${await kit.count(table, where)}`);
}

// ------------------------------------------------------- product catalogue
const uom = Object.fromEntries((await q(`SELECT code, id FROM tenant.units_of_measure WHERE organization_id=$1`)).map((row) => [row.code, row.id]));
const gst = (await q(`SELECT id FROM tenant.tax_categories WHERE organization_id=$1 AND code='GST-TAXABLE'`))[0]?.id;
const CATALOGUE = [
  ["VL-ERP-CORE", "Vercent ERP — Core licence (per user / year)", "Finance, GST, purchase and sales for one named user.", "NOS", 18000],
  ["VL-CRM-PRO", "Vercent CRM Professional (per user / year)", "Leads, pipeline, forecast and reports.", "NOS", 12000],
  ["VL-INV-MOD", "Inventory & Warehouse module (per site / year)", "Multi-godown stock, batches, barcode.", "NOS", 90000],
  ["VL-MFG-MOD", "Manufacturing module (per plant / year)", "BOM, work orders, shop-floor capture.", "NOS", 150000],
  ["VL-HR-MOD", "HR & Payroll module (per 50 employees / year)", "Attendance, payroll, PF/ESI compliance.", "NOS", 60000],
  ["VL-MOBILE", "Field Sales mobile app (per user / year)", "Offline order capture and visit tracking.", "NOS", 6000],
  ["VL-IMPL-STD", "Implementation — standard package", "Up to 25 users, 6-week rollout.", "NOS", 350000],
  ["VL-IMPL-DAY", "Implementation consultant (per day)", "On-site or remote functional consultant.", "DAY", 12000],
  ["VL-MIGRATION", "Data migration from Tally / Excel", "Masters, open balances and 2 years of history.", "NOS", 120000],
  ["VL-TRAINING", "User training (per batch of 15)", "Classroom or virtual, one day.", "NOS", 25000],
  ["VL-SUPPORT-PREM", "Premium support (per year)", "4-hour response, named account manager.", "NOS", 150000],
  ["VL-INTEGRATION", "Custom integration (per interface)", "API integration with a third-party system.", "NOS", 180000],
];
const knownItems = new Set((await q(`SELECT code FROM tenant.items WHERE organization_id=$1`)).map((row) => row.code));
for (const [code, name, description, unit, price] of CATALOGUE)
  if (!knownItems.has(code))
    await attempt(`item ${code}`, () =>
      withTx((client) =>
        createBusinessDataRecord(client, owner, "items", {
          companyId,
          code,
          name,
          description,
          itemType: "service",
          uomId: uom[unit] ?? uom.EA,
          hsnSacCode: "998314",
          trackInventory: false,
          trackingType: "none",
          allowNegativeStock: false,
          purchasePrice: 0,
          valuationMethod: "standard",
          salesPrice: price,
          standardCost: Math.round(price * 0.35),
          taxCategoryId: gst,
          status: "active",
        }),
      ),
    );
const items = Object.fromEntries((await q(`SELECT code, id FROM tenant.items WHERE organization_id=$1 AND code LIKE 'VL-%'`)).map((row) => [row.code, row.id]));
log(`catalogue items: ${Object.keys(items).length}`);

// ------------------------------------------------------ opportunity items
const openOpps = await q(`SELECT id, name, owner_user_id, amount FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open' ORDER BY amount DESC NULLS LAST`);
await section("opportunity line items", "tenant.crm_opportunity_items", 260, async () => {
  for (const opp of openOpps) {
    const has = (await q(`SELECT 1 FROM tenant.crm_opportunity_items WHERE organization_id=$1 AND opportunity_id=$2`, [opp.id]))[0];
    if (has || !chance(0.75)) continue;
    const users = between(10, 120);
    const bundle = pick([
      [["VL-ERP-CORE", users], ["VL-IMPL-STD", 1], ["VL-TRAINING", Math.ceil(users / 15)]],
      [["VL-CRM-PRO", users], ["VL-MOBILE", Math.ceil(users / 2)], ["VL-IMPL-DAY", between(5, 20)]],
      [["VL-ERP-CORE", users], ["VL-INV-MOD", between(1, 4)], ["VL-MIGRATION", 1]],
      [["VL-ERP-CORE", users], ["VL-MFG-MOD", between(1, 3)], ["VL-IMPL-STD", 1], ["VL-SUPPORT-PREM", 1]],
      [["VL-HR-MOD", between(1, 6)], ["VL-IMPL-DAY", between(4, 10)]],
      [["VL-INTEGRATION", between(1, 3)], ["VL-IMPL-DAY", between(3, 8)]],
    ]);
    const context = await ctx(opp.owner_user_id);
    for (const [code, quantity] of bundle)
      if (items[code])
        await attempt(`item on ${opp.id}`, () =>
          withTx((client) => addOpportunityItem(client, context, opp.id, { itemId: items[code], quantity, discountPercent: pick([0, 0, 5, 10, 12.5, 15]), taxPercent: 18 })),
        );
  }
});

// ---------------------------------------------- splits & recurring revenue
const overlay = (await q(`SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.full_name IN ('Sameer Gupta','Neha Bhatia','Divya Pillai')`)).map((row) => row.id);
await section("revenue splits", "tenant.crm_opportunity_revenue_splits", 50, async () => {
  for (const opp of openOpps.slice(0, 30)) {
    await attempt(`split ${opp.id}`, () =>
      withTx(async (client) =>
        saveOpportunityRevenueSplits(client, await ctx(opp.owner_user_id), {
          opportunityId: opp.id,
          splits: [
            { userId: opp.owner_user_id, splitType: "revenue", percent: 100, role: "Account Executive" },
            // Each split type totals 100%: overlay credit goes wholly to the overlay person.
            { userId: pick(overlay), splitType: "overlay", percent: 100, role: pick(["Partner Manager", "Solution Consultant", "Customer Success"]) },
          ],
        }),
      ),
    );
  }
});
await section("recurring revenue schedules", "tenant.crm_opportunity_revenue_schedules", 40, async () => {
  const subscriptions = await q(
    `SELECT i.id, i.opportunity_id, i.quantity * i.unit_price AS value, o.owner_user_id FROM tenant.crm_opportunity_items i JOIN tenant.crm_opportunities o ON o.id=i.opportunity_id AND o.organization_id=i.organization_id
      JOIN tenant.items m ON m.id=i.item_id AND m.organization_id=i.organization_id
     WHERE i.organization_id=$1 AND m.code IN ('VL-ERP-CORE','VL-CRM-PRO','VL-SUPPORT-PREM') AND o.status='open' LIMIT 25`,
  );
  for (const line of subscriptions)
    await attempt(`schedule ${line.id}`, () =>
      withTx(async (client) =>
        saveOpportunityRecurringRevenue(client, await ctx(line.owner_user_id), {
          opportunityItemId: line.id,
          interval: pick(["month", "quarter", "year"]),
          periods: pick([12, 4, 3]),
          startDate: daysFromNow(between(20, 90)).slice(0, 10),
          totalAmount: Math.round(Number(line.value)),
        }),
      ),
    );
});

// --------------------------------------------------- win/loss reviews
await section("win/loss reviews", "tenant.crm_win_loss_reviews", 40, async () => {
  const closed = await q(
    `SELECT o.id, o.status, o.owner_user_id, o.created_at, o.actual_close_date, r.name AS reason FROM tenant.crm_opportunities o
       LEFT JOIN tenant.crm_lost_reasons r ON r.organization_id=o.organization_id AND r.id=o.outcome_reason_id
      WHERE o.organization_id=$1 AND o.status IN ('won','lost') ORDER BY o.actual_close_date DESC NULLS LAST LIMIT 45`,
  );
  const competitors = (await q(`SELECT name FROM tenant.crm_competitors WHERE organization_id=$1`)).map((row) => row.name);
  for (const opp of closed) {
    const won = opp.status === "won";
    await attempt(`review ${opp.id}`, () =>
      withTx(async (client) =>
        submitWinLossReview(client, await ctx(opp.owner_user_id), {
          opportunityId: opp.id,
          primaryReason: opp.reason ?? (won ? "Best fit for requirements" : "Price too high"),
          competitorName: chance(0.6) ? pick(competitors) : null,
          salesCycleDays: Math.max(7, Math.round((new Date(opp.actual_close_date ?? Date.now()) - new Date(opp.created_at)) / 86400000)),
          interviewNotes: won
            ? pick(["CFO said our GST reporting demo was the deciding factor.", "They valued the local implementation team in Pune.", "Reference call with a similar manufacturer closed it."])
            : pick(["Procurement chose the lowest bid; we were 18% higher.", "Their IT head preferred a cloud-only vendor.", "Project deferred after a leadership change."]),
          lessons: won ? pick(["Bring the solution consultant to the first demo.", "Lead with compliance, not features."]) : pick(["Qualify budget earlier.", "Engage the economic buyer before the proposal.", "Offer a phased price for mid-market."]),
        }),
      ),
    );
  }
});

// ------------------------------------------------- mutual action plans
await section("mutual action plans", "tenant.crm_mutual_action_plans", 18, async () => {
  const late = await q(
    `SELECT o.id, o.owner_user_id, o.expected_close_date FROM tenant.crm_opportunities o JOIN tenant.crm_pipeline_stages s ON s.id=o.stage_id AND s.organization_id=o.organization_id
      WHERE o.organization_id=$1 AND o.status='open' AND s.probability >= 60 ORDER BY o.amount DESC NULLS LAST LIMIT 20`,
  );
  for (const opp of late) {
    const close = opp.expected_close_date ? new Date(opp.expected_close_date) : new Date(Date.now() + 30 * 86400000);
    const at = (daysBefore) => new Date(close.getTime() - daysBefore * 86400000).toISOString().slice(0, 10);
    await attempt(`map ${opp.id}`, () =>
      withTx(async (client) =>
        saveMutualActionPlan(client, await ctx(opp.owner_user_id), {
          opportunityId: opp.id,
          name: "Path to signature",
          status: "active",
          customerVisible: true,
          targetCloseDate: close.toISOString().slice(0, 10),
          milestones: [
            { title: "Technical sign-off from IT", dueDate: at(28), status: "completed", owner: "Customer" },
            { title: "Commercial proposal reviewed", dueDate: at(21), status: chance(0.6) ? "completed" : "in_progress", owner: "Vercentlabs" },
            { title: "Legal review of MSA", dueDate: at(12), status: pick(["planned", "in_progress", "blocked"]), owner: "Customer" },
            { title: "PO issued", dueDate: at(2), status: "planned", owner: "Customer" },
          ],
        }),
      ),
    );
  }
});

// ------------------------------------------------- conversation insights
await section("conversation insights", "tenant.crm_conversation_insights", 200, async () => {
  const conversations = await q(`SELECT c.id FROM tenant.crm_conversations c WHERE c.organization_id=$1 AND NOT EXISTS (SELECT 1 FROM tenant.crm_conversation_insights i WHERE i.organization_id=c.organization_id AND i.conversation_id=c.id)`);
  for (const conversation of conversations) {
    for (const [insightType, title, content] of [
      ["summary", "Call summary", pick(["Customer confirmed a ₹40 lakh budget and wants go-live before April.", "Discussed data migration; masters to be shared by Friday.", "Agreed a 40-40-20 milestone payment split.", "Walked through multi-branch stock transfer; they liked the approval flow."])],
      [pick(["objection", "commitment", "next_action", "risk", "sentiment"]), pick(["Price objection", "Commitment", "Next action", "Risk flagged", "Sentiment"]), pick(["Per-user price feels high compared to Zoho.", "CFO committed to a decision by month end.", "Send the revised SOW and book a legal call.", "IT head missed the call again.", "Tone positive; asked about the go-live plan."])],
    ])
      await attempt("insight", () =>
        withTx((client) =>
          createCrmRecord(client, owner, "conversation-insights", {
            companyId,
            conversationId: conversation.id,
            insightType,
            title,
            content,
            score: between(40, 95),
            modelProvider: "anthropic",
            modelName: "claude-sonnet-5",
            requiresReview: chance(0.3),
            reviewStatus: pick(["approved", "approved", "pending"]),
          }),
        ),
      );
  }
});

// ------------------------------------------------------ email signatures
await section("email signatures", "tenant.crm_email_signatures", 10, async () => {
  const sellers = await q(
    `SELECT u.id, u.full_name, u.email FROM users u JOIN organization_memberships m ON m.user_id=u.id JOIN user_role_assignments a ON a.user_id=u.id AND a.organization_id=m.organization_id JOIN roles r ON r.id=a.role_id
      WHERE m.organization_id=$1 AND r.slug IN ('sales_representative','sales_manager','sales_head','customer_success_manager','partner_manager')`,
  );
  for (const seller of sellers) {
    const text = `${seller.full_name}\nVercentlabs Technologies Pvt Ltd\n${seller.email} | +91 20 4860 ${between(1000, 9999)}\nwww.vercentlabs.com`;
    await attempt(`signature ${seller.full_name}`, () =>
      withTx(async (client) =>
        upsertEmailSignature(client, await ctx(seller.id), {
          userId: seller.id,
          companyId,
          name: "Default",
          bodyText: text,
          bodyHtml: `<p>${text.replace(/\n/g, "<br>")}</p>`,
          isDefault: true,
          status: "active",
        }),
      ),
    );
  }
});

// ---------------------------------------------------------- capture forms
await section("lead capture forms", "tenant.crm_capture_forms", 3, async () => {
  const sources = Object.fromEntries((await q(`SELECT name, id FROM tenant.crm_lead_sources WHERE organization_id=$1`)).map((row) => [row.name, row.id]));
  const campaign = (await q(`SELECT id FROM tenant.crm_campaigns WHERE organization_id=$1 AND name LIKE 'Webinar: Multi-branch%'`))[0];
  const priya = (await q(`SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.email='priya.kulkarni@vercentlabs.com'`))[0]?.id;
  for (const form of [
    { name: "Website — Request a demo", sourceId: sources["Website enquiry"], landingPage: "https://www.vercentlabs.com/demo", successMessage: "Thanks! Our team will call you within one working day." },
    { name: "Website — Pricing enquiry", sourceId: sources["Website enquiry"], landingPage: "https://www.vercentlabs.com/pricing", successMessage: "Thanks! We'll email you a quote shortly." },
    { name: "Webinar registration — Multi-branch inventory", sourceId: sources.Webinar, campaignId: campaign?.id, landingPage: "https://www.vercentlabs.com/webinars/multi-branch-inventory", successMessage: "You're registered — the joining link is on its way." },
  ])
    await attempt(`form ${form.name}`, () =>
      withTx((client) =>
        saveLeadForm(client, owner, {
          ...form,
          companyId,
          branchId,
          ownerUserId: priya,
          allowedOrigins: ["https://www.vercentlabs.com"],
          consentText: "I agree to be contacted by Vercentlabs about its products.",
          duplicateStrategy: "update",
          captchaMode: "turnstile",
          definition: { fields: [{ name: "firstName", label: "First name", required: true }, { name: "lastName", label: "Last name" }, { name: "email", label: "Work email", required: true }, { name: "mobile", label: "Mobile" }, { name: "companyName", label: "Company", required: true }] },
        }),
      ),
    );
});

// ------------------------------------------------ lead web behaviour
await section("lead behaviour events", "tenant.crm_lead_behavior_events", 320, async (need) => {
  const leads = await q(`SELECT id, created_at FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' ORDER BY random() LIMIT 160`);
  let made = 0;
  for (const lead of leads) {
    for (const [eventType, value] of pick([
      [["page_view", "/erp-for-manufacturing"], ["page_view", "/pricing"], ["form_submit", "demo-request"]],
      [["email_open", "Q3 product launch"], ["email_click", "/webinars"]],
      [["page_view", "/case-studies/textiles"], ["content_download", "ERP buyer's guide (PDF)"]],
      [["page_view", "/pricing"], ["page_view", "/pricing"], ["page_view", "/integrations/tally"]],
    ])) {
      if (made >= need) return;
      const occurredAt = new Date(new Date(lead.created_at).getTime() - between(0, 10) * 86400000 + between(0, 86400) * 1000).toISOString();
      const done = await attempt("behaviour", () =>
        withTx((client) =>
          recordLeadBehaviorEvent(client, owner, {
            leadId: lead.id,
            eventType,
            eventValue: 1,
            sourceType: eventType.startsWith("email") ? "email" : eventType === "form_submit" ? "form" : "website",
            occurredAt,
            idempotencyKey: `seed:${lead.id}:${eventType}:${value}:${occurredAt.slice(0, 10)}`,
            metadata: { path: value },
          }),
        ),
      );
      if (done) made += 1;
    }
  }
});

// ------------------------------------------------ public meeting bookings
// The links' weekly hours in the format the slot calculator reads, then
// bookings on slots the link actually offers.
const WEEK = { start: "10:00", end: "13:00" };
const AFTERNOON = { start: "14:30", end: "18:00" };
for (const link of await q(`SELECT id, updated_at, availability FROM tenant.crm_meeting_links WHERE organization_id=$1`)) {
  if (Array.isArray(link.availability?.monday)) continue;
  await attempt("link hours", () =>
    withTx((client) =>
      updateCrmRecord(client, owner, "meeting-links", link.id, {
        availability: { monday: [WEEK, AFTERNOON], tuesday: [WEEK, AFTERNOON], wednesday: [WEEK, AFTERNOON], thursday: [WEEK, AFTERNOON], friday: [WEEK, { start: "14:30", end: "16:30" }] },
      }, { expectedUpdatedAt: link.updated_at.toISOString() }),
    ),
  );
}
await section("meeting bookings", "tenant.crm_meeting_bookings", 20, async (need) => {
  const links = await q(`SELECT id, owner_user_id FROM tenant.crm_meeting_links WHERE organization_id=$1 AND status='active'`);
  const guests = await q(`SELECT first_name, last_name, email FROM tenant.crm_leads WHERE organization_id=$1 AND email IS NOT NULL AND record_status='active' ORDER BY random() LIMIT 40`);
  let made = 0;
  for (const [index, guest] of guests.entries()) {
    if (made >= need) break;
    const link = links[index % links.length];
    const linkContext = { organizationId, userId: link.owner_user_id };
    const date = daysFromNow(between(1, 14)).slice(0, 10);
    const slots = await attempt("availability", () => withTx((client) => getMeetingAvailability(client, linkContext, link.id, date)));
    if (!slots?.length) continue;
    const slot = pick(slots);
    const done = await attempt("booking", () =>
      withTx((client) =>
        bookMeeting(client, linkContext, link.id, {
          startsAt: slot.startsAt ?? slot.start,
          guestName: `${guest.first_name} ${guest.last_name ?? ""}`.trim(),
          guestEmail: guest.email,
          guestTimezone: "Asia/Kolkata",
          notes: pick(["Keen to see the inventory module.", "Two colleagues from finance will join.", "Please cover GST e-invoicing.", ""]),
        }),
      ),
    );
    if (done) made += 1;
  }
});

// ---------------------------------------------------- lead import history
await section("lead import batches", "tenant.crm_lead_import_batches", 3, async () => {
  const batches = [
    ["IndiaMART buy-leads — August.csv", 38, "skip"],
    ["IMTEX Bengaluru — stall visitors.csv", 64, "skip"],
    ["Webinar attendees — Tally migration.csv", 27, "update"],
  ];
  const cities = ["Pune", "Nashik", "Surat", "Bengaluru", "Coimbatore", "Chennai", "Hyderabad", "Jaipur", "Lucknow", "Indore"];
  const first = ["Nitin", "Sunita", "Harish", "Kavita", "Manoj", "Rekha", "Sanjay", "Anita", "Deepak", "Lata", "Girish", "Swati", "Mahesh", "Asha", "Prakash"];
  const last = ["Patil", "Kale", "Chauhan", "Rathod", "Hegde", "Naidu", "Pandya", "Shinde", "Yadav", "Sethi", "Bansal", "Kamath"];
  const kinds = ["Engineering", "Plastics", "Pharma", "Textiles", "Foods", "Auto Parts", "Electricals", "Packaging"];
  for (const [fileName, size, strategy] of batches) {
    const rows = Array.from({ length: size }, (_, index) => {
      const f = pick(first);
      const l = pick(last);
      const company = `${pick(["Shree", "Om", "Laxmi", "Ganesh", "Sai", "Balaji", "Mahalaxmi", "Jai"])} ${pick(kinds)} ${pick(["Pvt Ltd", "Industries", "Enterprises", "LLP"])}`;
      return {
        "First Name": index === 7 ? "" : f, // one genuinely incomplete row per file
        "Last Name": l,
        Email: `${f}.${l}${between(1, 99)}@${company.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 16)}.in`,
        Mobile: `9${between(100000000, 999999999)}`,
        Company: company,
        City: pick(cities),
      };
    });
    const preview = await attempt(`import preview ${fileName}`, () =>
      withTx((client) =>
        previewLeadImport(client, owner, {
          fileName,
          rows,
          fieldMapping: { firstName: "First Name", lastName: "Last Name", email: "Email", mobile: "Mobile", companyName: "Company", city: "City" },
          duplicateStrategy: strategy,
        }),
      ),
    );
    if (preview?.batch?.id) await attempt(`import commit ${fileName}`, () => withTx((client) => commitLeadImport(client, owner, preview.batch.id)));
  }
});

// ------------------------------------------- custom record types & records
await section("custom record types", "tenant.crm_custom_object_definitions", 2, async () => {
  for (const [objectKey, singularLabel, pluralLabel, description] of [
    ["site_survey", "Site survey", "Site surveys", "Pre-sales site surveys of plants and warehouses."],
    ["install_base", "Installed system", "Installed systems", "The software a prospect or customer runs today."],
  ])
    await attempt(`object ${objectKey}`, () => withTx((client) => createCrmRecord(client, owner, "custom-object-definitions", { objectKey, singularLabel, pluralLabel, description, primaryNameField: "name", companyScoped: true, status: "active" })));
});
const objects = Object.fromEntries((await q(`SELECT object_key, id FROM tenant.crm_custom_object_definitions WHERE organization_id=$1`)).map((row) => [row.object_key, row.id]));
await section("custom record fields", "tenant.crm_custom_field_definitions", 8, async () => {
  const FIELDS = {
    site_survey: [["site_city", "Site city", "text"], ["users_on_site", "Users on site", "number"], ["survey_date", "Survey date", "date"], ["network_ready", "Network ready", "boolean"]],
    install_base: [["product", "Product", "select", ["Tally Prime", "SAP Business One", "Zoho Books", "Busy", "In-house system"]], ["licences", "Licences", "number"], ["renewal_month", "Renewal month", "text"], ["satisfaction", "Satisfaction", "select", ["High", "Medium", "Low"]]],
  };
  for (const [key, fields] of Object.entries(FIELDS))
    for (const [sequence, [fieldKey, label, dataType, options]] of fields.entries())
      if (objects[key])
        await attempt(`field ${fieldKey}`, () => withTx((client) => createCrmRecord(client, owner, "custom-field-definitions", { objectDefinitionId: objects[key], fieldKey, label, dataType, options: options ? JSON.stringify(options) : null, required: sequence === 0, sequence: sequence + 1, status: "active" })));
});
await section("custom records", "tenant.crm_custom_records", 60, async () => {
  const accounts = await q(`SELECT id, display_name, owner_user_id FROM tenant.business_parties WHERE organization_id=$1 AND party_type='customer' ORDER BY random() LIMIT 60`);
  for (const [index, account] of accounts.entries()) {
    const survey = index % 2 === 0;
    await attempt("custom record", () =>
      withTx((client) =>
        createCrmRecord(client, owner, "custom-records", {
          companyId,
          objectDefinitionId: survey ? objects.site_survey : objects.install_base,
          recordName: survey ? `${account.display_name} — plant survey` : `${account.display_name} — current system`,
          ownerUserId: account.owner_user_id,
          data: survey
            ? { site_city: pick(["Chakan", "Bhiwandi", "Sanand", "Hosur", "Manesar", "Sricity"]), users_on_site: between(8, 90), survey_date: daysFromNow(-between(5, 120)).slice(0, 10), network_ready: chance(0.7) }
            : { product: pick(["Tally Prime", "SAP Business One", "Zoho Books", "Busy", "In-house system"]), licences: between(3, 60), renewal_month: pick(["March", "June", "September", "December"]), satisfaction: pick(["High", "Medium", "Low", "Low"]) },
          status: "active",
        }),
      ),
    );
  }
});

// -------------------------------------------------------------- sequences
await section("sales sequences", "tenant.crm_sequences", 3, async () => {
  const SEQUENCES = [
    ["New enquiry — 14-day follow-up", "For website and IndiaMART enquiries.", [[0, "email", "Thanks for your enquiry", "Hi {{firstName}}, thanks for reaching out..."], [2880, "call", null, "Discovery call"], [7200, "whatsapp", null, "Share brochure"], [20160, "email", "Following up", "Hi {{firstName}}, checking in..."]]],
    ["Post-demo nurture", "After a product demo.", [[0, "email", "Demo recording and next steps", "Hi {{firstName}}, thanks for your time..."], [4320, "task", null, "Send proposal"], [10080, "call", null, "Proposal walkthrough"]]],
    ["Renewal — 60 days out", "Customers with a renewal in 60 days.", [[0, "email", "Your renewal is coming up", "Hi {{firstName}}..."], [10080, "call", null, "Renewal check-in"]]],
  ];
  for (const [name, description, steps] of SEQUENCES) {
    const sequence = await attempt(`sequence ${name}`, () => withTx((client) => createCrmRecord(client, owner, "sequences", { name, description, ownerUserId: ownerRow.id, status: "active" })));
    if (!sequence) continue;
    for (const [index, [delayMinutes, actionType, subjectTemplate, bodyTemplate]] of steps.entries())
      await attempt("sequence step", () => withTx((client) => createCrmRecord(client, owner, "sequence-steps", { sequenceId: sequence.id, stepOrder: index + 1, delayMinutes, actionType, subjectTemplate, bodyTemplate, assignedToOwner: true })));
    const enrolled = await q(`SELECT id, owner_user_id FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' ORDER BY random() LIMIT 18`);
    for (const lead of enrolled)
      await attempt("enrollment", () =>
        withTx((client) =>
          createCrmRecord(client, owner, "sequence-enrollments", {
            sequenceId: sequence.id,
            leadId: lead.id,
            currentStep: between(1, steps.length),
            nextRunAt: daysFromNow(between(0, 10)),
            status: pick(["active", "active", "active", "paused", "completed"]),
            enrolledBy: lead.owner_user_id ?? ownerRow.id,
          }),
        ),
      );
  }
});

// ------------------------------------------------- lead response SLAs
// Leads from the past few weeks get their response-SLA case dated from when
// they arrived (as lead intake does); about half got a same-day response
// through the governed recordLeadResponse; the scheduled scan below marks
// the unanswered, overdue ones breached.
await section("lead SLA cases", "tenant.crm_lead_sla_cases", 60, async () => {
  const leads = await q(
    `SELECT l.id, l.owner_user_id, l.created_at FROM tenant.crm_leads l WHERE l.organization_id=$1 AND l.record_status='active' AND l.owner_user_id IS NOT NULL
        AND l.created_at BETWEEN now() - interval '40 days' AND now() - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM tenant.crm_lead_sla_cases c WHERE c.organization_id=l.organization_id AND c.lead_id=l.id) LIMIT 60`,
  );
  for (const lead of leads) {
    const context = await ctx(lead.owner_user_id);
    const opened = await attempt("sla case", () => withTx((client) => openLeadSlaCase(client, context, lead.id)));
    if (!opened) continue;
    await db.query(
      `UPDATE tenant.crm_lead_sla_cases SET response_due_at = $3::timestamptz + (response_due_at - started_at), started_at = $3, created_at = $3 WHERE organization_id=$1 AND lead_id=$2`,
      [organizationId, lead.id, lead.created_at],
    );
    if (chance(0.7))
      await attempt("sla response", () =>
        withTx((client) => recordLeadResponse(client, context, lead.id, { respondedAt: new Date(new Date(lead.created_at).getTime() + between(12, 55) * 60000).toISOString(), channel: "call", note: "Called within the hour; discovery booked." })),
      );
  }
});

// ------------------------------------ jobs a live org would have run
const system = buildSystemContext(organizationId, { activeCompanyId: companyId, activeBranchId: branchId });
await attempt("pipeline snapshot job", () => withTx((client) => capturePipelineDailySnapshotHandler(client, system, {})));
await attempt("lead SLA scan job", () => withTx((client) => detectLeadSlaBreachesHandler(client, system, {})));
log(`pipeline stage snapshots: ${await kit.count("tenant.crm_pipeline_stage_snapshots")}, SLA cases: ${await kit.count("tenant.crm_lead_sla_cases")}`);

if (failures.length) {
  const unique = [...new Set(failures.map((failure) => failure.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>")))];
  log(`\n${failures.length} record(s) skipped; distinct reasons:`);
  for (const failure of unique.slice(0, 25)) log(`  ${failure}`);
}
await kit.close();
