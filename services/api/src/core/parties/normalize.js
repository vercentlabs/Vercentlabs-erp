// Comparable forms of a business party's identity (email, phone, company name, domain, GSTIN) — Foundation, used by CRM, Sales and
// imports alike (CRM plan 5.9 moved it here from crm/duplicates). Comparable forms of the values duplicates are matched on. The database
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
// Search text that is a phone number ("+91 98765 43211", "98765-43211", "9876543211"): its digits, as stored in the normalized phone
// columns (the last ten). Anything with letters ("OPP-00002") is not a phone search.
export function phoneSearchDigits(value) {
  const raw = text(value);
  if (!/^[\d\s+\-().]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5) return null;
  if (raw.startsWith("+") && !digits.startsWith("91")) return digits;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Indian numbers compare on their last ten digits (+91 98765 43211 = 098765 43211 = 9876543211). A number written with another country
// code (+44, +971) keeps all its digits, so it never falsely matches an Indian one. Same rule as tenant.crm_normalize_phone.
export function normalizePhone(value) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (raw.startsWith("+") && !digits.startsWith("91")) return digits;
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
