// Industry starter packs (CRM audit): one click sets up CRM the way a kind of business sells — a pipeline whose stages carry that
// industry's words, the lead sources it gets enquiries from, the custom fields it records and the reasons it loses deals. Every
// company otherwise starts from the same general setup.
//
// The pipeline keeps the standard stage codes (DISCOVERY … CLOSING, then won and lost), so stage rules, reports and forecasts work
// unchanged; only the names, chances and guidance are the industry's. Applying a pack adds what is missing and skips what already
// exists (a source, field or reason of the same name, a pipeline of the same name), so applying it twice changes nothing. The pack's
// pipeline becomes the default only while the company has no deals at all.
import { CrmError } from "../data-management/errors.js";
import { createCloseReason } from "../close-reasons/records.js";
import { createCustomField } from "../custom-fields/records.js";
import { createLeadSource, ensureDefaultLeadSources } from "../leads/sources.js";
import { createPipeline, updatePipeline } from "../sales-stages/pipelines.js";

const MANAGE = "crm.settings.manage";

const stages = (names, guidance = []) => [
  ["DISCOVERY", 10, "pipeline"], ["NEEDS_ANALYSIS", 25, "pipeline"], ["PROPOSAL", 50, "best_case"], ["NEGOTIATION", 75, "committed"], ["CLOSING", 90, "committed"],
].map(([code, probability, forecastCategory], index) => ({ code, name: names[index], probability, forecastCategory, guidance: guidance[index] ?? null }));
const lost = (name, category) => ({ name, category });

export const STARTER_PACKS = Object.freeze([
  {
    key: "fmcg", name: "FMCG and distribution", description: "Distributors, stockists and retailers: outlet visits, schemes, margins and credit.",
    pipeline: { name: "Distributor and retailer orders", stages: stages(["Enquiry / outlet visit", "Sample or trial given", "Rate list and scheme shared", "Margin and credit terms", "First order expected"],
      ["Note the outlet type and its monthly offtake", "Leave samples; fix a date to check how they sold", "Share the rate list and the running scheme", "Agree margin, credit days and credit limit", "Take the first order; plan the next visit"]) },
    sources: ["Field visit", "Distributor referral", "Retailer walk-in", "Trade fair"],
    fields: [
      { entityType: "lead", label: "Outlet type", type: "select", options: ["Kirana", "Supermarket", "Medical store", "Wholesaler", "Distributor"] },
      { entityType: "lead", label: "Beat / route", type: "text" },
      { entityType: "party", label: "Beat / route", type: "text" },
      { entityType: "party", label: "Retailer class", type: "select", options: ["A", "B", "C"] },
      { entityType: "party", label: "Credit limit (₹)", type: "number" },
    ],
    lostReasons: [lost("Better margin from a competitor", "price"), lost("Credit terms not acceptable", "price"), lost("Scheme not attractive", "price"), lost("Product does not move in the area", "fit")],
  },
  {
    key: "real_estate", name: "Real estate", description: "Builders and brokers: property portals, site visits, bookings and home loans.",
    pipeline: { name: "Property sales", stages: stages(["Enquiry", "Site visit planned", "Site visit done", "Negotiation / booking amount", "Booking expected"],
      ["Note the budget, configuration and location wanted", "Fix the site visit date and who will show it", "Note what they liked; share the cost sheet", "Agree the price, payment plan and booking amount", "Collect the booking amount; start the agreement"]) },
    sources: ["99acres", "MagicBricks", "Housing.com", "NoBroker", "Channel partner / broker", "Site hoarding"],
    fields: [
      { entityType: "lead", label: "Property type", type: "select", options: ["1 BHK", "2 BHK", "3 BHK", "4+ BHK", "Plot", "Shop / office"] },
      { entityType: "lead", label: "Budget (₹)", type: "number" },
      { entityType: "lead", label: "Preferred location", type: "text" },
      { entityType: "lead", label: "Home loan needed", type: "checkbox" },
      { entityType: "opportunity", label: "Site visit date", type: "date" },
      { entityType: "opportunity", label: "Unit / flat number", type: "text" },
    ],
    lostReasons: [lost("Budget does not match", "budget"), lost("Bought elsewhere", "competition"), lost("Location not suitable", "fit"), lost("Home loan not approved", "budget")],
  },
  {
    key: "education", name: "Education", description: "Schools, colleges, coaching and training: counselling, campus visits and admissions.",
    pipeline: { name: "Admissions", stages: stages(["Enquiry", "Counselling done", "Campus visit / demo class", "Fees discussed", "Admission expected"],
      ["Note the course, the student and the academic year", "Explain the course, results and faculty", "Invite them for a campus visit or a demo class", "Share the fee structure, scholarships and instalments", "Collect the admission form and the first fee"]) },
    sources: ["Shiksha", "CollegeDunia", "Education fair", "Parent referral"],
    fields: [
      { entityType: "lead", label: "Course interested", type: "text" },
      { entityType: "lead", label: "Student name", type: "text" },
      { entityType: "lead", label: "Current class / qualification", type: "text" },
      { entityType: "lead", label: "Academic year", type: "select", options: ["2026-27", "2027-28"] },
      { entityType: "lead", label: "Parent / guardian phone", type: "text" },
    ],
    lostReasons: [lost("Fees too high", "price"), lost("Joined another institute", "competition"), lost("Course not offered", "fit"), lost("Postponed to next year", "timing")],
  },
  {
    key: "manufacturing", name: "Manufacturing and B2B", description: "Makers and suppliers to businesses: RFQs, drawings, quotations, tenders and POs.",
    pipeline: { name: "B2B orders", stages: stages(["Enquiry / RFQ", "Technical discussion", "Quotation sent", "Negotiation", "PO expected"],
      ["Get the RFQ, drawing or specification", "Confirm specs, quantities, delivery and approvals needed", "Send the quotation with taxes, freight and validity", "Agree price, payment terms and delivery schedule", "Get the purchase order; plan production"]) },
    sources: ["Exhibition / trade fair", "Dealer referral", "Tender portal (GeM)"],
    fields: [
      { entityType: "opportunity", label: "RFQ / tender number", type: "text" },
      { entityType: "opportunity", label: "Delivery required by", type: "date" },
      { entityType: "opportunity", label: "Drawing / spec received", type: "checkbox" },
      { entityType: "party", label: "Our vendor code with them", type: "text" },
    ],
    lostReasons: [lost("Price higher than a competitor", "price"), lost("Specification not met", "fit"), lost("Delivery time too long", "timing"), lost("Order went to their existing vendor", "competition")],
  },
  {
    key: "clinic", name: "Clinics and healthcare", description: "Clinics, diagnostics and hospitals: consultations, treatment estimates and follow-ups.",
    pipeline: { name: "Patient enquiries", stages: stages(["Enquiry", "Consultation booked", "Consultation done", "Treatment plan / estimate shared", "Treatment expected"],
      ["Note the treatment asked about and a preferred time", "Confirm the appointment and send the location", "Record the doctor's advice", "Share the treatment plan, cost estimate and insurance help", "Fix the treatment date"]) },
    sources: ["Practo", "Google Maps", "Doctor referral", "Health camp"],
    fields: [
      { entityType: "lead", label: "Treatment / service", type: "text" },
      { entityType: "lead", label: "Age", type: "number" },
      { entityType: "lead", label: "Preferred doctor", type: "text" },
      { entityType: "lead", label: "Insurance / TPA", type: "text" },
    ],
    lostReasons: [lost("Cost too high", "price"), lost("Chose another clinic", "competition"), lost("Treatment not needed", "fit"), lost("Patient did not come", "no_response")],
  },
  {
    key: "services", name: "Professional services and agencies", description: "Consultants, agencies and IT services: requirement calls, proposals and retainers.",
    pipeline: { name: "Client engagements", stages: stages(["Enquiry", "Requirement call done", "Proposal sent", "Negotiation", "Engagement expected"],
      ["Understand the problem and the timeline", "Note the scope, the budget and who decides", "Send the proposal and the estimate", "Agree scope, price and payment milestones", "Get the signed agreement or the advance"]) },
    sources: ["LinkedIn", "Client referral", "Freelance portal"],
    fields: [
      { entityType: "lead", label: "Service needed", type: "text" },
      { entityType: "opportunity", label: "Engagement type", type: "select", options: ["One-time project", "Monthly retainer", "AMC"] },
      { entityType: "opportunity", label: "Expected start date", type: "date" },
    ],
    lostReasons: [lost("Budget too low", "budget"), lost("Chose another vendor", "competition"), lost("Scope not a fit", "fit"), lost("Project put on hold", "timing")],
  },
]);

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to set up CRM.", "PERMISSION_DENIED");
}

// What each pack sets up, for the Setup page.
export function listStarterPacks() {
  return STARTER_PACKS.map((pack) => ({
    key: pack.key, name: pack.name, description: pack.description, pipeline: pack.pipeline.name, stages: pack.pipeline.stages.map((stage) => stage.name),
    sources: pack.sources, fields: pack.fields.map((field) => ({ entityType: field.entityType, label: field.label })), lostReasons: pack.lostReasons.map((reason) => reason.name),
  }));
}

const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// Applies a pack. Returns what was added: { pipeline: { id, name, created, madeDefault }, sources, fields, lostReasons } (names).
export async function applyStarterPack(client, context, key) {
  requireManage(context);
  const pack = STARTER_PACKS.find((entry) => entry.key === key);
  if (!pack) throw new CrmError(404, "Choose one of the starter packs.", "CRM_STARTER_PACK_NOT_FOUND");
  const result = { pack: pack.name, pipeline: null, sources: [], fields: [], lostReasons: [] };

  const pipelines = (await client.query("SELECT id, name FROM tenant.crm_pipelines WHERE organization_id = $1", [context.organizationId])).rows;
  let pipeline = pipelines.find((row) => same(row.name, pack.pipeline.name));
  const created = !pipeline;
  if (!pipeline) pipeline = await createPipeline(client, context, { name: pack.pipeline.name, description: pack.description, stages: pack.pipeline.stages });
  // A company that has not made a single deal yet works in the pack's pipeline from the start.
  const noDeals = !(await client.query("SELECT 1 FROM tenant.crm_opportunities WHERE organization_id = $1 LIMIT 1", [context.organizationId])).rows[0];
  if (noDeals) await updatePipeline(client, context, pipeline.id, { isDefault: true });
  result.pipeline = { id: pipeline.id, name: pack.pipeline.name, created, madeDefault: noDeals };

  await ensureDefaultLeadSources(client, context);
  const sources = (await client.query("SELECT name FROM tenant.crm_lead_sources WHERE organization_id = $1", [context.organizationId])).rows;
  for (const name of pack.sources) {
    if (sources.some((row) => same(row.name, name))) continue;
    await createLeadSource(client, context, { name });
    result.sources.push(name);
  }

  const fields = (await client.query("SELECT entity_type, label FROM tenant.crm_custom_fields WHERE organization_id = $1 AND status = 'active'", [context.organizationId])).rows;
  for (const field of pack.fields) {
    if (fields.some((row) => row.entity_type === field.entityType && same(row.label, field.label))) continue;
    await createCustomField(client, context, field);
    result.fields.push(`${field.label} (${{ lead: "leads", opportunity: "deals", party: "companies", contact: "contacts" }[field.entityType]})`);
  }

  const reasons = (await client.query("SELECT name FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type = 'lost'", [context.organizationId])).rows;
  for (const reason of pack.lostReasons) {
    if (reasons.some((row) => same(row.name, reason.name))) continue;
    await createCloseReason(client, context, { outcome: "lost", name: reason.name, category: reason.category });
    result.lostReasons.push(reason.name);
  }
  return result;
}
