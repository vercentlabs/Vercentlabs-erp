// Today in the organization's time zone, not the database clock's (UTC) — Procurement plan Phase 0, bug 8: between 00:00 and 05:30 IST
// documents were dated yesterday and overdue counts were a day off. No imports, so any Procurement file (including SQL built at load,
// such as the order list's progress) can use it without an import cycle. orgRef: SQL for the organization id (a column or a parameter).
export const orgTodaySql = (orgRef) =>
  `(now() AT TIME ZONE COALESCE(NULLIF((SELECT organization.timezone FROM public.organizations organization WHERE organization.id = ${orgRef}), ''), 'Asia/Kolkata'))::date`;

export async function databaseToday(client, organizationId) {
  return (await client.query(`SELECT ${orgTodaySql("$1::uuid")}::text AS today`, [organizationId])).rows[0].today;
}
