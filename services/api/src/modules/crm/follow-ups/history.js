// The follow-up's history: one row per meaningful change, never edited or removed.
// "Oct 4 scheduled for Oct 6 → Oct 6 rescheduled to Oct 8 → Oct 8 completed."

// A moment as people read it, in the organization's time zone: "11 Oct 2026, 12:43 am IST".
export function formatMoment(value, timeZone = "Asia/Kolkata") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const options = { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return date.toLocaleString("en-IN", { ...options, timeZone });
  } catch {
    return date.toLocaleString("en-IN", { ...options, timeZone: "Asia/Kolkata" });
  }
}

// A follow-up's own date (and time), already in the organization's time zone: "12 Oct 2026" or "12 Oct 2026, 11:00 am".
export function formatLocalDate(date, time = null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!match) return String(date ?? "");
  const [hour, minute] = time && /^\d{2}:\d{2}$/.test(time) ? time.split(":").map(Number) : [0, 0];
  const moment = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute));
  const day = moment.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return time ? `${day}, ${moment.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })}` : day;
}

export async function organizationTimezone(client, context) {
  const row = (await client.query(`SELECT timezone FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0];
  return row?.timezone || "Asia/Kolkata";
}

// Older entries were written with raw UTC times (2026-10-10T19:13:29.802Z); they are shown in local time too.
const ISO_MOMENT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/g;
const HAS_ISO_MOMENT = new RegExp(ISO_MOMENT.source);
// …and follow-up dates as "2026-10-12 11:00" / "2026-10-12" (already local), shown as "12 Oct 2026, 11:00 am".
const LOCAL_DATE = /\b(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\b(?!T)/g;
const readable = (summary, timeZone) => String(summary ?? "")
  .replace(ISO_MOMENT, (moment) => formatMoment(moment, timeZone))
  .replace(LOCAL_DATE, (_whole, date, time) => formatLocalDate(date, time ?? null));

export async function recordFollowUpHistory(client, context, followUpId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.crm_follow_up_history (organization_id, follow_up_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, followUpId, eventType, String(summary).slice(0, 500), JSON.stringify(changes ?? {}), context.userId ?? null],
  );
}

export async function listFollowUpHistoryEntries(client, context, followUpId) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name
       FROM tenant.crm_follow_up_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.follow_up_id = $2
      ORDER BY history.created_at DESC, history.id DESC`,
    [context.organizationId, followUpId],
  );
  const timeZone = rows.some((row) => HAS_ISO_MOMENT.test(row.summary ?? "")) ? await organizationTimezone(client, context) : "Asia/Kolkata";
  return rows.map((row) => ({
    id: row.id, eventType: row.event_type,
    summary: readable(row.summary, timeZone),
    changes: row.changes, createdAt: row.created_at, actorName: row.actor_name ?? null,
  }));
}
