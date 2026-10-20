// HR & Payroll — statutory rules: their versions and the opening year-to-date figures.
//   createStatutoryRule   a new DRAFT version of a family (from a template or by hand): its configuration, effective dates and source.
//   updateStatutoryRule   a draft only.
//   verifyStatutoryRule   someone other than the author verifies it against the law (a note is required) and it becomes ACTIVE; the version
//                         it replaces (same family) ends the day before it starts.
//   retireStatutoryRule   an ACTIVE version stops applying from a date (payslips already made keep the version they used).
//   saveYtdOpening        what an employee earned and paid in tax this financial year before this payroll (cut-over, previous employer).
import { HrError, qx, recordEvent, text, textOrNull, uuid, dateRequired, dateOrNull, has, need, round2 } from "../common.js";
import { ST, STATES, TEMPLATES, TYPES, cleanConfiguration, familyOf } from "./st-rules.js";

const view = (r) => ({ id: r.id, family: r.rule_family, version: r.version_number, type: r.statutory_type, typeLabel: TYPES[r.statutory_type] ?? r.statutory_type, name: r.name, state: r.state,
  stateLabel: r.state ? STATES[r.state] ?? r.state : null, regime: r.tax_regime, status: r.status, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, configuration: r.configuration ?? {},
  source: r.source_reference, verifiedBy: r.verified_by_name ?? null, verifiedAt: r.verified_at, verificationNote: r.verification_note, createdBy: r.created_by_name ?? null, createdById: r.created_by });

export async function listStatutoryRules(client, c, filters = {}) {
  if (!has(c, ST.manage) && !has(c, ST.verify) && !has(c, ST.prepare) && !has(c, ST.reports)) throw new HrError(403, "You do not have permission to see statutory rules.", "HR_FORBIDDEN");
  const values = [c.organizationId];
  let where = "s.organization_id = $1 AND s.rule_family IS NOT NULL";
  if (filters.status) { values.push(String(filters.status)); where += ` AND s.status = $${values.length}`; }
  return (await qx(client, `SELECT s.*, v.full_name AS verified_by_name, cr.full_name AS created_by_name FROM tenant.hr_statutory_components s
      LEFT JOIN public.users v ON v.id = s.verified_by LEFT JOIN public.users cr ON cr.id = s.created_by WHERE ${where} ORDER BY s.rule_family, s.version_number DESC`, values)).rows.map(view);
}
export const listStatutoryTemplates = () => Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, type: t.statutoryType, state: t.state ?? null, regime: t.taxRegime ?? null, source: t.source,
  configuration: t.configuration }));

// input: { template? (EPF | ESI | PT-MH | PT-KA | TDS-NEW), statutoryType?, state?, regime?, name?, configuration?, effectiveFrom, effectiveTo?, source? }
export async function createStatutoryRule(client, c, input = {}) {
  need(c, ST.manage);
  const t = input.template ? TEMPLATES[input.template] : null;
  if (input.template && !t) throw new HrError(400, "Unknown template.", "HR_STATUTORY_INVALID");
  const type = t?.statutoryType ?? String(input.statutoryType ?? "");
  if (!TYPES[type]) throw new HrError(400, "Choose EPF, ESI, Professional Tax or TDS.", "HR_STATUTORY_INVALID");
  const state = type === "professional_tax" ? text(input.state ?? t?.state, 4).toUpperCase() : null;
  if (type === "professional_tax" && !STATES[state]) throw new HrError(400, "Choose the state whose Professional Tax this is.", "HR_STATUTORY_INVALID");
  const regime = type === "tds" ? (input.regime ?? t?.taxRegime ?? "new") : null;
  if (regime && !["new", "old"].includes(regime)) throw new HrError(400, "Choose the new or old tax regime.", "HR_STATUTORY_INVALID");
  if (regime === "old") throw new HrError(400, "TDS under the old regime needs each employee's declarations and is not calculated yet: enter it as a monthly TDS deduction instead.", "HR_STATUTORY_UNSUPPORTED");
  const configuration = cleanConfiguration(type, input.configuration ?? t?.configuration);
  const from = dateRequired(input.effectiveFrom, "Effective from");
  const to = dateOrNull(input.effectiveTo, "Effective to");
  if (to && to < from) throw new HrError(400, "The version ends before it starts.", "HR_STATUTORY_INVALID");
  const family = familyOf(type, { state, regime });
  const version = Number((await client.query(`SELECT COALESCE(max(version_number), 0) + 1 AS n FROM tenant.hr_statutory_components WHERE organization_id = $1 AND rule_family = $2`,
    [c.organizationId, family])).rows[0].n);
  const rates = type === "pf" ? [configuration.employeeRate, configuration.employerEpfRate + configuration.employerEpsRate] : type === "esi" ? [configuration.employeeRate, configuration.employerRate] : [0, 0];
  const row = (await client.query(`INSERT INTO tenant.hr_statutory_components (organization_id, code, name, jurisdiction, statutory_type, employee_rate, employer_rate, wage_ceiling, effective_from, effective_to,
      configuration, active, created_by, calculation_basis, wage_basis, frequency, state, rule_family, version_number, status, tax_regime, source_reference)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,false,$12,$13,$14,'monthly',$15,$16,$17,'DRAFT',$18,$19) RETURNING id`,
  [c.organizationId, `${family}-V${version}`, text(input.name, 120) || t?.name || TYPES[type], t?.jurisdiction ?? (state ? `IN-${state}` : "IN"), type, rates[0], rates[1],
    type === "pf" ? configuration.wageCeiling : type === "esi" ? configuration.wageLimit : null, from, to, JSON.stringify(configuration), c.userId ?? null,
    type === "professional_tax" || type === "tds" ? "slab" : "percentage_of_wage", t?.wageBasis ?? (type === "pf" ? "pf_wage" : type === "esi" ? "esic_wage" : "gross"), state, family, version, regime,
    textOrNull(input.source ?? t?.source, 500)])).rows[0];
  await recordEvent(client, c, "statutory_rule", row.id, "hr.statutory.created", { family, version });
  return { id: row.id, family, version };
}
async function loadRule(client, c, id, lock = true) {
  const row = (await client.query(`SELECT * FROM tenant.hr_statutory_components WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Statutory rule")])).rows[0];
  if (!row || !row.rule_family) throw new HrError(404, "That statutory rule was not found.", "HR_STATUTORY_NOT_FOUND");
  return row;
}
// input: { name?, configuration?, effectiveFrom?, effectiveTo?, source? }
export async function updateStatutoryRule(client, c, id, input = {}) {
  need(c, ST.manage);
  const row = await loadRule(client, c, id);
  if (row.status !== "DRAFT") throw new HrError(409, "Only a draft is changed; create a new version instead.", "HR_STATUTORY_STATE");
  const configuration = input.configuration === undefined ? row.configuration : cleanConfiguration(row.statutory_type, input.configuration);
  const from = input.effectiveFrom === undefined ? String(row.effective_from) : dateRequired(input.effectiveFrom, "Effective from");
  const to = input.effectiveTo === undefined ? (row.effective_to ? String(row.effective_to) : null) : dateOrNull(input.effectiveTo, "Effective to");
  if (to && to < from) throw new HrError(400, "The version ends before it starts.", "HR_STATUTORY_INVALID");
  await client.query(`UPDATE tenant.hr_statutory_components SET name = $2, configuration = $3::jsonb, effective_from = $4, effective_to = $5, source_reference = $6, updated_at = clock_timestamp() WHERE id = $1`,
    [row.id, text(input.name, 120) || row.name, JSON.stringify(configuration), from, to, input.source === undefined ? row.source_reference : textOrNull(input.source, 500)]);
  await recordEvent(client, c, "statutory_rule", row.id, "hr.statutory.updated", {});
  return { id: row.id };
}
// input: { note } — what it was checked against.
export async function verifyStatutoryRule(client, c, id, input = {}) {
  need(c, ST.verify);
  const row = await loadRule(client, c, id);
  if (row.status !== "DRAFT") throw new HrError(409, "Only a draft is verified.", "HR_STATUTORY_STATE");
  if (row.created_by === c.userId && !c.roleSlugs?.includes("organization_owner")) throw new HrError(403, "Someone other than its author verifies a statutory rule.", "SELF_APPROVAL_BLOCKED");
  const note = text(input.note, 1000);
  if (!note) throw new HrError(400, "Say what you verified it against (the act, notification or circular).", "HR_REASON_REQUIRED");
  // The active version it replaces ends the day before.
  await client.query(`UPDATE tenant.hr_statutory_components SET effective_to = ($3::date - 1), updated_at = clock_timestamp()
      WHERE organization_id = $1 AND rule_family = $2 AND status = 'ACTIVE' AND effective_from < $3::date AND (effective_to IS NULL OR effective_to >= $3::date)`,
  [c.organizationId, row.rule_family, row.effective_from]);
  const clash = (await client.query(`SELECT code FROM tenant.hr_statutory_components WHERE organization_id = $1 AND rule_family = $2 AND status = 'ACTIVE' AND id <> $3
      AND effective_from <= COALESCE($5::date, '9999-12-31') AND COALESCE(effective_to, '9999-12-31') >= $4::date`, [c.organizationId, row.rule_family, row.id, row.effective_from, row.effective_to])).rows[0];
  if (clash) throw new HrError(409, `${clash.code} already applies to those dates. Retire it first.`, "HR_STATUTORY_OVERLAP");
  await client.query(`UPDATE tenant.hr_statutory_components SET status = 'ACTIVE', active = true, verified_by = $2, verified_at = clock_timestamp(), verification_note = $3, updated_at = clock_timestamp() WHERE id = $1`,
    [row.id, c.userId ?? null, note]);
  await recordEvent(client, c, "statutory_rule", row.id, "hr.statutory.verified", { note });
  return { id: row.id, status: "ACTIVE" };
}
// input: { from, reason }
export async function retireStatutoryRule(client, c, id, input = {}) {
  need(c, ST.verify);
  const row = await loadRule(client, c, id);
  if (row.status !== "ACTIVE") throw new HrError(409, "Only an active version is retired.", "HR_STATUTORY_STATE");
  const from = dateRequired(input.from, "Stops applying from");
  if (from <= String(row.effective_from)) throw new HrError(400, "It stops after the day it started.", "HR_STATUTORY_INVALID");
  const reason = text(input.reason, 500);
  if (!reason) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  await client.query(`UPDATE tenant.hr_statutory_components SET effective_to = ($2::date - 1), status = CASE WHEN ($2::date - 1) < effective_from THEN 'RETIRED' ELSE status END,
      retired_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [row.id, from]);
  await recordEvent(client, c, "statutory_rule", row.id, "hr.statutory.retired", { from, reason });
  return { id: row.id };
}

// ------------------------------------------------------------------ opening year-to-date figures
export async function listYtdOpenings(client, c, filters = {}) {
  if (!has(c, ST.ytd) && !has(c, ST.prepare)) throw new HrError(403, "You do not have permission to see opening pay.", "HR_FORBIDDEN");
  const values = [c.organizationId];
  let where = "o.organization_id = $1";
  if (filters.financialYear) { values.push(String(filters.financialYear)); where += ` AND o.financial_year = $${values.length}`; }
  return (await qx(client, `SELECT o.*, e.employee_number, e.first_name, e.last_name FROM tenant.hr_payroll_ytd_openings o JOIN tenant.hr_employees e ON e.id = o.employee_id
      WHERE ${where} ORDER BY e.employee_number`, values)).rows.map((o) => ({ id: o.id, employee: { id: o.employee_id, number: o.employee_number, name: `${o.first_name} ${o.last_name ?? ""}`.trim() },
    financialYear: o.financial_year, source: o.source, employerName: o.employer_name, gross: Number(o.gross_earnings), taxable: Number(o.taxable_earnings), tds: Number(o.tds_deducted),
    epf: Number(o.epf_employee), pt: Number(o.professional_tax), note: o.note }));
}
// input: { employeeId, financialYear, source?, employerName?, gross, taxable, tds, epf?, pt?, note? }
export async function saveYtdOpening(client, c, input = {}) {
  need(c, ST.ytd);
  const employeeId = uuid(input.employeeId, "Employee");
  if (!(await client.query(`SELECT 1 FROM tenant.hr_employees WHERE organization_id = $1 AND id = $2`, [c.organizationId, employeeId])).rows[0])
    throw new HrError(404, "That employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  const fy = text(input.financialYear, 7);
  if (!/^\d{4}-\d{2}$/.test(fy)) throw new HrError(400, "The financial year looks like 2026-27.", "HR_STATUTORY_INVALID");
  const source = input.source === "PREVIOUS_EMPLOYER" ? "PREVIOUS_EMPLOYER" : "CUT_OVER";
  const n = (v, label) => { const x = Number(v ?? 0); if (!Number.isFinite(x) || x < 0) throw new HrError(400, `${label} is zero or more.`, "HR_STATUTORY_INVALID"); return round2(x); };
  const gross = n(input.gross, "Gross earnings");
  const taxable = n(input.taxable ?? input.gross, "Taxable earnings");
  if (taxable > gross + 0.005) throw new HrError(400, "Taxable earnings can't exceed gross earnings.", "HR_STATUTORY_INVALID");
  const row = (await client.query(`INSERT INTO tenant.hr_payroll_ytd_openings (organization_id, employee_id, financial_year, source, employer_name, gross_earnings, taxable_earnings, tds_deducted, epf_employee,
      professional_tax, note, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (organization_id, employee_id, financial_year, source) DO UPDATE SET employer_name = $5, gross_earnings = $6, taxable_earnings = $7, tds_deducted = $8, epf_employee = $9,
      professional_tax = $10, note = $11, entered_by = $12 RETURNING id`,
  [c.organizationId, employeeId, fy, source, textOrNull(input.employerName, 200), gross, taxable, n(input.tds, "TDS deducted"), n(input.epf, "EPF"), n(input.pt, "Professional tax"),
    textOrNull(input.note, 500), c.userId ?? null])).rows[0];
  await recordEvent(client, c, "employee", employeeId, "hr.payroll.ytd_opening", { financialYear: fy, source });
  return { id: row.id };
}
