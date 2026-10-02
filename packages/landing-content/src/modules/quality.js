import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Quality — marketing content for the `quality` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const QUALITY_MODULE = Object.freeze({
  key: "quality",
  displayName: "Quality",
  purpose: "Specifications, inspections, quality holds, and non-conformance.",
  navGroup: "operations",
  personas: ["Quality inspectors", "Quality managers", "Warehouse and production leads"],
  painPoints: [
    "Inspections recorded on paper",
    "Failed goods used anyway",
    "No record of what was done about a defect",
  ],
  bestAngle:
    "Inspections at incoming, in-process, and final control points record pass/fail results; failures raise a non-conformance report and a quality hold that blocks the stock from moving until it's released and dispositioned.",
  accentColor: { hex: "#166534", soft: "#f0fdf4", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Quality module runs inspections — specifications and control points for incoming, in-process, and final inspection, pass/fail results, non-conformance reports, quality holds that block stock movement, hold release, and disposition.",
  heroVariant: "operational-sequence",
  searchIntent: "Quality management ERP",
  metaDescription:
    "Vercentlabs Quality records incoming, in-process, and final inspections, raises non-conformance reports, and places quality holds that block stock movement until release and disposition.",
  businessProblems: [
    { title: "Inspections on clipboards", description: "Results are written on paper and never reach the system the warehouse and production use." },
    { title: "Failed goods get used", description: "Nothing stops stock that failed inspection from being picked, issued, or shipped." },
    { title: "Defects without a record", description: "When something fails, there's no formal report of what was wrong and what was decided." },
    { title: "Inconsistent checks", description: "Each inspector checks different things because the specification isn't written down." },
  ],
  businessOutcomes: [
    { title: "Inspections in the system", description: "Inspection results are recorded against the specification and control point." },
    { title: "Held stock can't move", description: "A quality hold blocks stock movement until the hold is released." },
    { title: "A formal record of defects", description: "Non-conformance reports document what failed, and disposition records what was done about it." },
    { title: "Consistent checks", description: "Inspection specifications define what's checked at each control point." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "quality-specifications",
      "Specifications & control points",
      "What gets checked, and where in the process it gets checked.",
      ["quality-inspection-specifications", "quality-quality-control-points"],
    ),
    capabilityGroup(
      "quality-inspections",
      "Inspections",
      "Incoming, in-process, and final inspections with pass/fail checks and recorded results.",
      ["quality-incoming-inspection", "quality-in-process-inspection", "quality-final-inspection", "quality-pass-fail-checks", "quality-inspection-results"],
    ),
    capabilityGroup(
      "quality-holds-ncr",
      "Holds, NCR & disposition",
      "What happens when something fails: a formal report, a hold that stops the stock, and a decision on what to do with it.",
      ["quality-non-conformance-report", "quality-quality-hold", "quality-quality-hold-blocks-stock-movement", "quality-hold-release", "quality-disposition"],
    ),
  ],
  primaryWorkflow: {
    name: "Inspection to Disposition",
    trigger: "Goods reach a quality control point — on receipt, during production, or before dispatch.",
    steps: [
      { step: "Inspect", detail: "The inspection is carried out against its specification, with pass/fail checks." },
      { step: "Record", detail: "Inspection results are recorded at the control point." },
      { step: "Raise and hold", detail: "A failure raises a non-conformance report and places a quality hold that blocks stock movement." },
      { step: "Release or dispose", detail: "The hold is released, and the disposition of the affected goods is recorded." },
    ],
    approvals: [],
    automatedActions: ["Stock movement blocked while a quality hold is active"],
    connectedModuleKeys: ["stock", "procurement", "manufacturing"],
    outcome: "Inspected goods with results on record — and failed goods held, reported, and dispositioned.",
  },
  connectedModules: [
    { moduleKey: "stock", relationship: "A quality hold quarantines the affected stock and blocks it from moving until it's released." },
    { moduleKey: "procurement", relationship: "Incoming inspections check goods received from suppliers." },
    { moduleKey: "manufacturing", relationship: "In-process and final inspections check production output." },
  ],
  reporting: [
    { name: "Inspection results", measures: "Pass and fail outcomes by control point", audience: "Quality managers" },
    { name: "Non-conformance reports", measures: "Open and closed NCRs and their disposition", audience: "Quality and operations managers" },
  ],
  automation: [
    { title: "Quality-hold stock blocking", description: "Stock under an active quality hold can't be moved until the hold is released." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Inspection specifications and control points are defined before go-live.",
    "You agree who can release quality holds and record dispositions.",
    "Incoming, in-process, and final inspection points are mapped to your receiving and production process.",
  ],
  faqs: [
    { question: "Can failed stock still be moved?", answer: "No. A quality hold blocks stock movement until the hold is released." },
    { question: "What happens after an inspection fails?", answer: "A non-conformance report records the failure, a quality hold stops the stock, and the disposition records what was done with it." },
  ],
  screenshots: { primary: "quality-inspection-list" },
  conversion: { heading: "See how Vercentlabs Quality would run your inspections and holds.", ctaLabel: CTAS.talkToSpecialist.label },
});
