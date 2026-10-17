// Assets — Opening / Existing Assets, row validation. Each source row is normalized (dates in ISO or Excel serial form, money parsed
// decimal-safely, formulas refused, serials and old codes kept as text), its references resolved against the Company's own categories,
// locations, stores, departments and members, its opening values checked (cost − accumulated depreciation − impairment ± adjustments =
// carrying value), and its identity matched against the register before anything is created. Errors block a row; warnings are kept
// for review and, for values, send the row's opening position to Finance review.
import { isPlaceholder, normalizeIdentifier } from "../asset-identification/ident-rules.js";
import { COLUMNS, HEADER_ALIASES, STATUS_MAP } from "./opening-rules.js";

const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"];
const METHODS = ["straight_line", "declining_balance", "units_of_production", "none"];
export const headerKey = (header) => {
  const key = String(header ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return HEADER_ALIASES[key] ?? key;
};
// Source record (any header spelling) → the template's keys, as text.
export function normalizeRecord(record) {
  const out = Object.fromEntries(COLUMNS.map((col) => [col, ""]));
  for (const [header, value] of Object.entries(record ?? {})) {
    const key = headerKey(header);
    if (COLUMNS.includes(key)) out[key] = String(value ?? "").trim();
  }
  return out;
}
// 2024-04-10, or an Excel day serial (45392) as a spreadsheet stores dates.
export function parseDay(value) {
  const v = String(value ?? "").trim();
  if (!v) return { day: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { day: v };
  if (/^\d{4,5}(\.0+)?$/.test(v)) {
    const serial = Math.floor(Number(v));
    if (serial > 20000 && serial < 80000) return { day: new Date(Date.UTC(1899, 11, 30) + serial * 864e5).toISOString().slice(0, 10) };
  }
  return { error: true };
}
// Decimal-safe money: digits with optional grouping commas and two decimals; a formula is never trusted.
export function parseMoney(value, { allowNegative = false } = {}) {
  const v = String(value ?? "").trim();
  if (!v) return { amount: null };
  if (/^[=+@]/.test(v)) return { error: "formula" };
  const cleaned = v.replace(/[₹,\s]/g, "");
  if (!(allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(cleaned)) return { error: "number" };
  const [whole, fraction = ""] = cleaned.replace(/^-/, "").split(".");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return { cents: cleaned.startsWith("-") ? -cents : cents, amount: `${cleaned.startsWith("-") ? "-" : ""}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, "0")}` };
}
const centsText = (cents) => `${cents < 0n ? "-" : ""}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, "0")}`;

// refs: { categories, locations, departments, members, parties, baseCurrency, cutoverDate, register: { legacy, serial, tag } (Map normalized → [assets]), file: { legacy, serial, tag } (Map normalized → row) }
export function validateRow(raw, rowNumber, refs) {
  const d = normalizeRecord(raw);
  const errors = [];
  const warnings = [];
  const fail = (field, code, message) => errors.push({ field, code, message });
  const warn = (field, code, message) => warnings.push({ field, code, message });
  const find = (list, value) => { const v = String(value ?? "").trim().toLowerCase(); return v ? list.find((r) => String(r.code ?? "").toLowerCase() === v || String(r.name ?? "").toLowerCase() === v) ?? null : null; };

  if (d.name.length < 2) fail("name", "ASSET_OPENING_INVALID", "Asset name is required.");
  for (const [col, label] of [["serial_number", "serial number"], ["asset_tag", "asset tag"], ["existing_asset_code", "previous asset code"]]) {
    if (isPlaceholder(d[col])) { fail(col, "ASSET_OPENING_INVALID", `“${d[col]}” is not a ${label}; leave it blank if there is none.`); d[col] = ""; }
  }
  const category = find(refs.categories, d.category);
  if (!category) fail("category", "ASSET_OPENING_CATEGORY_UNKNOWN", d.category ? `Category “${d.category}” is not one of the Company's active categories.` : "Asset category is required.");
  // The earlier register's status.
  const mapped = STATUS_MAP[(d.status || "active").toLowerCase()];
  if (!mapped) fail("status", "ASSET_OPENING_INVALID", `Status “${d.status}” is not supported: use active, in storage, not installed, under repair, on hold, retired, missing, lost or disposed.`);
  if (mapped?.lost) warn("status", "ASSET_OPENING_INVALID", "Recorded as lost: it is imported as confirmed lost with an investigation note — verify before Finance writes anything off.");
  if (category?.serial_number_policy === "REQUIRED" && !d.serial_number && !mapped?.disposed) fail("serial_number", "ASSET_OPENING_INVALID", "This category requires a serial number.");
  if (category?.asset_tag_policy === "REQUIRED" && !d.asset_tag && !mapped?.disposed) fail("asset_tag", "ASSET_OPENING_INVALID", "This category requires an asset tag.");
  // Ownership and tracking.
  const ownership = (d.ownership || "owned").toLowerCase().replace(/^company[ _-]?owned$/, "owned");
  if (!["owned", "leased", "loaned"].includes(ownership)) fail("ownership", "ASSET_OPENING_INVALID", "Ownership must be owned, leased or loaned.");
  let tracking = d.tracking ? { fixed: "PENDING", capitalized: "PENDING", tracked: "TRACKED_ONLY", "tracked only": "TRACKED_ONLY" }[d.tracking.toLowerCase()] : (category?.capitalization_guidance === "TRACK_ONLY" ? "TRACKED_ONLY" : "PENDING");
  if (!tracking) { fail("tracking", "ASSET_OPENING_INVALID", "Tracking must be fixed or tracked."); tracking = "PENDING"; }
  if (ownership !== "owned" && tracking === "PENDING") { tracking = "TRACKED_ONLY"; warn("tracking", "ASSET_OPENING_INVALID", "A leased or borrowed asset is tracked only: custody is recorded, no lease accounting."); }
  // Dates.
  const dates = {};
  for (const col of ["acquisition_date", "available_for_use_date", "warranty_end_date", "disposal_date"]) {
    const p = parseDay(d[col]);
    if (p.error) fail(col, "ASSET_OPENING_INVALID_DATE", `${col.replace(/_/g, " ")} must be a date written YYYY-MM-DD.`);
    dates[col] = p.day ?? null;
  }
  if (dates.acquisition_date && dates.acquisition_date > refs.cutoverDate) fail("acquisition_date", "ASSET_OPENING_INVALID_DATE", "An existing asset was acquired before the cutover date.");
  if (dates.available_for_use_date && dates.acquisition_date && dates.available_for_use_date < dates.acquisition_date) fail("available_for_use_date", "ASSET_OPENING_INVALID_DATE", "Available for use is before the acquisition date.");
  if (dates.available_for_use_date && dates.available_for_use_date > refs.cutoverDate && mapped?.lifecycle === "ACTIVE") fail("available_for_use_date", "ASSET_OPENING_INVALID_DATE", "An asset in use before cutover became available before the cutover date.");
  if (mapped?.disposed && !dates.disposal_date) fail("disposal_date", "ASSET_OPENING_INVALID_DATE", "A historically disposed asset needs its disposal date.");
  if (dates.disposal_date && dates.disposal_date > refs.cutoverDate) fail("disposal_date", "ASSET_OPENING_INVALID_DATE", "A disposal after the cutover belongs to the Disposal workflow, not the opening migration.");
  // Where it is, and who holds it.
  const location = find(refs.locations, d.location);
  if (!mapped?.disposed) {
    if (d.location && !location) fail("location", "ASSET_OPENING_LOCATION_UNKNOWN", `Location “${d.location}” is not one of the Company's active locations.`);
    if (!d.location && (category?.location_required || ["ACTIVE", "RETIRED", "LOST"].includes(mapped?.lifecycle))) fail("location", "ASSET_OPENING_LOCATION_UNKNOWN", "Give its current location.");
  }
  let store = d.store ? find(refs.locations.filter((l) => l.is_asset_store), d.store) : null;
  if (d.store && !store) fail("store", "ASSET_OPENING_LOCATION_UNKNOWN", `“${d.store}” is not an active asset store.`);
  if (!store && mapped?.store) store = location?.is_asset_store ? location : null;
  if (mapped?.store && !store) fail("store", "ASSET_OPENING_LOCATION_UNKNOWN", "An asset in storage needs its asset store (or a location marked as a store).");
  if (store && !store.manager_user_id) fail("store", "ASSET_OPENING_LOCATION_UNKNOWN", `${store.name} has no manager to be accountable for it.`);
  let custodian = null;
  if (d.custodian_email && !mapped?.disposed) {
    const member = refs.members.find((m) => m.email === d.custodian_email.toLowerCase());
    if (!member) warn("custodian_email", "ASSET_OPENING_CUSTODIAN_UNKNOWN", `${d.custodian_email} is not a member of the Company; the asset is imported without a custodian for you to assign.`);
    else if (member.status !== "active") warn("custodian_email", "ASSET_OPENING_CUSTODIAN_UNKNOWN", `${d.custodian_email} is no longer active; assign the asset to someone else after import.`);
    else custodian = member;
  }
  if (custodian && store) { warn("store", "ASSET_OPENING_INVALID", "Both a custodian and a store are given; the custodian is used."); store = null; }
  const department = d.department ? find(refs.departments, d.department) : null;
  if (d.department && !department) warn("department", "ASSET_OPENING_CUSTODIAN_UNKNOWN", `Department “${d.department}” was not found; imported without one.`);
  const condition = d.condition ? d.condition.toUpperCase() : null;
  if (condition && !CONDITIONS.includes(condition)) fail("condition", "ASSET_OPENING_INVALID", `Condition must be one of ${CONDITIONS.join(", ").toLowerCase()}.`);
  const supplier = d.supplier ? find(refs.parties, d.supplier) : null;
  // Opening values (fixed assets that are still in the books).
  const money = {};
  for (const col of ["original_cost", "capitalized_cost", "accumulated_depreciation", "accumulated_impairment", "opening_book_value", "residual_value"]) {
    const p = parseMoney(d[col]);
    if (p.error) fail(col, "ASSET_OPENING_INVALID", p.error === "formula" ? `${col.replace(/_/g, " ")} is a formula; enter its value.` : `${col.replace(/_/g, " ")} must be an amount of 0 or more.`);
    money[col] = p.cents ?? null;
  }
  const adj = parseMoney(d.other_adjustments, { allowNegative: true });
  if (adj.error) fail("other_adjustments", "ASSET_OPENING_INVALID", "Other adjustments must be an amount.");
  let position = null;
  const currency = (d.currency || refs.baseCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail("currency", "ASSET_OPENING_INVALID", "Currency must be a three-letter code.");
  const life = (col) => { if (!d[col]) return null; const n = Number(d[col]); if (!Number.isInteger(n) || n < 0 || n > 1200) { fail(col, "ASSET_OPENING_DEPRECIATION_INVALID", `${col.replace(/_/g, " ")} must be whole months.`); return null; } return n; };
  const usefulLife = life("useful_life_months");
  const remaining = life("remaining_useful_life_months");
  const method = d.depreciation_method ? d.depreciation_method.toLowerCase().replace(/[\s-]+/g, "_") : null;
  if (method && !METHODS.includes(method)) fail("depreciation_method", "ASSET_OPENING_DEPRECIATION_INVALID", "Depreciation method must be straight line, declining balance, units of production or none.");
  let review = false;
  if (tracking === "PENDING" && !mapped?.disposed) {
    const cost = money.capitalized_cost ?? money.original_cost;
    if (cost === null) fail("original_cost", "ASSET_OPENING_INVALID", "A fixed asset needs its historical cost. A missing invoice is noted in evidence, never entered as zero.");
    else {
      if (cost === 0n) warn("original_cost", "ASSET_OPENING_VALUE_MISMATCH", "The cost is zero; confirm this is not a missing value.");
      const acc = money.accumulated_depreciation ?? 0n;
      const imp = money.accumulated_impairment ?? 0n;
      const carrying = cost - acc - imp + (adj.cents ?? 0n);
      if (carrying < 0n) fail("accumulated_depreciation", "ASSET_OPENING_VALUE_MISMATCH", "Accumulated depreciation and impairment exceed the cost.");
      if (money.opening_book_value !== null && money.opening_book_value !== carrying) {
        warn("opening_book_value", "ASSET_OPENING_VALUE_MISMATCH", `The opening value ${centsText(money.opening_book_value)} does not agree with cost − depreciation − impairment ± adjustments = ${centsText(carrying)}; Finance reviews it.`);
        review = true;
      }
      const residual = money.residual_value ?? 0n;
      if (residual > carrying && carrying >= 0n) { warn("residual_value", "ASSET_OPENING_DEPRECIATION_INVALID", "The residual value is above the carrying value."); review = true; }
      if (carrying > residual && remaining === null && method !== "none") { warn("remaining_useful_life_months", "ASSET_OPENING_DEPRECIATION_INVALID", "Without a remaining useful life, depreciation cannot continue; Finance completes it."); review = true; }
      if (!d.evidence) warn("evidence", "ASSET_OPENING_INVALID", "No purchase evidence is recorded.");
      position = { currency, originalCost: money.original_cost !== null ? centsText(money.original_cost) : null, capitalizedCost: centsText(cost), accumulatedDepreciation: centsText(acc), accumulatedImpairment: centsText(imp),
        otherAdjustments: centsText(adj.cents ?? 0n), openingCarryingAmount: centsText(carrying < 0n ? 0n : carrying), residualValue: centsText(residual), method: method ?? category?.depreciation_method ?? "straight_line",
        usefulLife, remaining, fullyDepreciated: carrying <= residual, review };
    }
  }
  // Identity: within the file, then against the register.
  const keys = { legacy: normalizeIdentifier(d.existing_asset_code), serial: normalizeIdentifier(d.serial_number), tag: normalizeIdentifier(d.asset_tag) };
  for (const [kind, field] of [["legacy", "existing_asset_code"], ["serial", "serial_number"], ["tag", "asset_tag"]]) {
    const v = keys[kind];
    if (!v) continue;
    const earlier = refs.file[kind].get(v);
    if (earlier && earlier !== rowNumber) fail(field, "ASSET_OPENING_DUPLICATE", `${field.replace(/_/g, " ")} ${d[field]} repeats row ${earlier}.`);
    else refs.file[kind].set(v, rowNumber);
  }
  const matches = [];
  const add = (asset, reason, strong) => { if (!matches.some((m) => m.assetId === asset.id)) matches.push({ assetId: asset.id, code: asset.asset_number, name: asset.name, reason, strong }); };
  for (const a of refs.register.legacy.get(keys.legacy) ?? []) add(a, `previous code ${d.existing_asset_code}`, true);
  for (const a of refs.register.tag.get(keys.tag) ?? []) add(a, `asset tag ${d.asset_tag}`, true);
  for (const a of refs.register.serial.get(keys.serial) ?? []) {
    const sameMaker = !d.manufacturer || !a.manufacturer || normalizeIdentifier(a.manufacturer) === normalizeIdentifier(d.manufacturer);
    if (sameMaker) add(a, `serial ${d.serial_number}${a.manufacturer ? ` (${a.manufacturer})` : ""}`, true);
  }
  const data = { ...d, ownership, tracking, condition, currency, lifecycle: mapped?.lifecycle ?? null, hold: mapped?.hold ?? null, missing: Boolean(mapped?.missing), lost: Boolean(mapped?.lost),
    disposed: Boolean(mapped?.disposed), dates, categoryId: category?.id ?? null, locationId: location?.id ?? null, storeId: store?.id ?? null, custodianUserId: custodian?.id ?? null,
    departmentId: department?.id ?? null, supplierId: supplier?.id ?? null, position };
  return { data, errors, warnings, matches };
}
