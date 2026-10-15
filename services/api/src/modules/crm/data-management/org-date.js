// "Today" and "this month" as the organization sees them. Postgres' current_date is the server's UTC day, so between midnight and
// 05:30 in India it is still yesterday; every user-facing "today", "due today", "this month" and default date range uses these
// instead (tasks and follow-ups already do the same through organization.timezone).
//
// `organization` is the SQL for the organization id the query already has: a bound parameter ("$1") or a column
// ("opportunity.organization_id"). The time zone is the organization's own setting.
const zoneOf = (organization) => `(SELECT org_tz.timezone FROM public.organizations org_tz WHERE org_tz.id = ${organization})`;

// The organization's calendar date today.
export const orgToday = (organization = "$1") => `((now() AT TIME ZONE ${zoneOf(organization)})::date)`;

// The first day of the organization's current month.
export const orgMonthStart = (organization = "$1") => `(date_trunc('month', now() AT TIME ZONE ${zoneOf(organization)})::date)`;

// The instant today began in the organization's time zone, for comparing timestamps ("assigned today").
export const orgDayStart = (organization = "$1") =>
  `(date_trunc('day', now() AT TIME ZONE ${zoneOf(organization)}) AT TIME ZONE ${zoneOf(organization)})`;

// The default "this month so far" range for a dashboard, as YYYY-MM-DD strings in the organization's time zone.
export async function orgMonthToDate(client, organizationId) {
  const { rows } = await client.query(
    `SELECT to_char(${orgMonthStart("$1")}, 'YYYY-MM-DD') AS from_date, to_char(${orgToday("$1")}, 'YYYY-MM-DD') AS to_date`,
    [organizationId],
  );
  return { from: rows[0].from_date, to: rows[0].to_date };
}

// A dashboard's { from, to }: the dates the caller gave (YYYY-MM-DD), each defaulting to this month so far in the organization's time zone.
export async function orgPeriod(client, organizationId, input = {}) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
  if (valid(input.from) && valid(input.to)) return { from: input.from, to: input.to };
  const month = await orgMonthToDate(client, organizationId);
  return { from: valid(input.from) ? input.from : month.from, to: valid(input.to) ? input.to : month.to };
}

// The instant the organization's current month began, for comparing timestamps ("new this month").
export const orgMonthStartAt = (organization = "$1") =>
  `(date_trunc('month', now() AT TIME ZONE ${zoneOf(organization)}) AT TIME ZONE ${zoneOf(organization)})`;
