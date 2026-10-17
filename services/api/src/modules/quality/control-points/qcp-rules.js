// Quality — Quality Control Points: errors and their user-facing messages, permissions, the supported trigger events and gates, the
// lifecycle, the validation of a version and its content hash. A control point decides when a quality check applies; the specification
// defines the criteria and the inspection records reality.
import { createHash } from "node:crypto";

export const QCP = Object.freeze({
  view: "quality.qcp.view", create: "quality.qcp.create", editDraft: "quality.qcp.edit_draft", copy: "quality.qcp.copy", submit: "quality.qcp.submit", review: "quality.qcp.review",
  approve: "quality.qcp.approve", activate: "quality.qcp.activate", revise: "quality.qcp.revise", retire: "quality.qcp.retire", manageGate: "quality.qcp.manage_gate",
  requestWaiver: "quality.qcp.request_waiver", approveWaiver: "quality.qcp.approve_waiver", reevaluate: "quality.qcp.reevaluate", history: "quality.qcp.view_history", export: "quality.qcp.export",
});

const MESSAGES = Object.freeze({
  QUALITY_QCP_STAGE_INVALID: "Select a supported inspection stage.",
  QUALITY_QCP_TRIGGER_UNAVAILABLE: "This inspection trigger is not enabled for the selected workflow.",
  QUALITY_QCP_SPEC_MISSING: "Select an approved Inspection Specification.",
  QUALITY_QCP_SPEC_INCOMPATIBLE: "This specification does not match the selected inspection stage.",
  QUALITY_QCP_APPLICABILITY_INVALID: "Review the product, supplier or location rules.",
  QUALITY_QCP_RULE_CONFLICT: "Multiple incompatible control points apply.",
  QUALITY_QCP_APPROVAL_REQUIRED: "This control point needs Quality approval.",
  QUALITY_QCP_VERSION_IMMUTABLE: "Create a new revision to change this approved rule.",
  QUALITY_QCP_NOT_EFFECTIVE: "This rule is not yet effective.",
  QUALITY_QCP_SOURCE_INVALID: "This transaction cannot be evaluated for the selected control point.",
  QUALITY_QCP_REQUIREMENT_ALREADY_EXISTS: "The Quality requirement already exists for this source.",
  QUALITY_QCP_GATE_ACTIVE: "This transaction is awaiting required Quality clearance.",
  QUALITY_QCP_WAIVER_NOT_AUTHORIZED: "You cannot waive this Quality requirement.",
  QUALITY_QCP_INVENTORY_HOLD_PENDING: "The stock restriction needs reconciliation before normal use.",
  QUALITY_QCP_COMPANY_MISMATCH: "This source belongs to another Company.",
  QUALITY_QCP_RECOVERY_REQUIRED: "The previous Quality operation is being checked. Do not resubmit it.",
  QUALITY_QCP_PERMISSION_DENIED: "You are not authorized for this action.",
  QUALITY_QCP_NOT_FOUND: "That quality control point was not found.",
  QUALITY_QCP_STATE: "This control point cannot do that in its current state.",
  QUALITY_QCP_SELF_APPROVAL: "You prepared or submitted this version, so someone else must approve it.",
  QUALITY_QCP_VERSION_CONFLICT: "This control point changed. Refresh and review.",
  QUALITY_QCP_INVALID: "Review the highlighted details.",
  QUALITY_QCP_REASON_REQUIRED: "Give a reason.",
});
export class QualityQcpError extends Error {
  constructor(status, code, message, details) {
    super(message || MESSAGES[code] || "The quality control point request could not be completed.");
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const qcpError = (status, code, message, details) => new QualityQcpError(status, code, message, details);
export const qcpMessage = (code) => MESSAGES[code] ?? code;
export const has = (c, p) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p));
export const need = (c, ...list) => {
  if (!list.some((p) => has(c, p))) throw qcpError(403, "QUALITY_QCP_PERMISSION_DENIED");
};

export const STAGES = Object.freeze({ INCOMING: "Incoming goods", IN_PROCESS: "In-process", FINAL: "Final inspection", PRE_DISPATCH: "Pre-dispatch", RETURN: "Customer return", MANUAL: "Manual / ad hoc" });
// The source events a control point may react to, and whether each is connected end to end (source, inspection and gate). Only enabled
// triggers can be published: a mandatory rule must never appear to protect a workflow it cannot enforce.
export const TRIGGERS = Object.freeze({
  INVENTORY_GOODS_RECEIPT_CONFIRMED: { stage: "INCOMING", label: "Goods receipt posted", enabled: true, gates: ["NONE", "HOLD_STOCK"] },
  QUALITY_MANUAL_INSPECTION_REQUESTED: { stage: "MANUAL", label: "Inspection requested by Quality", enabled: true, gates: ["NONE"] },
  PRODUCTION_OPERATION_READY_FOR_QC: { stage: "IN_PROCESS", label: "Production operation ready for QC", enabled: false, gates: ["NONE", "BLOCK_PRODUCTION_PROGRESS"] },
  PRODUCTION_OUTPUT_READY_FOR_QC: { stage: "FINAL", label: "Production output ready for QC", enabled: false, gates: ["NONE", "HOLD_STOCK"] },
  SALES_DELIVERY_READY_FOR_DISPATCH: { stage: "PRE_DISPATCH", label: "Delivery ready for dispatch", enabled: false, gates: ["NONE", "BLOCK_DISPATCH"] },
  CUSTOMER_RETURN_RECEIVED: { stage: "RETURN", label: "Customer return received", enabled: false, gates: ["NONE", "HOLD_STOCK"] },
});
export const REQUIREMENTS = Object.freeze({ MANDATORY: "Mandatory inspection", ADVISORY: "Advisory inspection", MANUAL: "Manual inspection rule" });
export const GATES = Object.freeze({ NONE: "No automatic restriction", HOLD_STOCK: "Hold stock until Quality clears it", BLOCK_DISPATCH: "Block dispatch",
  BLOCK_PRODUCTION_PROGRESS: "Block production progress" });
export const BINDINGS = Object.freeze({ FAMILY: "The specification's version in force on the source date", LOCKED: "One exact approved version",
  RESOLVE: "Whichever specification applies to the item (its applicability rules)" });
export const MATCH_MODES = Object.freeze({ OVERRIDE_DEFAULT: "Replaces a more general control point", ADDITIONAL_REQUIRED_CHECK: "An additional, independent inspection" });
export const STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved", ACTIVE: "Active",
  SUPERSEDED: "Superseded", RETIRED: "Retired", REJECTED: "Rejected" });
export const OBLIGATION = Object.freeze({ PENDING: "Pending inspection", SATISFIED: "Inspection passed", FAILED: "Inspection failed", WAIVED: "Released under approved deviation",
  EXCEPTION: "Configuration exception", CANCELLED: "Cancelled" });
export const SCOPES = Object.freeze({ ITEM: "Item", CATEGORY: "Product category", COMPANY_DEFAULT: "Company default" });
export const EDITABLE = Object.freeze(["DRAFT", "CHANGES_REQUESTED"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label = "Reference") => {
  if (!UUID.test(String(value ?? ""))) throw qcpError(400, "QUALITY_QCP_INVALID", `${label} is invalid.`);
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
export const bool = (value, fallback = false) => (value === undefined || value === null || value === "" ? fallback : value === true || value === "true" || value === 1 || value === "1");
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw qcpError(400, "QUALITY_QCP_INVALID", `${label} is not a valid date.`);
  return s;
};
export const oneOf = (value, map, code, label) => {
  const v = String(value ?? "").toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(map, v)) throw qcpError(400, code, label ? `${label}: choose one of ${Object.values(map).map((x) => (typeof x === "string" ? x : x.label)).join(", ")}.` : undefined);
  return v;
};
export const expectVersion = (row, input) => {
  if (input?.version !== undefined && input.version !== null && input.version !== "" && Number(input.version) !== Number(row.row_version)) throw qcpError(409, "QUALITY_QCP_VERSION_CONFLICT");
};
export const tierOf = (scope, supplierId, warehouseId) => ({ ITEM: 0, CATEGORY: 3, COMPANY_DEFAULT: 6 }[scope] + 2 - (supplierId ? 1 : 0) - (warehouseId ? 1 : 0));

// ------------------------------------------------------------------ validation of a version
// spec: the bound specification (master, plus the locked version when LOCKED) as loaded; rules: the version's applicability rules.
export function validateQcpVersion(point, version, rules, { spec = null, lockedVersion = null } = {}) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message: message ?? qcpMessage(code) });
  if (!text(point.name)) add("QUALITY_QCP_INVALID", "Enter a name.");
  if (!STAGES[version.inspection_stage]) add("QUALITY_QCP_STAGE_INVALID");
  const trigger = TRIGGERS[version.trigger_event];
  if (!trigger) add("QUALITY_QCP_TRIGGER_UNAVAILABLE");
  else {
    if (trigger.stage !== version.inspection_stage) add("QUALITY_QCP_STAGE_INVALID", `${trigger.label} is a ${STAGES[trigger.stage].toLowerCase()} event.`);
    if (!trigger.enabled) add("QUALITY_QCP_TRIGGER_UNAVAILABLE", `${trigger.label} is not yet connected to its workflow, so this control point cannot be published.`);
    if (!trigger.gates.includes(version.gate_type)) add("QUALITY_QCP_TRIGGER_UNAVAILABLE", `${GATES[version.gate_type] ?? version.gate_type} is not supported for ${trigger.label.toLowerCase()}.`);
  }
  if (version.requirement_type !== "MANDATORY" && version.gate_type !== "NONE") add("QUALITY_QCP_INVALID", "Only a mandatory inspection can restrict stock or downstream steps.");
  if (version.requirement_type === "MANUAL" && version.trigger_event !== "QUALITY_MANUAL_INSPECTION_REQUESTED") add("QUALITY_QCP_INVALID", "A manual inspection rule reacts to inspections requested by Quality.");
  if (version.spec_binding === "FAMILY" || version.spec_binding === "LOCKED") {
    if (!spec) add("QUALITY_QCP_SPEC_MISSING");
    else {
      if (spec.inspection_stage !== version.inspection_stage) add("QUALITY_QCP_SPEC_INCOMPATIBLE");
      if (spec.status === "RETIRED") add("QUALITY_QCP_SPEC_MISSING", `${spec.specification_code} is retired.`);
      if (spec.is_template) add("QUALITY_QCP_SPEC_MISSING", `${spec.specification_code} is a template: copy it into a specification first.`);
      if (version.spec_binding === "LOCKED" && (!lockedVersion || !lockedVersion.published_at || !["APPROVED", "ACTIVE", "SUPERSEDED"].includes(lockedVersion.status)))
        add("QUALITY_QCP_SPEC_MISSING", "Select a published, approved specification version.");
    }
  }
  if (version.trigger_event !== "QUALITY_MANUAL_INSPECTION_REQUESTED" && !rules.length) add("QUALITY_QCP_APPLICABILITY_INVALID", "Add at least one applicability rule (an item, a category or the Company default).");
  const keys = new Set();
  for (const r of rules) {
    const key = [r.scope_kind, r.item_id, r.item_group_id, r.supplier_id, r.warehouse_id].join("|");
    if (keys.has(key)) add("QUALITY_QCP_APPLICABILITY_INVALID", "The same applicability rule is listed twice.");
    keys.add(key);
    if (r.supplier_id && version.inspection_stage !== "INCOMING") add("QUALITY_QCP_APPLICABILITY_INVALID", "A supplier filter applies to incoming inspection only.");
  }
  if (!/^[A-Z0-9_]{1,30}$/.test(String(version.purpose_code ?? ""))) add("QUALITY_QCP_INVALID", "The inspection purpose is a short code (letters, digits, _).");
  if (version.effective_until && String(version.effective_until) < String(version.effective_from)) add("QUALITY_QCP_INVALID", "The end date is before the start date.");
  return issues;
}
const CONTENT = ["inspection_stage", "trigger_event", "requirement_type", "gate_type", "spec_binding", "specification_id", "spec_version_id", "match_mode", "purpose_code", "quantity_scope",
  "lot_context", "waiver_allowed", "effective_from"];
export function qcpContentHash(version, rules) {
  const norm = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null);
  const body = { version: Object.fromEntries(CONTENT.map((k) => [k, norm(version[k])])),
    rules: rules.map((r) => [r.scope_kind, r.item_id, r.item_group_id, r.supplier_id, r.warehouse_id].map(norm).join("|")).sort() };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
export function compareQcpVersions(before, after) {
  if (!before) return { changes: [], rulesAdded: [], rulesRemoved: [] };
  const changes = CONTENT.filter((k) => String(before.version[k] ?? "") !== String(after.version[k] ?? "")).map((k) => ({ field: k, before: before.version[k] ?? null, after: after.version[k] ?? null }));
  const key = (r) => r.describe ?? [r.scope_kind, r.item_id, r.item_group_id, r.supplier_id, r.warehouse_id].join("|");
  const a = new Set(before.rules.map(key));
  const b = new Set(after.rules.map(key));
  return { changes, rulesAdded: [...b].filter((x) => !a.has(x)), rulesRemoved: [...a].filter((x) => !b.has(x)) };
}
