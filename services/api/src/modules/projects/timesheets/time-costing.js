// Projects — Timesheets, labor costing: the internal hourly rates (per employee, optionally for one project), effective-dated and versioned,
// kept by whoever manages rates and seen only by those who may see cost. Approved time takes the rate effective on its work date as a
// snapshot — a later rate never reprices it. Time approved before any rate existed is costed once a rate is found (recoverTimePosting),
// idempotently. Nothing here pays anyone, posts a journal or touches Manufacturing's labor costing: project time is its own source.
import { has, seesAll, text, userNames, uuid } from "../project-core.js";
import { TIME, hoursLabel, loadProjectRow, timeError, timePolicy, viewsCost, workDay } from "./time-rules.js";
import { timeEvent } from "./time-entries.js";

// The rate for this person's work on this project on this day: the project's own rate first, then their general rate.
export async function rateFor(client, c, userId, projectId, day) {
  return (await client.query(`SELECT id, hourly_rate, currency, rate_version, project_id FROM tenant.project_labor_rates
      WHERE organization_id = $1 AND user_id = $2 AND (project_id = $3 OR project_id IS NULL) AND effective_from <= $4::date AND (effective_to IS NULL OR effective_to >= $4::date)
      ORDER BY project_id NULLS LAST, effective_from DESC, rate_version DESC LIMIT 1`, [c.organizationId, userId, projectId, day])).rows[0] ?? null;
}
const amountOf = (minutes, rate) => Math.round((Number(minutes) * Number(rate) / 60) * 100) / 100;

// Fix approved time's cost basis, once. Returns whether a rate was found.
export async function costEntry(client, c, entry) {
  if (entry.cost_recorded_at) return true;
  const day = entry.work_date_text ?? (entry.work_date instanceof Date ? entry.work_date.toISOString().slice(0, 10) : String(entry.work_date).slice(0, 10));
  const rate = await rateFor(client, c, entry.employee_user_id, entry.project_id, day);
  if (!rate) {
    await client.query(`UPDATE tenant.project_time_entries SET review_flags = CASE WHEN review_flags ? 'NO_RATE' THEN review_flags ELSE review_flags || '["NO_RATE"]'::jsonb END
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id]);
    return false;
  }
  await client.query(`UPDATE tenant.project_time_entries SET cost_rate_id = $3, cost_rate = $4, cost_currency = $5, cost_amount = $6, cost_recorded_at = now(), review_flags = review_flags - 'NO_RATE'
      WHERE organization_id = $1 AND id = $2 AND cost_recorded_at IS NULL`, [c.organizationId, entry.id, rate.id, rate.hourly_rate, rate.currency, amountOf(entry.duration_minutes, rate.hourly_rate)]);
  return true;
}

// input: { userId, projectId?, hourlyRate, currency?, effectiveFrom, reason? } — a new version from that day on; the previous open rate of
// the same scope ends the day before. History is not rewritten: a rate starts after the latest one of its scope.
export async function setProjectLaborRate(client, c, input = {}) {
  if (!has(c, TIME.rates)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const userId = uuid(input.userId, "Employee");
  const projectId = input.projectId ? (await loadProjectRow(client, c, input.projectId)).id : null;
  const rate = Number(input.hourlyRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1e9) throw timeError(400, "TIME_RATE_INVALID", "Enter an hourly rate of zero or more.");
  const from = workDay(input.effectiveFrom, "effective date");
  const policy = await timePolicy(client, c);
  const currency = text(input.currency, 3).toUpperCase() || policy.currency;
  if (!/^[A-Z]{3}$/.test(currency)) throw timeError(400, "TIME_RATE_INVALID", "Enter a three-letter currency code.");
  // One writer per person's rates at a time.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`labor-rate:${c.organizationId}:${userId}`]);
  const scope = `organization_id = $1 AND user_id = $2 AND project_id IS NOT DISTINCT FROM $3`;
  const latest = (await client.query(`SELECT id, to_char(effective_from, 'YYYY-MM-DD') AS from_day, rate_version FROM tenant.project_labor_rates WHERE ${scope} ORDER BY effective_from DESC, rate_version DESC LIMIT 1`,
    [c.organizationId, userId, projectId])).rows[0];
  if (latest && latest.from_day >= from) throw timeError(409, "TIME_RATE_INVALID", `A rate already starts on ${latest.from_day}; a new rate starts after it.`);
  await client.query(`UPDATE tenant.project_labor_rates SET effective_to = $4::date - 1 WHERE ${scope} AND effective_to IS NULL`, [c.organizationId, userId, projectId, from]);
  const version = Number((await client.query(`SELECT COALESCE(max(rate_version), 0) + 1 AS v FROM tenant.project_labor_rates WHERE ${scope}`, [c.organizationId, userId, projectId])).rows[0].v);
  const row = (await client.query(`INSERT INTO tenant.project_labor_rates (organization_id, user_id, project_id, hourly_rate, currency, effective_from, rate_version, reason, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [c.organizationId, userId, projectId, rate, currency, from, version, text(input.reason, 500) || null, c.userId ?? null])).rows[0];
  return { rateId: row.id, version, effectiveFrom: from };
}

export async function listProjectLaborRates(client, c, filters = {}) {
  if (!viewsCost(c) && !has(c, TIME.rates)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT rate.*, to_char(rate.effective_from, 'YYYY-MM-DD') AS from_day, to_char(rate.effective_to, 'YYYY-MM-DD') AS to_day, project.project_code, project.name AS project_name
      FROM tenant.project_labor_rates rate LEFT JOIN tenant.projects project ON project.id = rate.project_id
      WHERE rate.organization_id = $1 AND ($2::uuid IS NULL OR rate.user_id = $2) ORDER BY rate.user_id, rate.project_id NULLS FIRST, rate.effective_from DESC`,
  [c.organizationId, filters.userId ? uuid(filters.userId, "Employee") : null])).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.user_id, row.created_by]));
  return { rows: rows.map((row) => ({ id: row.id, userId: row.user_id, employee: names.get(row.user_id) ?? null, projectId: row.project_id, project: row.project_code ? `${row.project_code} · ${row.project_name ?? ""}` : null,
    hourlyRate: String(row.hourly_rate), currency: row.currency, effectiveFrom: row.from_day, effectiveTo: row.to_day, version: row.rate_version, reason: row.reason,
    createdBy: names.get(row.created_by) ?? null, createdAt: row.created_at })), can: { manage: has(c, TIME.rates) } };
}

// Cost the approved time that still has no rate, where one now exists (a rate added after approval). Idempotent: costed time is skipped.
export async function recoverTimePosting(client, c, input = {}) {
  if (!has(c, TIME.rates)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT *, to_char(work_date, 'YYYY-MM-DD') AS work_date_text FROM tenant.project_time_entries
      WHERE organization_id = $1 AND entry_status = 'APPROVED' AND cost_recorded_at IS NULL AND ($2::uuid IS NULL OR project_id = $2) ORDER BY id FOR UPDATE`,
  [c.organizationId, input.projectId ? uuid(input.projectId, "Project") : null])).rows;
  let costed = 0;
  for (const entry of rows) {
    if (await costEntry(client, c, entry)) {
      costed += 1;
      await timeEvent(client, c, { projectId: entry.project_id, employeeUserId: entry.employee_user_id, entryId: entry.id, action: "COSTED", summary: "Labor rate applied after approval" });
    }
  }
  return { checked: rows.length, costed, stillMissing: rows.length - costed };
}

// The costing read model: approved hours (and, for those who may see cost, their cost) of a project, by employee.
export async function getApprovedProjectHours(client, c, projectId, filters = {}) {
  const project = await loadProjectRow(client, c, projectId);
  if (!(has(c, TIME.viewTeam) && (seesAll(c) || project.manager_user_id === c.userId)) && !viewsCost(c)) throw timeError(403, "TIME_PERMISSION_DENIED");
  const from = filters.from ? workDay(filters.from, "start date") : null;
  const to = filters.to ? workDay(filters.to, "end date") : null;
  const rows = (await client.query(`SELECT employee_user_id, sum(duration_minutes)::int AS minutes, sum(duration_minutes) FILTER (WHERE billable)::int AS billable,
        sum(cost_amount) AS cost, count(*) FILTER (WHERE cost_recorded_at IS NULL)::int AS missing, min(cost_currency) AS currency
      FROM tenant.project_time_entries WHERE organization_id = $1 AND project_id = $2 AND entry_status = 'APPROVED' AND ($3::date IS NULL OR work_date >= $3) AND ($4::date IS NULL OR work_date <= $4)
      GROUP BY employee_user_id`, [c.organizationId, project.id, from, to])).rows;
  const names = await userNames(client, rows.map((row) => row.employee_user_id));
  const cost = viewsCost(c);
  return {
    projectId: project.id, from, to,
    rows: rows.map((row) => ({ employeeUserId: row.employee_user_id, employee: names.get(row.employee_user_id) ?? null, approvedMinutes: row.minutes, approvedHours: hoursLabel(row.minutes), billableMinutes: row.billable ?? 0,
      ...(cost ? { cost: row.cost === null ? null : String(row.cost), currency: row.currency, entriesWithoutRate: row.missing } : {}) })),
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    ...(cost ? { totalCost: String(rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0)), entriesWithoutRate: rows.reduce((sum, row) => sum + row.missing, 0) } : {}),
  };
}
