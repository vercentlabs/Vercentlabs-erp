import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Inventory — marketing content for the `stock` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const STOCK_MODULE = Object.freeze({
  key: "stock",
  displayName: "Inventory",
  purpose: "Items, warehouses, stock movements, balances, and valuation.",
  navGroup: "operations",
  personas: ["Warehouse and inventory staff", "Inventory controllers", "Operations managers"],
  painPoints: [
    "Stock counts that never match the system",
    "Items sold or issued that aren't there",
    "No record of who moved what",
  ],
  bestAngle:
    "Every receipt, issue, transfer, and adjustment posts to one stock ledger, so balances, reservations, and valuation stay current — and quality-held stock can't be moved.",
  accentColor: { hex: "#a16207", soft: "#fefce8", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Inventory module is the stock ledger: items and SKUs in multiple units of measure across warehouses, with real-time balances, receipts, issues, transfers, adjustments, reservations, physical counts, and valuation.",
  heroVariant: "dashboard-led",
  searchIntent: "Inventory and warehouse ERP",
  metaDescription:
    "Vercentlabs Inventory keeps a real-time stock ledger across warehouses — receipts, issues, transfers, adjustments, reservations, physical counts, negative-stock control, and inventory valuation.",
  businessProblems: [
    { title: "The system and the shelf disagree", description: "Balances are updated by hand or at day-end, so what the system says and what's on the shelf drift apart." },
    { title: "Selling what isn't there", description: "Stock is issued or promised without a reliable view of what's actually available." },
    { title: "No trail of movements", description: "When a count is off, nobody can see which receipt, issue, or transfer caused it." },
    { title: "Held stock gets used anyway", description: "Goods waiting on a quality decision are picked and shipped because nothing stops the movement." },
  ],
  businessOutcomes: [
    { title: "Balances you can trust", description: "Every movement posts to the stock ledger, so on-hand and available stock are current." },
    { title: "Control over what goes out", description: "Reservations and negative-stock control stop the same units being promised or issued twice." },
    { title: "A full movement history", description: "Every receipt, issue, transfer, and adjustment is in the inventory movement history." },
    { title: "Held stock stays put", description: "Stock under a quality hold is quarantined and blocked from moving until it's released." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "stock-items-warehouses",
      "Items & warehouses",
      "What you stock, how it's measured, and where it's kept.",
      ["stock-item-master", "stock-skus", "stock-multiple-uom", "stock-warehouses"],
    ),
    capabilityGroup(
      "stock-movements",
      "Stock movements",
      "Every way stock comes in, goes out, moves between warehouses, or is corrected.",
      ["stock-goods-receipts", "stock-goods-issues", "stock-internal-transfers", "stock-stock-adjustments", "stock-physical-inventory"],
      "order-to-fulfilment",
    ),
    capabilityGroup(
      "stock-balances-control",
      "Balances & control",
      "Real-time balances, reservations, and the controls that keep stock from being double-promised or moved when it shouldn't be.",
      ["stock-real-time-stock-balance", "stock-stock-reservations", "stock-available-stock", "stock-negative-stock-control", "stock-quarantine-quality-held-stock"],
    ),
    capabilityGroup(
      "stock-ledger-valuation",
      "Ledger, history & valuation",
      "The stock ledger behind every balance, the movement history, and the value of what you hold.",
      ["stock-stock-ledger", "stock-inventory-movement-history", "stock-inventory-valuation"],
    ),
  ],
  primaryWorkflow: {
    name: "Receipt to Issue",
    trigger: "Goods arrive from a supplier or from production.",
    steps: [
      { step: "Receive", detail: "A goods receipt brings items into a warehouse and posts to the stock ledger." },
      { step: "Store and transfer", detail: "Stock is held in a warehouse and moved between warehouses with internal transfers." },
      { step: "Reserve", detail: "Stock is reserved for confirmed demand so it isn't promised twice." },
      { step: "Issue", detail: "A goods issue moves stock out; negative-stock control prevents issuing more than is available." },
      { step: "Value", detail: "Inventory valuation reflects the movements as they post." },
    ],
    approvals: [],
    automatedActions: ["Real-time balance update on every movement", "Negative-stock control", "Quality-hold movement blocking"],
    connectedModuleKeys: ["sales", "procurement", "manufacturing", "point-of-sale", "quality"],
    outcome: "Current, traceable stock balances and valuation across every warehouse.",
  },
  connectedModules: [
    { moduleKey: "procurement", relationship: "Goods receipts against purchase orders bring stock into the warehouse." },
    { moduleKey: "sales", relationship: "Sales orders check availability and reserve stock from the same balances." },
    { moduleKey: "manufacturing", relationship: "Material issues and finished-goods receipts from production post to the same stock ledger." },
    { moduleKey: "point-of-sale", relationship: "POS sales reduce stock in real time." },
    { moduleKey: "quality", relationship: "A quality hold quarantines stock and blocks it from moving until it's released." },
  ],
  reporting: [
    { name: "Stock balances", measures: "On-hand, reserved, and available stock by item and warehouse", audience: "Warehouse and operations managers" },
    { name: "Inventory movement history", measures: "Every receipt, issue, transfer, and adjustment", audience: "Inventory controllers, auditors" },
  ],
  automation: [
    { title: "Real-time balances", description: "Balances update as each movement posts — no day-end recalculation." },
    { title: "Negative-stock control", description: "Issues that would take stock below zero are blocked unless the business explicitly allows it." },
    { title: "Quality-hold blocking", description: "Stock under a quality hold can't be moved until the hold is released." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Items, SKUs, units of measure, and warehouses are set up before opening balances are loaded.",
    "Opening stock is loaded and checked with a physical count before go-live.",
    "You decide whether negative stock is ever allowed.",
  ],
  faqs: [
    { question: "Can Vercentlabs stop stock going negative?", answer: "Yes. Negative-stock control blocks issues that would take a balance below zero, unless the business explicitly allows negative stock." },
    { question: "How are stock counts reconciled?", answer: "Physical inventory counts are recorded against system balances, and the difference is posted as a stock adjustment with its own movement history." },
    { question: "What happens to stock that fails a quality check?", answer: "It's held in quarantine, and the quality hold blocks it from being moved until the hold is released." },
  ],
  screenshots: { primary: "inventory-stock-valuation" },
  conversion: { heading: "See how Vercentlabs Inventory would keep your stock accurate.", ctaLabel: CTAS.talkToSpecialist.label },
});
