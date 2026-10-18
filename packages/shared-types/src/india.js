// Indian tax identity, shared by the API and the web so a GSTIN is read the same way everywhere.
//
// A GSTIN is 15 characters: a 2-digit state code, a 10-character PAN-like body, an entity number, a fixed letter that marks the kind of
// registration, and a check character. Six kinds exist (as GSTN issues them, and as Odoo's l10n_in recognises them); every kind ends
// in the same base-36 check character, which catches nearly every typing slip, so it is verified too.

export const GSTIN_TYPES = Object.freeze([
  // Regular, composition and casual taxpayers (and SEZ units): 2 digits, PAN, entity, Z, check.
  { code: "regular", label: "Regular taxpayer", pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, hasPan: true },
  // Tax deducted at source (government departments and notified deductors): a TAN body, D in the 14th place.
  { code: "tds", label: "TDS deductor", pattern: /^[0-9]{2}[A-Z]{4}[A-Z0-9][0-9]{4}[A-Z][1-9A-Z]D[0-9A-Z]$/, hasPan: false },
  // Tax collected at source by e-commerce operators: a PAN body, C in the 14th place.
  { code: "tcs", label: "E-commerce operator (TCS)", pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]C[0-9A-Z]$/, hasPan: true },
  // Non-resident taxable persons: 4 letters, 5 digits, a letter, a digit, Z.
  { code: "non_resident", label: "Non-resident taxable person", pattern: /^[0-9]{2}[A-Z]{4}[0-9]{5}[A-Z][0-9]Z[0-9A-Z]$/, hasPan: false },
  // UN bodies, embassies and other notified persons (UIN): UN or ON in the 13th–14th places.
  { code: "uin", label: "UN body or embassy (UIN)", pattern: /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]N[0-9A-Z]$/, hasPan: false },
  // Online information and database access services from abroad (OIDAR): state 99, OS in the 13th–14th places.
  { code: "oidar", label: "Overseas online services (OIDAR)", pattern: /^99[0-9]{2}[A-Z]{3}[0-9]{5}OS[0-9A-Z]$/, hasPan: false },
]);

// GST treatment of a customer or company (tenant.business_parties.tax_treatment).
export const GST_TREATMENTS = Object.freeze([
  { code: "registered_regular", label: "Registered – Regular", needsGstin: true },
  { code: "registered_composition", label: "Registered – Composition", needsGstin: true },
  { code: "sez", label: "SEZ", needsGstin: true },
  { code: "deemed_export", label: "Deemed Export", needsGstin: false },
  { code: "unregistered", label: "Unregistered", needsGstin: false },
  { code: "consumer", label: "Consumer", needsGstin: false },
  { code: "overseas", label: "Overseas", needsGstin: false },
]);

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The check character of the first 14 characters of a GSTIN.
export function gstinCheckCharacter(first14) {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = CHARS.indexOf(first14[index]);
    if (value < 0) return null;
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export const normalizeGstin = (value) => String(value ?? "").replace(/[\s-]/g, "").toUpperCase();

// Reads a GSTIN. Returns { gstin, valid, type, typeLabel, stateCode, pan, error } — error is a sentence for the person typing it.
export function parseGstin(value) {
  const gstin = normalizeGstin(value);
  if (!gstin) return { gstin: "", valid: false, type: null, typeLabel: null, stateCode: null, pan: null, error: null };
  if (gstin.length !== 15) return { gstin, valid: false, type: null, typeLabel: null, stateCode: null, pan: null, error: "A GSTIN has 15 characters." };
  const type = GSTIN_TYPES.find((entry) => entry.pattern.test(gstin));
  if (!type) return { gstin, valid: false, type: null, typeLabel: null, stateCode: null, pan: null, error: "This is not a GSTIN format. Check each character." };
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14])
    return { gstin, valid: false, type: type.code, typeLabel: type.label, stateCode: null, pan: null, error: "The last character does not match the rest: check the GSTIN for a typing slip." };
  return { gstin, valid: true, type: type.code, typeLabel: type.label, stateCode: gstin.slice(0, 2), pan: type.hasPan ? gstin.slice(2, 12) : null, error: null };
}

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const isValidPan = (value) => PAN_PATTERN.test(String(value ?? "").trim().toUpperCase());

// An Indian PIN code: six digits, the first not zero.
export const isValidPin = (value) => /^[1-9][0-9]{5}$/.test(String(value ?? "").trim());

// The states and union territories with their GST state codes (as in the GSTIN's first two digits).
export const GST_STATES = Object.freeze([
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
  ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"],
  ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"],
  ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"], ["97", "Other Territory"],
].map(([code, name]) => Object.freeze({ code, name })));

const STATE_ALIASES = Object.freeze({ "orissa": "21", "pondicherry": "34", "nct of delhi": "07", "new delhi": "07", "j&k": "01", "jammu & kashmir": "01",
  "daman and diu": "26", "dadra and nagar haveli": "26", "andaman & nicobar islands": "35", "telengana": "36" });

// An Indian state from a GST state code or a name (case and common spellings forgiven): { code, name } or null.
export function findIndianState({ code, name } = {}) {
  const byCode = String(code ?? "").trim();
  if (byCode) return GST_STATES.find((state) => state.code === byCode.padStart(2, "0")) ?? null;
  const key = String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const aliased = STATE_ALIASES[key];
  return GST_STATES.find((state) => state.code === aliased || state.name.toLowerCase() === key) ?? null;
}
