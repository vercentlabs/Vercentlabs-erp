// CSV cells for CRM exports. A moment (Date, or ISO text with a time) is written in the organization's time zone as "15 Oct 2026 10:00"
// — never UTC ISO text, which reads 5½ hours off in a spreadsheet; a day stays "2026-10-15". A value starting with a formula
// character is guarded so it never runs in a spreadsheet.
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export async function organizationTimeZone(client, context) {
  return (await client.query(`SELECT timezone FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.timezone || "UTC";
}

export function csvCellWriter(timeZone = "UTC") {
  let format;
  try {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const moment = (date) => format.format(date).replace(",", "");
  return (value) => {
    let cell = value === null || value === undefined ? ""
      : value instanceof Date ? (Number.isNaN(value.getTime()) ? "" : moment(value))
      : typeof value === "string" && MOMENT.test(value) && !Number.isNaN(Date.parse(value)) ? moment(new Date(value))
      : String(value);
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  };
}

// The organization's today, for an export's file name.
export function dayIn(timeZone = "UTC") {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); }
}
