// One place for turning stored values into words a person would use. Backend values stay canonical (ISO
// timestamps, snake_case enums, integer reminder minutes, country and currency codes); this file only translates.

const ACRONYMS: Record<string, string> = { crm: "CRM", sms: "SMS", url: "URL", id: "ID", pan: "PAN", gstin: "GSTIN", api: "API", ip: "IP", sla: "SLA", roi: "ROI", ai: "AI" };
const SPECIAL: Record<string, string> = { in_app: "In app", whatsapp: "WhatsApp", not_reviewed: "Not reviewed", closed_won: "Closed won", closed_lost: "Closed lost" };

// not_reviewed -> "Not reviewed", firstName -> "First name", in_app -> "In app"
export function humanize(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value);
  if (SPECIAL[raw]) return SPECIAL[raw];
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => ACRONYMS[word] ?? word);
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const REGION_NAMES = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return REGION_NAMES?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const COUNTRY_CODES = ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "FR", "NL", "SA", "QA", "KW", "OM", "BH", "MY", "ID", "TH", "PH", "VN", "JP", "KR", "CN", "HK", "NZ", "ZA", "NG", "KE", "EG", "BD", "LK", "NP", "PK", "IE", "ES", "IT", "SE", "NO", "DK", "CH", "BR", "MX"];

const CURRENCY_NAMES = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "currency" }) : null;
export function currencyName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return CURRENCY_NAMES?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
export const CURRENCY_CODES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "SAR"];

// 12,50,000 rendered as the currency's own symbol and grouping, never a bare number when the currency is known.
export function formatMoney(currencyCode: string | null | undefined, value: number | string | null | undefined, options: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (!currencyCode) return numeric.toLocaleString("en-IN");
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode.toUpperCase(), maximumFractionDigits: numeric % 1 === 0 ? 0 : 2, notation: options.compact ? "compact" : "standard" }).format(numeric);
  } catch {
    return `${currencyCode} ${numeric.toLocaleString("en-IN")}`;
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "23 Sept 2026"; the year is always shown so a date is never ambiguous.
export function formatDate(value: string | Date | null | undefined, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone });
}

// "23 Sept 2026, 3:30 pm IST"
export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone });
}

// India Standard Time (GMT+5:30), whichever alias (Asia/Kolkata, Asia/Calcutta) the browser or server reports.
const TIMEZONE_ALIASES: Record<string, string> = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu" };
export function canonicalTimezone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  return TIMEZONE_ALIASES[timeZone] ?? timeZone;
}
export function timezoneLabel(timeZone: string | null | undefined, at: Date = new Date()): string {
  const zone = canonicalTimezone(timeZone);
  try {
    const long = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value;
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value;
    const gmt = offset === "GMT" ? "GMT+0:00" : (offset ?? "").replace("GMT", "GMT").replace(/([+-])0?(\d{1,2}):?(\d{2})?/, (_m, sign, h, m) => `${sign}${h}:${m ?? "00"}`);
    return `${long ?? zone} (${gmt})`;
  } catch {
    return zone;
  }
}
export function browserTimezone(): string {
  try {
    return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "UTC";
  }
}

// A local wall-clock date + time in a zone -> the ISO instant the backend stores.
export function localToIso(date: string, time: string, timeZone?: string): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) return "";
  if (!timeZone || timeZone === browserTimezone()) return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
  // Zone other than the browser's: find the UTC instant whose wall clock in that zone equals the input.
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += Date.UTC(y, m - 1, d, hh, mm) - shown;
  }
  return new Date(guess).toISOString();
}

// ISO instant -> { date: "2026-09-23", time: "15:30" } as seen on a wall clock in the zone.
export function isoToLocalParts(value: string | null | undefined, timeZone?: string): { date: string; time: string } {
  const date = toDate(value);
  if (!date) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

// ------------------------------------------------------------------ reminders (stored as minutes before due)
export const REMINDER_PRESETS: Array<{ minutes: number; label: string }> = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 240, label: "4 hours before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 0, label: "At due time" },
];

export function reminderLabel(minutes: number): string {
  if (minutes === 0) return "At due time";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} before`;
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

// 90 -> "1 hour 30 minutes", 1440 -> "1 day"
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return "";
  let left = Math.round(Number(minutes));
  if (left === 0) return "0 minutes";
  const parts: string[] = [];
  for (const [size, unit] of [[1440, "day"], [60, "hour"], [1, "minute"]] as const) {
    const n = Math.floor(left / size);
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? "" : "s"}`);
    left -= n * size;
  }
  return parts.join(" ");
}

export function reminderOffsetsLabel(offsets: number[] | null | undefined): string {
  if (!offsets || offsets.length === 0) return "No reminders";
  return [...offsets].sort((a, b) => b - a).map(reminderLabel).join(", ");
}

// ------------------------------------------------------------------ urgency
export type DueState = "overdue" | "today" | "upcoming" | "none";
export function dueState(value: string | Date | null | undefined, now: Date = new Date(), timeZone?: string): DueState {
  const date = toDate(value);
  if (!date) return "none";
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  if (date.getTime() < now.getTime() && dayOf(date) !== dayOf(now)) return "overdue";
  if (dayOf(date) === dayOf(now)) return date.getTime() < now.getTime() ? "overdue" : "today";
  return "upcoming";
}

export function dueLabel(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  const state = dueState(date, now);
  const days = Math.round((now.getTime() - date.getTime()) / 86_400_000);
  if (state === "overdue") return days >= 1 ? `Overdue by ${days} day${days === 1 ? "" : "s"}` : "Overdue";
  if (state === "today") return "Due today";
  const ahead = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  return ahead <= 1 ? "Due tomorrow" : `Due in ${ahead} days`;
}

// A score shown with its scale; thresholds are only named when the caller supplies them.
export function scoreLabel(score: number | null | undefined, max = 100, band?: string | null): string {
  if (score === null || score === undefined) return "";
  return band ? `${score} / ${max} - ${band}` : `${score} / ${max}`;
}
