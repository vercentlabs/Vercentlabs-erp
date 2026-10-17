// Quality — Inspection Specifications: the rules shared by commands, the resolver and reads. Errors with their user-facing messages, the
// permissions, the lifecycle, the validation of a version, and the pure definitions every inspection applies: how a characteristic's
// observation is evaluated (decimal-safe, inclusive / exclusive limits, approved unit conversions only), how a sample size is computed and
// how sample results aggregate into a proposed outcome. The specification defines the standard; it never decides a real lot's disposition.
import { createHash } from "node:crypto";

export const QS = Object.freeze({
  view: "quality.spec.view", create: "quality.spec.create", editDraft: "quality.spec.edit_draft", copy: "quality.spec.copy", submit: "quality.spec.submit",
  review: "quality.spec.review", approve: "quality.spec.approve", activate: "quality.spec.activate", revise: "quality.spec.revise", retire: "quality.spec.retire",
  applicability: "quality.spec.manage_applicability", history: "quality.spec.view_history", export: "quality.spec.export", evidence: "quality.spec.view_evidence",
  settings: "quality.settings.manage",
});

const MESSAGES = Object.freeze({
  QUALITY_SPEC_NAME_REQUIRED: "Enter a specification name.",
  QUALITY_SPEC_PRODUCT_INVALID: "Select a valid product or applicable scope.",
  QUALITY_SPEC_STAGE_INVALID: "Select an inspection stage.",
  QUALITY_SPEC_NO_CHECKS: "Add at least one inspection check.",
  QUALITY_SPEC_LIMITS_INVALID: "Review the minimum and maximum values.",
  QUALITY_SPEC_UOM_INVALID: "Select a valid measurement unit.",
  QUALITY_SPEC_SAMPLING_INVALID: "Review the sampling rule.",
  QUALITY_SPEC_ACCEPTANCE_INVALID: "Define how inspection results should be evaluated.",
  QUALITY_SPEC_APPLICABILITY_CONFLICT: "Another specification applies to this item and stage. Resolve the conflict.",
  QUALITY_SPEC_APPROVAL_REQUIRED: "This version needs Quality approval.",
  QUALITY_SPEC_VERSION_IMMUTABLE: "Create a revision to change approved criteria.",
  QUALITY_SPEC_NOT_EFFECTIVE: "This specification is not yet effective for the selected inspection.",
  QUALITY_SPEC_RETIRED: "This specification cannot be used for new inspections.",
  QUALITY_SPEC_PERMISSION_DENIED: "You are not authorized for this action.",
  QUALITY_SPEC_COMPANY_MISMATCH: "The selected source belongs to another Company.",
  QUALITY_SPEC_VERSION_CONFLICT: "This specification changed. Refresh and review.",
  QUALITY_SPEC_OUTCOME_UNKNOWN: "The previous operation is being checked. Do not submit it again.",
  QUALITY_SPEC_NOT_FOUND: "That inspection specification was not found.",
  QUALITY_SPEC_STATE: "This version cannot do that in its current state.",
  QUALITY_SPEC_SELF_APPROVAL: "You prepared or submitted this version, so someone else must approve it.",
  QUALITY_SPEC_INVALID: "Review the highlighted details.",
  QUALITY_SPEC_REASON_REQUIRED: "Give a reason.",
});
export class QualitySpecError extends Error {
  constructor(status, code, message, details) {
    super(message || MESSAGES[code] || "The inspection specification request could not be completed.");
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const specError = (status, code, message, details) => new QualitySpecError(status, code, message, details);
export const messageOf = (code) => MESSAGES[code] ?? code;

// Only the organization owner bypasses a permission check (segregation of duties applies to everyone).
export const has = (c, p) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p));
export const need = (c, ...list) => {
  if (!list.some((p) => has(c, p))) throw specError(403, "QUALITY_SPEC_PERMISSION_DENIED");
};

export const STAGES = Object.freeze({ INCOMING: "Incoming goods", IN_PROCESS: "In-process", FINAL: "Final inspection", PRE_DISPATCH: "Pre-dispatch", RETURN: "Customer return", MANUAL: "Manual / ad hoc" });
// A stage is operational only once its source workflow resolves specifications end to end.
export const OPERATIONAL_STAGES = Object.freeze({ INCOMING: "Goods receipts (inspection hold)", MANUAL: "Inspections started by Quality" });
export const STATUS = Object.freeze({ DRAFT: "Draft", PENDING_REVIEW: "Pending review", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved", ACTIVE: "Active",
  SUPERSEDED: "Superseded", RETIRED: "Retired", REJECTED: "Rejected" });
export const EDITABLE = Object.freeze(["DRAFT", "CHANGES_REQUESTED"]);
export const OPEN = Object.freeze(["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED"]);
export const CHECK_TYPES = Object.freeze({ NUMERIC_RANGE: "Measurement within limits", NUMERIC_TARGET_TOLERANCE: "Target ± tolerance", BOOLEAN: "Pass / fail test",
  ENUM: "Choice from a list", VISUAL: "Visual check", TEXT_OBSERVATION: "Written observation" });
export const CRITICALITY = Object.freeze({ CRITICAL: "Critical", MAJOR: "Major", MINOR: "Minor", INFORMATIONAL: "Informational" });
export const SAMPLING = Object.freeze({ ALL_UNITS: "Every unit", FIXED_COUNT: "A fixed number of units", PERCENTAGE: "A percentage of the units", DOCUMENT_ONLY: "Documents only",
  MANUAL_APPROVED_COUNT: "A count approved by Quality" });
export const METHOD_OF = Object.freeze({ ALL_UNITS: "FULL", FIXED_COUNT: "SAMPLING", PERCENTAGE: "SAMPLING", MANUAL_APPROVED_COUNT: "SAMPLING", DOCUMENT_ONLY: "DOCUMENT_REVIEW" });
export const METHODS = Object.freeze({ SAMPLING: "Sample inspection", FULL: "100% inspection", DOCUMENT_REVIEW: "Document review" });
export const DECISIONS = Object.freeze({ ALL_REQUIRED_PASS: "Every required check must pass", COUNT_BASED: "Allowed defects per severity", MANUAL_REVIEW: "Reviewed by an authorized person" });
export const ROUNDING = Object.freeze({ UP: "Round up", DOWN: "Round down", NEAREST: "Round to nearest" });
export const SCOPES = Object.freeze({ ITEM: "Item", CATEGORY: "Product category", COMPANY_DEFAULT: "Company default" });

// ------------------------------------------------------------------ input helpers
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label = "Reference") => {
  if (!UUID.test(String(value ?? ""))) throw specError(400, "QUALITY_SPEC_INVALID", `${label} is invalid.`);
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw specError(400, "QUALITY_SPEC_INVALID", `${label} is not a valid date.`);
  return s;
};
export const ymd = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
export const oneOf = (value, map, code, label) => {
  const v = String(value ?? "").toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(map, v)) throw specError(400, code, label ? `${label}: choose one of ${Object.values(map).join(", ")}.` : undefined);
  return v;
};
export const bool = (value, fallback = false) => (value === undefined || value === null || value === "" ? fallback : value === true || value === "true" || value === 1 || value === "1");
export const intOrNull = (value) => (value === undefined || value === null || value === "" ? null : Number(value));
export const expectVersion = (row, input) => {
  if (input?.version !== undefined && input.version !== null && input.version !== "" && Number(input.version) !== Number(row.row_version)) throw specError(409, "QUALITY_SPEC_VERSION_CONFLICT");
};

// ------------------------------------------------------------------ decimals (24,10), exact
const SCALE = 10;
const TEN = 10n ** BigInt(SCALE);
export const isDecimal = (v) => v !== null && v !== undefined && /^-?\d+(\.\d+)?$/.test(String(v).trim());
export function dec(v) {
  const s = String(v).trim();
  if (!isDecimal(s)) throw specError(400, "QUALITY_SPEC_LIMITS_INVALID", `${s || "A value"} is not a number.`);
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  if (f.length > SCALE) throw specError(400, "QUALITY_SPEC_LIMITS_INVALID", `${s} has more than ${SCALE} decimal places.`);
  const n = BigInt(w) * TEN + BigInt((f + "0".repeat(SCALE)).slice(0, SCALE));
  return neg ? -n : n;
}
export function decText(n, places = null) {
  const neg = n < 0n;
  const a = neg ? -n : n;
  let f = String(a % TEN).padStart(SCALE, "0");
  f = places === null ? f.replace(/0+$/, "") : f.slice(0, places).padEnd(places, "0");
  return `${neg ? "-" : ""}${a / TEN}${f ? `.${f}` : ""}`;
}
const roundHalfUp = (n, places) => {
  const unit = 10n ** BigInt(SCALE - places);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const r = ((a + unit / 2n) / unit) * unit;
  return neg ? -r : r;
};
// The acceptable interval of a numeric characteristic, as scaled integers (null for an open side).
export function intervalOf(ch) {
  if (ch.check_type === "NUMERIC_TARGET_TOLERANCE") {
    const t = dec(ch.target_value);
    return { lower: t - dec(ch.lower_tolerance ?? 0), upper: t + dec(ch.upper_tolerance ?? 0), lowerInclusive: ch.lower_inclusive !== false, upperInclusive: ch.upper_inclusive !== false };
  }
  return { lower: isDecimal(ch.lower_limit) ? dec(ch.lower_limit) : null, upper: isDecimal(ch.upper_limit) ? dec(ch.upper_limit) : null,
    lowerInclusive: ch.lower_inclusive !== false, upperInclusive: ch.upper_inclusive !== false };
}

// ------------------------------------------------------------------ evaluation (the definition every inspection applies)
// observation: { value, unit, choice, judgement: PASS | FAIL, notApplicable }. factor: { from, to } reference factors of an approved standard
// conversion when the observation's unit differs from the characteristic's. Outcomes: PASS, FAIL, NOT_APPLICABLE, RECORDED (information only),
// INCOMPLETE (nothing observed), INVALID (not a valid observation), INVALID_UNIT, JUDGEMENT_REQUIRED.
export function evaluateCharacteristic(ch, observation = {}, factor = null) {
  const o = observation ?? {};
  if (o.notApplicable) return ch.allow_na ? { outcome: "NOT_APPLICABLE" } : { outcome: "INVALID", reason: "This check cannot be marked not applicable." };
  switch (ch.check_type) {
    case "NUMERIC_RANGE":
    case "NUMERIC_TARGET_TOLERANCE": {
      if (o.value === undefined || o.value === null || o.value === "") return { outcome: "INCOMPLETE", reason: "No measurement recorded." };
      if (!isDecimal(o.value)) return { outcome: "INVALID", reason: `${o.value} is not a number.` };
      let v = dec(o.value);
      const unit = text(o.unit ?? "", 12).toUpperCase();
      const own = String(ch.unit_code ?? "").toUpperCase();
      if (unit && own && unit !== own) {
        if (!factor || factor.dimensionFrom !== factor.dimensionTo || !factor.from || !factor.to) return { outcome: "INVALID_UNIT", reason: `${unit} cannot be converted to ${own}.` };
        // value [unit] × from / to = value [own] (factors are to the dimension's reference unit)
        v = (v * dec(factor.from)) / dec(factor.to);
      }
      if (ch.measurement_rounding === "HALF_UP") v = roundHalfUp(v, Number(ch.decimal_places ?? 2));
      const iv = intervalOf(ch);
      const below = iv.lower !== null && (iv.lowerInclusive ? v < iv.lower : v <= iv.lower);
      const above = iv.upper !== null && (iv.upperInclusive ? v > iv.upper : v >= iv.upper);
      return { outcome: below || above ? "FAIL" : "PASS", measured: decText(v), reason: below ? "Below the acceptable range." : above ? "Above the acceptable range." : undefined };
    }
    case "BOOLEAN": {
      if (o.value === undefined || o.value === null || o.value === "") return { outcome: "INCOMPLETE", reason: "No result recorded." };
      const v = o.value === true || o.value === "true" || o.value === "yes";
      return { outcome: v === (ch.expected_boolean !== false) ? "PASS" : "FAIL" };
    }
    case "ENUM": {
      const choice = text(o.choice ?? o.value ?? "", 120);
      if (!choice) return { outcome: "INCOMPLETE", reason: "No choice recorded." };
      const found = (ch.allowed_values ?? []).find((a) => a.value === choice);
      if (!found) return { outcome: "INVALID", reason: `${choice} is not one of the approved choices.` };
      return { outcome: found.acceptable ? "PASS" : "FAIL" };
    }
    case "VISUAL": {
      const j = String(o.judgement ?? "").toUpperCase();
      if (!["PASS", "FAIL"].includes(j)) return { outcome: "INCOMPLETE", reason: "Record whether the visual check passed." };
      return { outcome: j };
    }
    case "TEXT_OBSERVATION": {
      if (ch.judgement === "INFORMATIONAL") return o.value || o.note ? { outcome: "RECORDED" } : { outcome: "INCOMPLETE", reason: "No observation recorded." };
      const j = String(o.judgement ?? "").toUpperCase();
      if (!["PASS", "FAIL"].includes(j)) return { outcome: "JUDGEMENT_REQUIRED", reason: "An inspector must judge this observation." };
      return { outcome: j };
    }
    default:
      return { outcome: "INVALID", reason: "Unknown check type." };
  }
}

// samples: [{ results: { [characteristicId]: evaluation } }]. The proposed outcome only: the Inspection and its authorized decision own the lot.
export function aggregateOutcome(version, characteristics, samples) {
  const counted = characteristics.filter((ch) => ch.criticality !== "INFORMATIONAL");
  let incomplete = 0;
  let criticalFail = false;
  let failedRequired = 0;
  let majorDefects = 0;
  let minorDefects = 0;
  const perSample = samples.map((s, index) => {
    let failed = false;
    let major = false;
    let minor = false;
    for (const ch of counted) {
      const r = s.results?.[ch.id];
      const outcome = r?.outcome ?? "INCOMPLETE";
      if (["INCOMPLETE", "INVALID", "INVALID_UNIT", "JUDGEMENT_REQUIRED"].includes(outcome)) { if (ch.is_required) incomplete += 1; continue; }
      if (outcome !== "FAIL") continue;
      if (ch.criticality === "CRITICAL") criticalFail = true;
      if (ch.is_required) { failed = true; failedRequired += 1; }
      if (ch.criticality === "MAJOR" || ch.criticality === "CRITICAL") major = true; else if (ch.criticality === "MINOR") minor = true;
    }
    if (major) majorDefects += 1; else if (minor) minorDefects += 1;
    return { sample: index + 1, outcome: failed ? "FAIL" : "PASS" };
  });
  let proposed;
  if (criticalFail) proposed = "FAIL";
  else if (incomplete) proposed = "INCOMPLETE";
  else if (version.decision_rule === "MANUAL_REVIEW") proposed = "REVIEW_REQUIRED";
  else if (version.decision_rule === "COUNT_BASED") proposed = majorDefects <= Number(version.allowed_major_defects ?? 0) && minorDefects <= Number(version.allowed_minor_defects ?? 0) ? "PASS" : "FAIL";
  else proposed = failedRequired ? "FAIL" : "PASS";
  return { proposed, criticalFail, blocksAutomaticAcceptance: criticalFail, incomplete, majorDefects, minorDefects, samples: perSample };
}

// ------------------------------------------------------------------ sampling
// population: the eligible quantity of the source line in whole units. approvedCount: the count a Quality reviewer approved (manual method).
export function sampleSize(version, population, { approvedCount = null } = {}) {
  const units = Math.max(Math.floor(Number(population) || 0), Number(population) > 0 ? 1 : 0);
  const cap = (n) => {
    let size = n;
    let note = null;
    if (version.sample_minimum !== null && version.sample_minimum !== undefined && size < Number(version.sample_minimum)) size = Number(version.sample_minimum);
    if (version.sample_maximum !== null && version.sample_maximum !== undefined && size > Number(version.sample_maximum)) size = Number(version.sample_maximum);
    if (size > units) { note = `Only ${units} unit${units === 1 ? " is" : "s are"} eligible: every unit is inspected (the sample of ${size} is capped).`; size = units; }
    return { size, population: units, capped: Boolean(note), note };
  };
  switch (version.sampling_method) {
    case "ALL_UNITS": return { size: units, population: units, capped: false, note: null };
    case "DOCUMENT_ONLY": return { size: 0, population: units, capped: false, note: "Documents and certificates are checked; no physical sample." };
    case "FIXED_COUNT": return cap(Math.trunc(Number(version.sample_value)));
    case "PERCENTAGE": {
      const exact = (dec(String(units)) * dec(String(version.sample_value))) / dec("100");
      const whole = exact / TEN;
      const rest = exact % TEN;
      const n = version.rounding_rule === "DOWN" ? whole : version.rounding_rule === "NEAREST" ? whole + (rest * 2n >= TEN ? 1n : 0n) : whole + (rest > 0n ? 1n : 0n);
      return cap(Number(n));
    }
    case "MANUAL_APPROVED_COUNT":
      if (approvedCount === null || approvedCount === undefined) return { size: null, population: units, capped: false, note: "A Quality reviewer approves the sample count.", needsApproval: true };
      return cap(Math.trunc(Number(approvedCount)));
    default: return { size: units, population: units, capped: false, note: null };
  }
}
export function samplingSentence(version) {
  const v = version.sample_value === null || version.sample_value === undefined ? null : decText(dec(String(version.sample_value)));
  const bounds = [version.sample_minimum !== null && version.sample_minimum !== undefined ? `at least ${version.sample_minimum}` : null,
    version.sample_maximum !== null && version.sample_maximum !== undefined ? `at most ${version.sample_maximum}` : null].filter(Boolean).join(", ");
  const suffix = bounds ? ` (${bounds})` : "";
  switch (version.sampling_method) {
    case "ALL_UNITS": return "Inspect every unit received.";
    case "FIXED_COUNT": return `Inspect ${v} unit${v === "1" ? "" : "s"}${suffix}; if fewer are received, inspect every unit.`;
    case "PERCENTAGE": return `Inspect ${v}% of the units, ${ROUNDING[version.rounding_rule]?.toLowerCase() ?? "rounded up"}${suffix}.`;
    case "DOCUMENT_ONLY": return "Check the documents and certificates; no physical sample.";
    case "MANUAL_APPROVED_COUNT": return `A Quality reviewer decides how many units to inspect${suffix}.`;
    default: return "";
  }
}

// ------------------------------------------------------------------ inspector wording
export function criterionText(ch) {
  const unit = ch.unit_code ? ` ${String(ch.unit_code).toLowerCase()}` : "";
  const places = Number(ch.decimal_places ?? 2);
  const n = (x) => decText(x, places);
  if (ch.check_type === "NUMERIC_RANGE" || ch.check_type === "NUMERIC_TARGET_TOLERANCE") {
    let iv;
    try { iv = intervalOf(ch); } catch { return "Limits not set"; }
    const range = iv.lower !== null && iv.upper !== null
      ? (iv.lowerInclusive && iv.upperInclusive ? `${n(iv.lower)}–${n(iv.upper)}${unit}` : `${iv.lowerInclusive ? "from" : "more than"} ${n(iv.lower)} ${iv.upperInclusive ? "up to" : "and less than"} ${n(iv.upper)}${unit}`)
      : iv.lower !== null ? `${iv.lowerInclusive ? "at least" : "more than"} ${n(iv.lower)}${unit}` : iv.upper !== null ? `${iv.upperInclusive ? "at most" : "less than"} ${n(iv.upper)}${unit}` : "Limits not set";
    return ch.check_type === "NUMERIC_TARGET_TOLERANCE" && isDecimal(ch.target_value) ? `${n(dec(ch.target_value))}${unit} (${range})` : range;
  }
  if (ch.check_type === "BOOLEAN") return ch.acceptance_text || (ch.expected_boolean === false ? "Does not occur" : "Works / passes");
  if (ch.check_type === "ENUM") {
    const ok = (ch.allowed_values ?? []).filter((a) => a.acceptable).map((a) => a.label || a.value);
    return ok.length ? `Acceptable: ${ok.join(", ")}` : "No acceptable choice";
  }
  if (ch.check_type === "VISUAL") return ch.acceptance_text || "Meets the visual standard";
  return ch.judgement === "INFORMATIONAL" ? "Record what you observe (information only)" : ch.acceptance_text || "Inspector judges whether acceptable";
}

// ------------------------------------------------------------------ validation of a version
export function validateVersion(spec, version, characteristics, { units = new Map(), item = undefined } = {}) {
  const issues = [];
  const add = (code, message, characteristic) => issues.push({ code, message: message ?? messageOf(code), ...(characteristic ? { characteristic } : {}) });
  if (!text(spec.name)) add("QUALITY_SPEC_NAME_REQUIRED");
  if (!STAGES[version.inspection_stage]) add("QUALITY_SPEC_STAGE_INVALID");
  if (spec.item_id && item === null) add("QUALITY_SPEC_PRODUCT_INVALID", "The product of this specification is no longer active.");
  if (!characteristics.length) add("QUALITY_SPEC_NO_CHECKS");
  const codes = new Set();
  for (const ch of characteristics) {
    const label = `${ch.characteristic_code} ${ch.name}`.trim();
    if (codes.has(ch.characteristic_code)) add("QUALITY_SPEC_INVALID", `${label}: the check code is used twice.`, ch.characteristic_code);
    codes.add(ch.characteristic_code);
    if (!text(ch.name)) add("QUALITY_SPEC_NAME_REQUIRED", `Check ${ch.sequence}: enter what to check.`, ch.characteristic_code);
    if (ch.criticality === "CRITICAL" && !ch.is_required) add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: a critical check must be required.`, ch.characteristic_code);
    if (ch.check_type === "NUMERIC_RANGE" || ch.check_type === "NUMERIC_TARGET_TOLERANCE") {
      if (!ch.unit_code || (ch.uom_id && units.size && !units.has(ch.uom_id))) add("QUALITY_SPEC_UOM_INVALID", `${label}: select a valid measurement unit.`, ch.characteristic_code);
      try {
        if (ch.check_type === "NUMERIC_TARGET_TOLERANCE" && (!isDecimal(ch.target_value) || !isDecimal(ch.lower_tolerance) || !isDecimal(ch.upper_tolerance)))
          add("QUALITY_SPEC_LIMITS_INVALID", `${label}: enter the target and both tolerances.`, ch.characteristic_code);
        else {
          const iv = intervalOf(ch);
          if (iv.lower === null && iv.upper === null) add("QUALITY_SPEC_LIMITS_INVALID", `${label}: enter a minimum, a maximum or both.`, ch.characteristic_code);
          else if (iv.lower !== null && iv.upper !== null && (iv.lower > iv.upper || (iv.lower === iv.upper && !(iv.lowerInclusive && iv.upperInclusive))))
            add("QUALITY_SPEC_LIMITS_INVALID", `${label}: the minimum must not exceed the maximum.`, ch.characteristic_code);
        }
      } catch (error) { add("QUALITY_SPEC_LIMITS_INVALID", `${label}: ${error.message}`, ch.characteristic_code); }
    } else if (ch.check_type === "BOOLEAN") {
      if (ch.expected_boolean === null || ch.expected_boolean === undefined) add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: choose the expected result.`, ch.characteristic_code);
    } else if (ch.check_type === "ENUM") {
      const values = ch.allowed_values ?? [];
      if (values.length < 2 || new Set(values.map((a) => a.value)).size !== values.length) add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: list at least two different choices.`, ch.characteristic_code);
      else if (!values.some((a) => a.acceptable)) add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: mark at least one choice acceptable.`, ch.characteristic_code);
    } else if (ch.check_type === "VISUAL") {
      if (!text(ch.acceptance_text)) add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: describe what is acceptable.`, ch.characteristic_code);
    } else if (ch.check_type === "TEXT_OBSERVATION") {
      if (!ch.judgement) add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: choose whether the observation is information only or judged by the inspector.`, ch.characteristic_code);
      if (ch.judgement === "INFORMATIONAL" && ch.criticality !== "INFORMATIONAL") add("QUALITY_SPEC_ACCEPTANCE_INVALID", `${label}: an information-only observation cannot decide a pass; mark it Informational.`, ch.characteristic_code);
    }
  }
  if (characteristics.length && !characteristics.some((ch) => ch.is_required && ch.criticality !== "INFORMATIONAL" && !(ch.check_type === "TEXT_OBSERVATION" && ch.judgement === "INFORMATIONAL")))
    add("QUALITY_SPEC_ACCEPTANCE_INVALID", "At least one required check must decide pass or fail.");
  // sampling
  const method = version.sampling_method;
  if (!SAMPLING[method]) add("QUALITY_SPEC_SAMPLING_INVALID");
  else {
    if (METHOD_OF[method] !== version.inspection_method) add("QUALITY_SPEC_SAMPLING_INVALID", `${SAMPLING[method]} is a ${METHODS[METHOD_OF[method]].toLowerCase()}.`);
    const value = version.sample_value === null || version.sample_value === undefined ? null : Number(version.sample_value);
    if (method === "FIXED_COUNT" && !(value !== null && Number.isInteger(value) && value >= 1)) add("QUALITY_SPEC_SAMPLING_INVALID", "Enter how many units to inspect (a whole number).");
    if (method === "PERCENTAGE" && !(value !== null && value > 0 && value <= 100)) add("QUALITY_SPEC_SAMPLING_INVALID", "Enter a percentage above 0 and up to 100.");
    if (version.sample_minimum !== null && version.sample_maximum !== null && version.sample_minimum !== undefined && version.sample_maximum !== undefined
      && Number(version.sample_minimum) > Number(version.sample_maximum)) add("QUALITY_SPEC_SAMPLING_INVALID", "The minimum sample cannot exceed the maximum.");
  }
  if (!DECISIONS[version.decision_rule]) add("QUALITY_SPEC_ACCEPTANCE_INVALID");
  if (version.decision_rule === "COUNT_BASED") {
    if (!["FIXED_COUNT", "PERCENTAGE"].includes(method)) add("QUALITY_SPEC_ACCEPTANCE_INVALID", "Allowed defect counts need a fixed or percentage sample.");
    if (version.allowed_major_defects === null || version.allowed_major_defects === undefined || version.allowed_minor_defects === null || version.allowed_minor_defects === undefined)
      add("QUALITY_SPEC_ACCEPTANCE_INVALID", "Enter the allowed major and minor defects.");
  }
  if (version.effective_until && ymd(version.effective_until) < ymd(version.effective_from)) add("QUALITY_SPEC_INVALID", "The end date is before the start date.");
  return issues;
}

// ------------------------------------------------------------------ the content hash (approval integrity)
const CONTENT_FIELDS = ["inspection_stage", "inspection_method", "sampling_method", "sampling_basis", "sample_value", "sample_minimum", "sample_maximum", "rounding_rule",
  "sampling_instructions", "decision_rule", "allowed_major_defects", "allowed_minor_defects", "lot_context", "effective_from"];
const CHAR_FIELDS = ["characteristic_code", "sequence", "name", "check_type", "instructions", "acceptance_text", "evidence_note", "unit_code", "target_value", "lower_tolerance",
  "upper_tolerance", "lower_limit", "upper_limit", "lower_inclusive", "upper_inclusive", "decimal_places", "measurement_rounding", "expected_boolean", "allowed_values", "judgement",
  "criticality", "is_required", "allow_na", "evidence_required", "instrument_note"];
const norm = (v) => (v instanceof Date ? ymd(v) : v === undefined ? null : isDecimal(v) && typeof v === "string" ? decText(dec(v)) : v);
export function contentHash(version, characteristics) {
  const body = { version: Object.fromEntries(CONTENT_FIELDS.map((k) => [k, norm(version[k])])),
    checks: [...characteristics].sort((a, b) => a.sequence - b.sequence).map((ch) => Object.fromEntries(CHAR_FIELDS.map((k) => [k, norm(ch[k])]))) };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
// What changed from the predecessor, check by check (by the stable characteristic code).
export function compareVersions(before, after) {
  if (!before) return { changes: [], added: after.checks.map((c) => c.characteristic_code), removed: [] };
  const changes = [];
  for (const k of CONTENT_FIELDS) if (JSON.stringify(norm(before.version[k])) !== JSON.stringify(norm(after.version[k]))) changes.push({ field: k, before: norm(before.version[k]), after: norm(after.version[k]) });
  const old = new Map(before.checks.map((c) => [c.characteristic_code, c]));
  const now = new Map(after.checks.map((c) => [c.characteristic_code, c]));
  const modified = [];
  for (const [code, c] of now) {
    const o = old.get(code);
    if (!o) continue;
    const fields = CHAR_FIELDS.filter((k) => k !== "sequence" && JSON.stringify(norm(o[k])) !== JSON.stringify(norm(c[k])));
    if (fields.length) modified.push({ code, name: c.name, fields, before: criterionText(o), after: criterionText(c) });
  }
  return { changes, added: [...now.keys()].filter((k) => !old.has(k)), removed: [...old.keys()].filter((k) => !now.has(k)), modified };
}
// The specificity tier of an applicability rule (lower is more specific).
export const tierOf = (scope, supplierId, warehouseId) => ({ ITEM: 0, CATEGORY: 3, COMPANY_DEFAULT: 6 }[scope] + 2 - (supplierId ? 1 : 0) - (warehouseId ? 1 : 0));
