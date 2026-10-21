// Choices for time zones, Indian states and months (Shared Platform plan 3): the company profile and the person's own profile pick
// from these instead of typing codes. Asia/Kolkata comes first. (Signup asks none of these: India, INR and the browser's zone.)
import { GST_STATES } from "@vercentlabs/shared-types";

export type Option = { value: string; label: string };

// Every IANA time zone the browser knows, Asia/Kolkata first; a short fallback list where the browser cannot list them.
export function timeZoneOptions(): Option[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.length) zones = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];
  const unique = ["Asia/Kolkata", ...zones.filter((zone) => zone !== "Asia/Kolkata")];
  return unique.map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }));
}

export const STATE_OPTIONS: Option[] = GST_STATES.map((state: { code: string; name: string }) => ({ value: state.code, label: `${state.name} (${state.code})` }));

export const MONTH_OPTIONS: Option[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  .map((label, index) => ({ value: String(index + 1), label }));
