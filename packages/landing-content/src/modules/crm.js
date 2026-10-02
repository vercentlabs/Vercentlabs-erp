import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * CRM — marketing content for the `crm` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const CRM_MODULE = Object.freeze({
  key: "crm",
  displayName: "CRM",
  purpose: "Leads, accounts, contacts, and a staged opportunity pipeline.",
  navGroup: "revenue",
  personas: ["Sales reps and managers", "Sales operations", "Business owners"],
  painPoints: [
    "Leads and follow-ups tracked in spreadsheets and inboxes",
    "Duplicate customer records",
    "No shared view of the pipeline",
  ],
  bestAngle:
    "A lead is assigned, qualified, and moved through clear stages, then converted into an opportunity that progresses through the pipeline and becomes a Sales quotation — without re-typing the customer.",
  accentColor: { hex: "#6956d9", soft: "#f2efff", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs CRM module is the revenue team's system of record for leads, accounts, contacts, and opportunities — from first contact through qualification and a governed sales pipeline to a quotation in Sales.",
  heroVariant: "screenshot-led",
  searchIntent: "CRM ERP",
  metaDescription:
    "Vercentlabs CRM manages leads, accounts, contacts, and opportunities — with assignment, qualification, duplicate detection, a staged pipeline, and conversion into Sales quotations.",
  businessProblems: [
    { title: "Follow-ups slip through the cracks", description: "A lead lives in someone's inbox or spreadsheet, and nobody notices when the promised call-back never happens." },
    { title: "The same customer exists three times", description: "Leads, accounts, and contacts get re-typed by different people, and the duplicates quietly split the customer's history." },
    { title: "Nobody can see the real pipeline", description: "Deals are tracked in personal lists, so managers can't see which opportunities are at which stage." },
    { title: "Won deals are re-keyed into quotations", description: "When a deal is ready, the customer and product details are typed again into a separate quoting tool." },
  ],
  businessOutcomes: [
    { title: "Every lead has an owner and a next step", description: "Leads are assigned to a person, and tasks and follow-up reminders keep the next action visible." },
    { title: "One record per customer", description: "Duplicate detection flags likely matches before a second copy of a lead, account, or contact is created." },
    { title: "A pipeline everyone reads the same way", description: "Opportunities move through defined sales stages, with won and lost reasons recorded when they close." },
    { title: "Quotations start from the opportunity", description: "An opportunity converts into a Sales quotation, so the customer details carry straight through." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "crm-leads-and-qualification",
      "Leads & qualification",
      "Capture leads, give each one an owner, and qualify them through clear stages before they become opportunities.",
      ["crm-leads", "crm-lead-assignment", "crm-lead-qualification", "crm-lead-stages-statuses", "crm-duplicate-detection", "crm-lead-to-opportunity-conversion"],
      "lead-to-cash",
    ),
    capabilityGroup(
      "crm-accounts-contacts",
      "Accounts & contacts",
      "The companies you sell to and the people you deal with, kept as single shared records.",
      ["crm-accounts", "crm-contacts"],
    ),
    capabilityGroup(
      "crm-opportunities-pipeline",
      "Opportunities & pipeline",
      "Deals tracked through defined sales stages to a won or lost outcome, and handed to Sales as a quotation.",
      ["crm-opportunities", "crm-opportunity-pipeline", "crm-sales-stages", "crm-won-lost-reasons", "crm-opportunity-to-quotation-conversion"],
    ),
    capabilityGroup(
      "crm-activity",
      "Tasks, follow-ups & notes",
      "The day-to-day work around each lead and deal, attached to the record it belongs to.",
      ["crm-tasks", "crm-follow-ups-reminders", "crm-notes-attachments"],
    ),
  ],
  primaryWorkflow: {
    name: "Lead to Quotation",
    trigger: "A new lead is entered or imported.",
    steps: [
      { step: "Capture and check", detail: "The lead is recorded, and likely duplicates are flagged before a second copy is created." },
      { step: "Assign", detail: "The lead is assigned to an owner who is responsible for the next step." },
      { step: "Qualify", detail: "The lead moves through its stages and statuses as it is qualified." },
      { step: "Convert", detail: "A qualified lead converts into an opportunity, linked to its account and contact." },
      { step: "Progress and quote", detail: "The opportunity moves through the sales stages and converts into a Sales quotation." },
    ],
    approvals: [],
    automatedActions: ["Duplicate detection on entry", "Follow-up reminders"],
    connectedModuleKeys: ["sales"],
    outcome: "A qualified opportunity, with its lead and activity history attached, ready to be quoted in Sales.",
  },
  connectedModules: [
    { moduleKey: "sales", relationship: "An opportunity converts into a Sales quotation, carrying the customer and deal context with it." },
    { moduleKey: "support", relationship: "Support tickets are logged against the same customers and contacts the revenue team works with." },
  ],
  reporting: [
    { name: "Opportunity pipeline", measures: "Open opportunities by sales stage", audience: "Sales managers" },
    { name: "Won and lost reasons", measures: "Why deals closed the way they did", audience: "Sales leadership" },
  ],
  automation: [
    { title: "Duplicate detection", description: "Likely duplicate leads, accounts, and contacts are flagged instead of being created silently." },
    { title: "Follow-up reminders", description: "Scheduled follow-ups remind the owner when the next action is due." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Lead stages, sales stages, and won/lost reasons are configured to match your actual sales process.",
    "Existing leads can be brought in with CSV import (analyze, preview, commit, and rollback), and duplicate detection flags likely matches.",
    "Roles and permissions are set up so each person sees the records they are responsible for.",
  ],
  faqs: [
    { question: "Can a CRM opportunity become a Sales quotation directly?", answer: "Yes. Opportunity-to-quotation conversion creates the quotation in Sales from the opportunity, so the customer details aren't re-typed." },
    { question: "How does Vercentlabs CRM handle duplicate records?", answer: "Duplicate detection flags likely matching leads, accounts, and contacts, so a second copy isn't created by accident." },
    { question: "Can we record why deals are won or lost?", answer: "Yes. Won and lost reasons are captured when an opportunity closes, so the pattern behind outcomes stays visible." },
  ],
  screenshots: { primary: "crm-opportunity-pipeline" },
  conversion: { heading: "See how Vercentlabs CRM would manage your lead-to-opportunity process.", ctaLabel: CTAS.talkToSpecialist.label },
});
