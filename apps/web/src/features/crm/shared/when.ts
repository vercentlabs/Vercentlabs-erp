// How CRM shows a scheduled moment: 12-hour Indian time ("2:30 pm") and a short day ("Wed 14 Oct"), as Home does. A time as typed ("14:30")
// is never shown raw.
export function clockLabel(time: string | null | undefined): string {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).replace(/\s?(AM|PM)$/i, (m) => ` ${m.trim().toLowerCase()}`);
}

// "Wed 14 Oct" (with the year when it is not this year).
export function dayLabel(date: string | null | undefined): string {
  if (!date) return "";
  const at = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(at.getTime())) return date;
  const sameYear = at.getFullYear() === new Date().getFullYear();
  return at.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).replace(",", "");
}

// "Wed 14 Oct, 2:30 pm" — a date with an optional time.
export function whenLabel(date: string | null | undefined, time?: string | null): string {
  const day = dayLabel(date);
  return time ? `${day}, ${clockLabel(time)}` : day;
}

// "14 Oct 2026" for a plain date.
export function dateLabel(date: string | null | undefined): string {
  if (!date) return "";
  const at = new Date(date.length <= 10 ? `${date}T00:00:00` : date);
  if (Number.isNaN(at.getTime())) return date;
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
