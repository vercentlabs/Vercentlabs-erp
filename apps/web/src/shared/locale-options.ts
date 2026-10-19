// Choices for countries, currencies, time zones and Indian states (Shared Platform plan 3): sign-up, the company profile and the
// person's own profile pick from these instead of typing codes. India, INR and Asia/Kolkata come first.
import { GST_STATES } from "@vercentlabs/shared-types";

export type Option = { value: string; label: string };

export const COUNTRY_OPTIONS: Option[] = [
  { value: "IN", label: "India" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SG", label: "Singapore" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "NP", label: "Nepal" },
  { value: "BD", label: "Bangladesh" },
  { value: "LK", label: "Sri Lanka" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "AU", label: "Australia" },
  { value: "CA", label: "Canada" },
  { value: "DE", label: "Germany" },
];

export const CURRENCY_OPTIONS: Option[] = [
  { value: "INR", label: "Indian Rupee (₹)" },
  { value: "AED", label: "UAE Dirham" },
  { value: "SGD", label: "Singapore Dollar" },
  { value: "USD", label: "US Dollar ($)" },
  { value: "GBP", label: "Pound Sterling (£)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "NPR", label: "Nepalese Rupee" },
  { value: "BDT", label: "Bangladeshi Taka" },
  { value: "LKR", label: "Sri Lankan Rupee" },
  { value: "SAR", label: "Saudi Riyal" },
  { value: "AUD", label: "Australian Dollar" },
  { value: "CAD", label: "Canadian Dollar" },
];

export const DEFAULT_CURRENCY_FOR_COUNTRY: Record<string, string> = {
  IN: "INR", AE: "AED", SG: "SGD", US: "USD", GB: "GBP", NP: "NPR", BD: "BDT", LK: "LKR", SA: "SAR", AU: "AUD", CA: "CAD", DE: "EUR",
};
export const DEFAULT_TIMEZONE_FOR_COUNTRY: Record<string, string> = {
  IN: "Asia/Kolkata", AE: "Asia/Dubai", SG: "Asia/Singapore", US: "America/New_York", GB: "Europe/London", NP: "Asia/Kathmandu",
  BD: "Asia/Dhaka", LK: "Asia/Colombo", SA: "Asia/Riyadh", AU: "Australia/Sydney", CA: "America/Toronto", DE: "Europe/Berlin",
};

// Every IANA time zone the browser knows, Asia/Kolkata first; a short fallback list where the browser cannot list them.
export function timeZoneOptions(): Option[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.length) zones = Object.values(DEFAULT_TIMEZONE_FOR_COUNTRY);
  const unique = ["Asia/Kolkata", ...zones.filter((zone) => zone !== "Asia/Kolkata")];
  return unique.map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }));
}

export const STATE_OPTIONS: Option[] = GST_STATES.map((state: { code: string; name: string }) => ({ value: state.code, label: `${state.name} (${state.code})` }));

export const MONTH_OPTIONS: Option[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  .map((label, index) => ({ value: String(index + 1), label }));
