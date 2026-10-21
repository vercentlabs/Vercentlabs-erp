// Values as people type them in spreadsheets (Tally, Busy, Vyapar, Excel exports), turned into what CRM stores — shared by the lead,
// company and contact imports so "India", "Registered - Regular" or "Net 30" mean the same everywhere.
import { GST_TREATMENTS } from "@vercentlabs/shared-types";

// Country names (and codes) to ISO codes, from the platform's own region names ("India" -> IN, "United Arab Emirates" -> AE).
let COUNTRY_BY_NAME = null;
export function countryCodeOf(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  if (!COUNTRY_BY_NAME) {
    COUNTRY_BY_NAME = new Map([["usa", "US"], ["uk", "GB"], ["uae", "AE"], ["bharat", "IN"]]);
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a += 1) for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      try { const name = names.of(code); if (name && name !== code) COUNTRY_BY_NAME.set(name.toLowerCase(), code); } catch { /* not a region */ }
    }
  }
  return COUNTRY_BY_NAME.get(raw.toLowerCase().replace(/\s+/g, " ")) ?? null;
}

const plain = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// GST treatment by code or label, however the dash or case is written ("Registered - Regular", "registered_regular", "Regular",
// "Composition", "Unregistered", "B2C" for a consumer). null when not recognised.
const TREATMENT_WORDS = new Map([
  ...GST_TREATMENTS.flatMap(({ code, label }) => [[plain(code), code], [plain(label), code]]),
  ["regular", "registered_regular"], ["registered", "registered_regular"], ["composition", "registered_composition"],
  ["b2c", "consumer"], ["unregistered business", "unregistered"], ["export", "overseas"], ["sez unit", "sez"],
]);
export function gstTreatmentOf(value) {
  const key = plain(value);
  return key ? TREATMENT_WORDS.get(key) ?? null : null;
}
