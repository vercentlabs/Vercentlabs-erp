// The time zone the workspace shows times in: the person's own time zone if they set one, otherwise the organization's (the session
// resolves which). The workspace provider sets it in the browser before anything renders, so every formatter that is not given a zone
// shows "3:30 pm" for the same moment wherever the person's computer happens to be. Without it (the server, tests) formatters fall back
// to the runtime's zone, as before.
let current: string | undefined;

export function setDisplayTimeZone(timeZone: string | null | undefined) {
  if (typeof window === "undefined") return; // never shared between requests on the server
  current = timeZone ? (timeZone === "Asia/Calcutta" ? "Asia/Kolkata" : timeZone) : undefined;
}

export function displayTimeZone(): string | undefined {
  return current;
}

// "YYYY-MM-DD" for a moment as a day in the display time zone (today, a due date's day).
export function dayInDisplayZone(value: Date = new Date()): string {
  return value.toLocaleDateString("en-CA", { timeZone: current });
}

// The person's date format (Profile › Date format: DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY…); unset, a date reads 22 Oct 2026 (Sales plan).
let dateFormat: string | undefined;

export function setDisplayDateFormat(format: string | null | undefined) {
  if (typeof window === "undefined") return;
  dateFormat = format || undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "YYYY-MM-DD" in the display date format.
export function formatDisplayDay(day: string): string {
  const [year, month, date] = day.slice(0, 10).split("-");
  switch (dateFormat) {
    case "DD/MM/YYYY": return `${date}/${month}/${year}`;
    case "DD-MM-YYYY": return `${date}-${month}-${year}`;
    case "YYYY-MM-DD": return `${year}-${month}-${date}`;
    case "MM/DD/YYYY": return `${month}/${date}/${year}`;
    default: return `${Number(date)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
  }
}
