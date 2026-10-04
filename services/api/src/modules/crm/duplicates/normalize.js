// Comparable forms of the values duplicates are matched on. The database
// keeps the same forms in its normalized columns (tenant.crm_normalize_*);
// these are the JavaScript equivalents, used to take the per-key locks and
// available to importers and integrations. The stored display value is never
// rewritten: these are for comparison only.
const text = (value) => String(value ?? "").trim();

// Trim and lowercase. No provider-specific guesses (Gmail dots and the like).
export function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// The national part of the number: its last ten digits. The country code and
// the trunk zero are how a number was typed, not who it reaches, so
// "+91 98765 43210", "09876543210" and "9876543210" all become "9876543210".
// The same rule as tenant.crm_normalize_phone in the database.
export function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits.slice(-10);
}

const LEGAL_SUFFIXES = /\b(private limited|pvt\.? ltd\.?|pvt|private|limited|ltd\.?|llp|llc|inc\.?|incorporated|corporation|corp\.?|company|co\.?|plc|gmbh)\b/g;

// "ABC Pvt. Ltd." and "ABC Private Limited" compare as "abc".
export function normalizeCompanyName(value) {
  const name = text(value).toLowerCase().replace(/&/g, " and ").replace(LEGAL_SUFFIXES, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return name || null;
}

// "https://www.abc.com/", "http://abc.com" and "www.abc.com" are all "abc.com".
export function normalizeDomain(value) {
  const domain = text(value).toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

export function normalizeGstin(value) {
  const gstin = text(value).toUpperCase().replace(/\s+/g, "");
  return gstin || null;
}
