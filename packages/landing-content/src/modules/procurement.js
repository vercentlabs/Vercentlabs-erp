import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Procurement — marketing content for the `procurement` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const PROCUREMENT_MODULE = Object.freeze({
  key: "procurement",
  displayName: "Procurement",
  purpose: "Suppliers, purchase orders, goods receipts, and invoice matching.",
  navGroup: "operations",
  personas: ["Purchasing managers", "Buyers", "Receiving clerks", "Accounts payable staff"],
  painPoints: [
    "Purchase orders tracked in email",
    "Paying for goods that never arrived",
    "Rejected deliveries with no record",
  ],
  bestAngle:
    "A purchase order is received against a goods receipt, rejected quantities are recorded, and the supplier invoice is checked against the order and receipt before it's paid.",
  accentColor: { hex: "#087f6a", soft: "#eaf8f4", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Procurement module manages suppliers, purchase orders, goods receipts and rejected receipts, and supplier invoices checked with 2-way or 3-way matching before payment.",
  heroVariant: "operational-sequence",
  searchIntent: "Procurement ERP software",
  metaDescription:
    "Vercentlabs Procurement manages suppliers, purchase orders, goods receipts, rejected receipts, and supplier invoices with 2-way and 3-way matching — in one connected purchasing flow.",
  businessProblems: [
    { title: "Orders live in email threads", description: "What was ordered, from whom, and at what price is scattered across inboxes and spreadsheets." },
    { title: "Paying for what didn't arrive", description: "A supplier invoice is paid without anyone checking it against what was ordered and received." },
    { title: "Rejected goods go unrecorded", description: "Damaged or wrong deliveries are sent back, but the rejection never reaches the record finance uses." },
    { title: "Supplier details drift", description: "Contacts, addresses, and terms for the same supplier differ between purchasing and accounts." },
  ],
  businessOutcomes: [
    { title: "One record per supplier", description: "Supplier master data, contacts, addresses, and payment terms are shared by purchasing and finance." },
    { title: "Receipts tied to orders", description: "Goods receipts are recorded against purchase orders, including any rejected quantities." },
    { title: "Invoices checked before payment", description: "Supplier invoices are matched against the order (2-way) or the order and receipt (3-way)." },
    { title: "A clean handoff to Accounting", description: "Matched supplier invoices flow to Accounting for posting and payment." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "procurement-suppliers",
      "Suppliers",
      "The suppliers you buy from, with their contacts, addresses, and agreed payment terms.",
      ["procurement-supplier-master", "procurement-supplier-contacts-addresses", "procurement-payment-terms"],
    ),
    capabilityGroup(
      "procurement-orders-receiving",
      "Purchase orders & receiving",
      "Purchase orders, and the goods receipts recorded against them — including deliveries that are rejected.",
      ["procurement-purchase-orders", "procurement-goods-receipt", "procurement-rejected-receipts"],
      "procure-to-pay",
    ),
    capabilityGroup(
      "procurement-invoices-matching",
      "Supplier invoices & matching",
      "Supplier invoices checked against the order and receipt before they're approved for payment.",
      ["procurement-supplier-invoices", "procurement-two-way-matching", "procurement-three-way-matching"],
    ),
  ],
  primaryWorkflow: {
    name: "Purchase Order to Matched Invoice",
    trigger: "The business needs to buy goods or services from a supplier.",
    steps: [
      { step: "Order", detail: "A purchase order is raised to the supplier with quantities, prices, and payment terms." },
      { step: "Receive", detail: "A goods receipt (GRN) records what arrived; rejected quantities are recorded separately." },
      { step: "Invoice", detail: "The supplier's invoice is recorded against the order." },
      { step: "Match", detail: "The invoice is matched 2-way against the order, or 3-way against the order and the goods receipt." },
    ],
    approvals: [],
    automatedActions: ["2-way and 3-way invoice matching"],
    connectedModuleKeys: ["stock", "accounting"],
    outcome: "A supplier invoice that agrees with what was ordered and received, ready for posting and payment in Accounting.",
  },
  connectedModules: [
    { moduleKey: "stock", relationship: "Goods receipts bring purchased items into stock on the same item and warehouse records." },
    { moduleKey: "accounting", relationship: "Matched supplier invoices are posted to accounts payable and paid from Accounting." },
    { moduleKey: "quality", relationship: "Incoming inspections can check received goods before they are accepted into usable stock." },
  ],
  reporting: [
    { name: "Matching status", measures: "Which supplier invoices agree with their order and receipt", audience: "Accounts payable, purchasing managers" },
  ],
  automation: [
    { title: "Invoice matching", description: "Supplier invoices are compared with the purchase order, or the order and goods receipt, before payment." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Supplier master data, contacts, and payment terms are set up before go-live as part of data migration.",
    "You decide which purchases are matched 2-way and which need a goods receipt for 3-way matching.",
    "Receiving staff are trained to record rejected quantities on the goods receipt.",
  ],
  faqs: [
    { question: "What's the difference between 2-way and 3-way matching?", answer: "2-way matching checks the supplier invoice against the purchase order; 3-way matching also checks it against the goods receipt, so you only pay for what actually arrived." },
    { question: "What happens when a delivery is rejected?", answer: "Rejected quantities are recorded as rejected receipts against the purchase order, so they aren't treated as received stock or paid for." },
  ],
  screenshots: { primary: "procurement-purchase-order-list" },
  conversion: { heading: "See how Vercentlabs Procurement would run your purchase-to-invoice process.", ctaLabel: CTAS.talkToSpecialist.label },
});
