import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Assets — marketing content for the `assets` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const ASSETS_MODULE = Object.freeze({
  key: "assets",
  displayName: "Assets",
  purpose: "An asset register with custody, maintenance, and depreciation.",
  navGroup: "finance",
  personas: ["Facilities and operations managers", "Maintenance staff", "Finance and asset controllers"],
  painPoints: [
    "Not knowing where assets are or who has them",
    "Maintenance tracked informally",
    "Depreciation calculated in spreadsheets",
  ],
  bestAngle:
    "Every asset is registered and identified, assigned to a custodian and location, moved and maintained on record, depreciated on a straight-line schedule, and disposed of with a full history.",
  accentColor: { hex: "#4d7c0f", soft: "#f2f8e8", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Assets module is the asset register — categorised, identified assets with locations and custodians, capitalization, transfers and assignment, movement history, maintenance, straight-line depreciation, and disposal.",
  heroVariant: "operational-sequence",
  searchIntent: "Asset management ERP",
  metaDescription:
    "Vercentlabs Assets keeps an asset register with categories, codes, locations, custodians, capitalization, transfers, maintenance, straight-line depreciation schedules, and disposal.",
  businessProblems: [
    { title: "Assets nobody can find", description: "Equipment moves between sites and people, and the register stops matching reality." },
    { title: "Unclear custody", description: "When something is lost or damaged, nobody can say who was responsible for it." },
    { title: "Maintenance by memory", description: "Servicing happens when someone remembers, not on record." },
    { title: "Depreciation in a spreadsheet", description: "Book values are calculated outside the system and drift from the register." },
  ],
  businessOutcomes: [
    { title: "A register that matches reality", description: "Each asset has a category, identification code, location, and custodian." },
    { title: "Clear custody and movement", description: "Assignments, transfers, and the asset movement history show who had what and when." },
    { title: "Maintenance on record", description: "Asset maintenance is recorded against the asset it was done on." },
    { title: "Depreciation from the register", description: "Straight-line depreciation and the depreciation schedule are calculated from the asset's own record." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "assets-register",
      "Asset register",
      "What you own, how it's classified and identified, and where it is.",
      ["assets-asset-register", "assets-asset-categories", "assets-asset-identification-code", "assets-asset-location", "assets-purchase-capitalization"],
    ),
    capabilityGroup(
      "assets-custody",
      "Custody & movement",
      "Who holds each asset, and every move it makes.",
      ["assets-custodian", "assets-asset-assignment", "assets-asset-transfers", "assets-asset-movement-history"],
    ),
    capabilityGroup(
      "assets-lifecycle-value",
      "Maintenance, depreciation & disposal",
      "Keeping assets in service, writing their value down, and retiring them.",
      ["assets-asset-maintenance", "assets-straight-line-depreciation", "assets-depreciation-schedule", "assets-asset-disposal"],
    ),
  ],
  primaryWorkflow: {
    name: "Acquisition to Disposal",
    trigger: "The business acquires an asset.",
    steps: [
      { step: "Capitalize", detail: "The purchased asset is capitalized and added to the register with its category and code." },
      { step: "Assign", detail: "The asset is assigned to a custodian at a location." },
      { step: "Move and maintain", detail: "Transfers and maintenance are recorded in the asset's history." },
      { step: "Depreciate", detail: "Straight-line depreciation follows the asset's depreciation schedule." },
      { step: "Dispose", detail: "The asset is disposed of, closing its record with a complete history." },
    ],
    approvals: [],
    automatedActions: ["Straight-line depreciation schedule calculation"],
    connectedModuleKeys: ["accounting"],
    outcome: "An asset whose location, custody, maintenance, and book value are on record from acquisition to disposal.",
  },
  connectedModules: [
    { moduleKey: "accounting", relationship: "Capitalized assets and their depreciation sit alongside the books kept in Accounting." },
    { moduleKey: "hr-payroll", relationship: "Custodians are the same employees managed in HR & Payroll." },
  ],
  reporting: [
    { name: "Depreciation schedule", measures: "Planned straight-line depreciation per asset", audience: "Finance and asset controllers" },
    { name: "Asset movement history", measures: "Assignments and transfers over time", audience: "Operations managers, auditors" },
  ],
  automation: [
    { title: "Depreciation schedules", description: "The straight-line depreciation schedule is calculated from the asset's cost and useful life." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Asset categories and identification codes are agreed before the register is loaded.",
    "Existing assets are loaded into the register with their location, custodian, and capitalization details.",
    "Depreciation settings are agreed with finance before go-live.",
  ],
  faqs: [
    { question: "Which depreciation method does Vercentlabs Assets use?", answer: "Straight-line depreciation, with a depreciation schedule for each asset." },
    { question: "Can we see who had an asset and when?", answer: "Yes. Assignments and transfers are recorded in the asset movement history." },
  ],
  screenshots: {},
  conversion: { heading: "See how Vercentlabs Assets would keep your asset register accurate.", ctaLabel: CTAS.talkToSpecialist.label },
});
