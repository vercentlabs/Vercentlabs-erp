import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Support — marketing content for the `support` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const SUPPORT_MODULE = Object.freeze({
  key: "support",
  displayName: "Support",
  purpose: "Customer tickets with ownership, categories, and conversation history.",
  navGroup: "people-and-service",
  personas: ["Support agents", "Support team leads", "Customer-facing managers"],
  painPoints: [
    "Customer issues lost in shared inboxes",
    "Nobody owns the ticket",
    "No history when a problem comes back",
  ],
  bestAngle:
    "Every customer issue becomes a numbered ticket with a category, priority, and owner — with customer replies, private notes, attachments, and a full history, and the ability to reopen it if the problem returns.",
  accentColor: { hex: "#b91c1c", soft: "#fdeded", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Support module manages customer tickets — numbered cases tied to customers and contacts, with categories, priorities, statuses, agent assignment, customer replies, private notes, attachments, ticket history, and reopening.",
  heroVariant: "operational-sequence",
  searchIntent: "Customer support ERP",
  metaDescription:
    "Vercentlabs Support manages numbered customer tickets with categories, priorities, statuses, agent assignment, customer replies, internal notes, attachments, history, and reopening.",
  businessProblems: [
    { title: "Issues lost in the inbox", description: "Customer problems arrive by email and phone and live in personal inboxes." },
    { title: "No clear owner", description: "Several people see a problem, and nobody is clearly responsible for fixing it." },
    { title: "Internal discussion mixed with customer replies", description: "Notes meant for colleagues end up in front of customers, or get lost entirely." },
    { title: "Starting from scratch every time", description: "When a problem comes back, nobody can see what happened last time." },
  ],
  businessOutcomes: [
    { title: "Every issue is a ticket", description: "Tickets get a number, a customer, a contact, a category, and a priority." },
    { title: "Clear ownership", description: "Agent assignment gives every ticket a responsible person." },
    { title: "The right words for the right audience", description: "Customer replies and internal private notes are kept separate." },
    { title: "History that carries forward", description: "Ticket history is kept, and a resolved ticket can be reopened." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "support-tickets",
      "Tickets",
      "Numbered tickets for each customer issue, linked to the customer and contact, and created manually by the team.",
      ["support-tickets", "support-ticket-number", "support-customer", "support-contact", "support-manual-ticket-creation"],
      "support-ticket-resolution",
    ),
    capabilityGroup(
      "support-triage",
      "Categorisation & ownership",
      "How tickets are classified, prioritised, tracked, and assigned.",
      ["support-category", "support-priority", "support-status", "support-agent-assignment"],
    ),
    capabilityGroup(
      "support-conversation-history",
      "Conversation & history",
      "Replies to the customer, private notes for the team, attachments, history, and reopening.",
      ["support-customer-replies", "support-internal-notes", "support-attachments", "support-ticket-history", "support-reopen-ticket"],
    ),
  ],
  primaryWorkflow: {
    name: "Ticket to Resolution",
    trigger: "A customer reports an issue.",
    steps: [
      { step: "Create", detail: "A numbered ticket is created for the customer and contact." },
      { step: "Classify", detail: "The ticket is given a category and priority." },
      { step: "Assign", detail: "The ticket is assigned to an agent." },
      { step: "Respond", detail: "The agent replies to the customer, using private notes for internal discussion." },
      { step: "Resolve or reopen", detail: "The ticket's status is updated as it's resolved; it can be reopened if the problem returns." },
    ],
    approvals: [],
    automatedActions: ["Ticket numbering", "Ticket history recorded on every change"],
    connectedModuleKeys: ["crm", "sales"],
    outcome: "A resolved ticket with its replies, notes, attachments, and history on record.",
  },
  connectedModules: [
    { moduleKey: "crm", relationship: "Tickets are logged against the same customers and contacts the revenue team works with." },
    { moduleKey: "sales", relationship: "Support and Sales share the same customer records, so agents work from one customer view." },
  ],
  reporting: [
    { name: "Ticket status", measures: "Tickets by status, priority, and assigned agent", audience: "Support team leads" },
  ],
  automation: [
    { title: "Ticket numbering", description: "Each new ticket gets its own ticket number automatically." },
    { title: "Ticket history", description: "Changes to a ticket are recorded in its history." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Ticket categories and priorities are agreed before go-live.",
    "Agents are set up with the right roles and permissions.",
    "You agree when a ticket is reopened rather than a new one created.",
  ],
  faqs: [
    { question: "Can agents add notes customers won't see?", answer: "Yes. Internal / private notes are kept separate from customer replies." },
    { question: "Can a resolved ticket be reopened?", answer: "Yes. A ticket can be reopened, and its full history stays with it." },
  ],
  screenshots: { primary: "support-ticket-list" },
  conversion: { heading: "See how Vercentlabs Support would manage your customer tickets.", ctaLabel: CTAS.talkToSpecialist.label },
});
