// Phone numbers, read the same way on the server and in the browser: parsed for a country (the record's, else the organization's),
// checked against that country's numbering plan, and kept in international E.164 form (+919876543210), which every country's screen
// can show and dial and duplicate matching compares.
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

// value: what was typed; country: ISO 3166 alpha-2 for numbers typed without +country code.
// Returns { e164, valid, country, display, error } — error is a sentence for the person typing it (null when empty or valid).
export function readPhone(value, country = "IN") {
  const raw = String(value ?? "").trim();
  if (!raw) return { e164: null, valid: false, country: null, display: "", error: null };
  const parsed = parsePhoneNumberFromString(raw, (country || "IN").toUpperCase());
  if (!parsed || !parsed.isValid())
    return { e164: null, valid: false, country: null, display: raw, error: `This is not a valid phone number${raw.startsWith("+") ? "" : ` for ${(country || "IN").toUpperCase()}`}. Include the country code if it is from another country.` };
  return { e164: parsed.number, valid: true, country: parsed.country ?? null, display: parsed.formatInternational(), error: null };
}

// How a stored number is shown: grouped the international way (+91 98765 43210); anything unreadable as typed.
export function formatPhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = raw.startsWith("+") ? parsePhoneNumberFromString(raw) : null;
  return parsed?.isValid() ? parsed.formatInternational() : raw;
}
