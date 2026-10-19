export const DEFAULT_LOCALE = "en-IN";
export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_CURRENCY = "INR";

export function normalizeCurrency(value, fallback = DEFAULT_CURRENCY) {
  const candidate = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(candidate)) throw new TypeError("Currency must be a three-letter ISO code.");
  return candidate;
}

export function assertTimeZone(value) {
  const timeZone = String(value || DEFAULT_TIMEZONE).trim();
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
  catch { throw new TypeError("Timezone must be a valid IANA timezone."); }
  return timeZone;
}

export function formatMoney(amount, options = {}) {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric)) throw new TypeError("Money amount must be finite.");
  return new Intl.NumberFormat(options.locale || DEFAULT_LOCALE, {
    style: "currency",
    currency: normalizeCurrency(options.currency),
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  }).format(numeric);
}

export function formatDateTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(options.locale || DEFAULT_LOCALE, {
    dateStyle: options.dateStyle || "medium",
    timeStyle: options.timeStyle || "short",
    timeZone: assertTimeZone(options.timeZone),
  }).format(date);
}

// The calendar date ("YYYY-MM-DD") of a moment in a time zone: 00:30 IST on 1 April is 1 April in India, though it is still 31 March in UTC.
export function localDay(value = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Date is invalid.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: assertTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// The financial year a moment falls in. With a time zone the date is the company's local date (numbering and invoices must use it);
// without one a Date is read in UTC, and a "YYYY-MM-DD" string is taken as that calendar date.
export function fiscalYearFor(value = new Date(), startMonth = 4, timeZone = null) {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError("Fiscal year start month must be between 1 and 12.");
  let year;
  let month;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) [year, month] = value.split("-").map(Number);
  else {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError("Fiscal year date is invalid.");
    if (timeZone) [year, month] = localDay(date, timeZone).split("-").map(Number);
    else [year, month] = [date.getUTCFullYear(), date.getUTCMonth() + 1];
  }
  const start = month >= startMonth ? year : year - 1;
  return Object.freeze({ startYear: start, endYear: start + 1, label: `${start}-${String(start + 1).slice(-2)}` });
}

// Amount in words in the Indian system (crore, lakh, thousand), as printed on invoices: 123456.50 →
// "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only". Other currencies use their own words for the
// whole and the hundredth part ("US Dollars … and … Cents Only") on the same grouping.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const CURRENCY_WORDS = { INR: ["Rupees", "Paise"], USD: ["US Dollars", "Cents"], EUR: ["Euros", "Cents"], GBP: ["Pounds", "Pence"], AED: ["Dirhams", "Fils"], SGD: ["Singapore Dollars", "Cents"] };

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}
function belowThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}
export function integerInIndianWords(value) {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  if (crore) parts.push(`${crore >= 1000 ? integerInIndianWords(crore) : belowThousand(crore)} Crore`);
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}
export function amountInWords(amount, currency = DEFAULT_CURRENCY) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "";
  const [whole, part] = CURRENCY_WORDS[String(currency || DEFAULT_CURRENCY).toUpperCase()] ?? [String(currency).toUpperCase(), "Cents"];
  const cents = Math.round(Math.abs(numeric) * 100);
  const units = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${numeric < 0 ? "Minus " : ""}${whole} ${integerInIndianWords(units)}${fraction ? ` and ${belowHundred(fraction)} ${part}` : ""} Only`;
}
