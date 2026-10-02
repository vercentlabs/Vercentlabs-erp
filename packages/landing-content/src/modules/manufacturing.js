import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Manufacturing — marketing content for the `manufacturing` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const MANUFACTURING_MODULE = Object.freeze({
  key: "manufacturing",
  displayName: "Manufacturing",
  purpose: "Bills of materials, manufacturing orders, and production execution.",
  navGroup: "operations",
  personas: ["Production planners", "Shop-floor supervisors", "Plant managers"],
  painPoints: [
    "Starting production without the materials",
    "Material usage tracked on paper",
    "Not knowing what a production run really cost",
  ],
  bestAngle:
    "A manufacturing order built from the bill of materials checks material availability, issues and consumes materials, records scrap, inspects production, and receives finished goods into stock with its production cost.",
  accentColor: { hex: "#c2410c", soft: "#fef0e7", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Manufacturing module turns bills of materials into manufacturing orders — checking material availability, issuing and consuming materials, recording scrap, inspecting and holding production, receiving finished goods, and costing the run.",
  heroVariant: "operational-sequence",
  searchIntent: "Manufacturing ERP",
  metaDescription:
    "Vercentlabs Manufacturing runs BOM-based manufacturing orders with material availability, material issue and consumption, scrap, production inspections and holds, finished-goods receipt, and production costing.",
  businessProblems: [
    { title: "Production starts without the parts", description: "A job is started, then stalls because a component was never in stock." },
    { title: "Material use is a guess", description: "What was actually consumed and scrapped is reconstructed afterwards from paper notes." },
    { title: "Quality problems found too late", description: "Production issues surface at dispatch instead of while the order is still running." },
    { title: "Unknown production cost", description: "Nobody can say what a finished batch actually cost to make." },
  ],
  businessOutcomes: [
    { title: "Materials checked before work starts", description: "Material availability is checked against the bill of materials for each manufacturing order." },
    { title: "Real consumption on record", description: "Material issue, consumption, and scrap are recorded against the order." },
    { title: "Quality built into production", description: "Production inspections and production holds stop problem output from moving on." },
    { title: "A cost for every order", description: "Production costing shows what each manufacturing order cost." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "manufacturing-planning",
      "BOMs & manufacturing orders",
      "What a product is made from, and the orders that make it — checked against available materials.",
      ["manufacturing-bill-of-materials", "manufacturing-manufacturing-orders", "manufacturing-material-availability"],
      "plan-to-production",
    ),
    capabilityGroup(
      "manufacturing-execution",
      "Production execution",
      "Materials issued and consumed, scrap recorded, and finished goods received into stock.",
      ["manufacturing-material-issue", "manufacturing-material-consumption", "manufacturing-scrap", "manufacturing-finished-goods-receipt"],
    ),
    capabilityGroup(
      "manufacturing-quality-costing",
      "Production quality & costing",
      "Inspections and holds during production, and the cost of each order.",
      ["manufacturing-production-quality-inspections", "manufacturing-production-hold", "manufacturing-production-costing"],
    ),
  ],
  primaryWorkflow: {
    name: "BOM to Finished Goods",
    trigger: "Finished goods need to be produced.",
    steps: [
      { step: "Plan", detail: "A manufacturing order is created from the item's bill of materials." },
      { step: "Check materials", detail: "Material availability is checked before production starts." },
      { step: "Issue and consume", detail: "Materials are issued from stock and consumption is recorded, including any scrap." },
      { step: "Inspect", detail: "Production quality inspections check the output; a production hold stops it if needed." },
      { step: "Receive", detail: "Finished goods are received into stock, and the order's production cost is recorded." },
    ],
    approvals: [],
    automatedActions: ["Material availability check", "Stock postings for material issue and finished-goods receipt"],
    connectedModuleKeys: ["stock", "quality"],
    outcome: "Finished goods in stock, with their materials, scrap, inspection results, and cost on record.",
  },
  connectedModules: [
    { moduleKey: "stock", relationship: "Material issues take components out of stock and finished-goods receipts bring products in, on the same ledger." },
    { moduleKey: "quality", relationship: "Production quality inspections and holds use the Quality module's inspection and hold controls." },
  ],
  reporting: [
    { name: "Production costing", measures: "Material and production cost per manufacturing order", audience: "Plant managers, finance" },
  ],
  automation: [
    { title: "Material availability", description: "Each manufacturing order shows whether its materials are available before work starts." },
    { title: "Stock postings", description: "Material issues and finished-goods receipts post to the stock ledger as they're recorded." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Bills of materials are set up for each manufactured item before go-live.",
    "Component items and opening stock must already be in the Inventory module.",
    "Production inspection points are agreed with the quality team.",
  ],
  faqs: [
    { question: "Can a manufacturing order check materials before production starts?", answer: "Yes. Material availability is checked against the bill of materials for each manufacturing order." },
    { question: "Is scrap recorded?", answer: "Yes. Scrap is recorded against the manufacturing order alongside material consumption." },
    { question: "Does Vercentlabs include MRP or capacity planning?", answer: "No. The launch product covers BOM-based manufacturing orders and execution; MRP runs and capacity scheduling are not part of it." },
  ],
  screenshots: { primary: "manufacturing-production-orders" },
  conversion: { heading: "See how Vercentlabs Manufacturing would run your production orders.", ctaLabel: CTAS.talkToSpecialist.label },
});
