// F439-F447: statutory components (PF, ESIC, professional tax, TDS, labour welfare fund), each
// configured by jurisdiction and effective date rather than hard-coded; gratuity; statutory and
// compliance reports; and the payroll hook that brings the configured statutory deductions and
// employer contributions into every regular payroll run.
//
// Indian payroll statutes change by notification and by state; the rates and slabs here are
// SEEDED AS EDITABLE CONFIGURATION (F446), not hard-coded law. Nothing in this file is a substitute
// for a qualified compliance review, and F442 (TDS) is a simplified new-regime estimate -- it does
// not account for an employee's investment declarations, HRA exemption or other deductions.
import {
  HrError, dateOrNull, dateRequired, need, needAny, nonNegative, oneOf, qx, recordEvent, round2, text, textOrNull, today, uuid, uuidOrNull,
} from "./common.js";
import { registerPayrollHook } from "./payroll.js";

const MANAGE = "hr_payroll.statutory.manage";
const VIEW = [MANAGE, "hr_payroll.reports.view", "hr_payroll.payroll.prepare"];
const TYPES = ["pf", "esi", "professional_tax", "tds", "gratuity", "bonus", "labor_welfare", "other"];
const BASES = ["percentage_of_wage", "flat_amount", "slab"];
const WAGE_BASES = ["pf_wage", "esic_wage", "gross", "net"];

async function settings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  return (await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
}

// ---------------------------------------------------------------- components (F439-F443, F446)
export async function listStatutoryComponents(client, c, filters = {}) {
  needAny(c, [...VIEW, "hr_payroll.payroll.approve"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.type) { params.push(String(filters.type)); extra += ` AND statutory_type=$${params.length}`; }
  if (filters.state) { params.push(String(filters.state)); extra += ` AND (state=$${params.length} OR state IS NULL)`; }
  const { rows } = await qx(client, `SELECT s.*, (SELECT count(*) FROM tenant.hr_statutory_slabs sl WHERE sl.statutory_component_id=s.id)::int AS slab_count FROM tenant.hr_statutory_components s WHERE s.organization_id=$1 AND s.company_id=$2${extra} ORDER BY s.statutory_type, s.state NULLS FIRST, s.effective_from DESC`, params);
  return rows;
}
export async function getStatutoryComponent(client, c, id) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_statutory_components WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Statutory component")]);
  if (!rows[0]) throw new HrError(404, "Statutory component was not found.", "HR_STATUTORY_NOT_FOUND");
  const slabs = (await qx(client, `SELECT * FROM tenant.hr_statutory_slabs WHERE statutory_component_id=$1 ORDER BY sequence`, [rows[0].id])).rows;
  return { ...rows[0], slabs };
}
export async function saveStatutoryComponent(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new HrError(400, "A statutory component needs a code and a name.", "HR_STATUTORY_INVALID");
  const type = oneOf(String(input.statutoryType), TYPES, "Statutory type");
  const basis = oneOf(String(input.calculationBasis ?? "percentage_of_wage"), BASES, "Calculation basis");
  const wageBasis = oneOf(String(input.wageBasis ?? "gross"), WAGE_BASES, "Wage basis");
  const frequency = oneOf(String(input.frequency ?? "monthly"), ["monthly", "half_yearly", "yearly"], "Frequency");
  const employeeRate = nonNegative(input.employeeRate, "Employee rate");
  const employerRate = nonNegative(input.employerRate, "Employer rate");
  if (basis === "percentage_of_wage" && employeeRate === 0 && employerRate === 0) throw new HrError(400, "Give an employee or employer rate for a percentage-based component.", "HR_STATUTORY_INVALID");
  if (employeeRate > 100 || employerRate > 100) throw new HrError(400, "A rate cannot exceed 100%.", "HR_STATUTORY_INVALID");
  const ceiling = input.wageCeiling === undefined || input.wageCeiling === "" || input.wageCeiling === null ? null : nonNegative(input.wageCeiling, "Wage ceiling");
  const from = dateRequired(input.effectiveFrom, "Effective from");
  const to = dateOrNull(input.effectiveTo, "Effective to");
  if (to && to < from) throw new HrError(400, "The end date is before the start date.", "HR_STATUTORY_INVALID");
  const dueDay = input.dueDay === undefined || input.dueDay === "" || input.dueDay === null ? null : Math.trunc(nonNegative(input.dueDay, "Due day"));
  if (dueDay !== null && !(dueDay >= 1 && dueDay <= 28)) throw new HrError(400, "The due day is 1 to 28 of the following period.", "HR_STATUTORY_INVALID");
  const values = [name, type, employeeRate, employerRate, ceiling, from, to, JSON.stringify(input.configuration && typeof input.configuration === "object" ? input.configuration : {}),
    input.active !== false, basis, wageBasis, frequency, nonNegative(input.employeeFlatAmount, "Employee amount"), nonNegative(input.employerFlatAmount, "Employer amount"), textOrNull(input.state, 60), dueDay];
  if (input.id) {
    const { rows } = await qx(client,
      `UPDATE tenant.hr_statutory_components SET name=$4, statutory_type=$5, employee_rate=$6, employer_rate=$7, wage_ceiling=$8, effective_from=$9, effective_to=$10, configuration=$11::jsonb, active=$12,
         calculation_basis=$13, wage_basis=$14, frequency=$15, employee_flat_amount=$16, employer_flat_amount=$17, state=$18, due_day=$19 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Statutory component"), ...values]);
    if (!rows[0]) throw new HrError(404, "Statutory component was not found.", "HR_STATUTORY_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client,
      `INSERT INTO tenant.hr_statutory_components(organization_id,company_id,code,name,jurisdiction,statutory_type,employee_rate,employer_rate,wage_ceiling,effective_from,effective_to,configuration,active,calculation_basis,wage_basis,frequency,employee_flat_amount,employer_flat_amount,state,due_day,created_by)
       VALUES ($1,$2,$3,$4,'IN',$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [c.organizationId, c.companyId, code, ...values, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `A component ${code} already exists from that effective date.`, "HR_STATUTORY_DUPLICATE");
    throw e;
  }
}
export async function setStatutorySlab(client, c, input) {
  need(c, MANAGE);
  const comp = (await qx(client, `SELECT * FROM tenant.hr_statutory_components WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.statutoryComponentId, "Statutory component")])).rows[0];
  if (!comp) throw new HrError(404, "Statutory component was not found.", "HR_STATUTORY_NOT_FOUND");
  if (comp.calculation_basis !== "slab") throw new HrError(409, "Slabs apply only to a slab-based component.", "HR_STATUTORY_INVALID");
  const from = nonNegative(input.fromAmount, "From amount");
  const to = input.toAmount === undefined || input.toAmount === "" || input.toAmount === null ? null : nonNegative(input.toAmount, "To amount");
  if (to !== null && to < from) throw new HrError(400, "The upper bound is below the lower bound.", "HR_STATUTORY_INVALID");
  // both zero is a legitimate "exempt" bracket (e.g. the nil-rate slab at the bottom of a tax table)
  const flat = nonNegative(input.flatAmount, "Flat amount");
  const rate = nonNegative(input.ratePercent, "Rate");
  const seq = input.sequence ? Math.trunc(Number(input.sequence)) : ((await qx(client, `SELECT coalesce(max(sequence),0)+1 AS n FROM tenant.hr_statutory_slabs WHERE statutory_component_id=$1`, [comp.id])).rows[0].n);
  const { rows } = await qx(client, `INSERT INTO tenant.hr_statutory_slabs(organization_id,statutory_component_id,sequence,from_amount,to_amount,flat_amount,rate_percent) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (statutory_component_id,sequence) DO UPDATE SET from_amount=EXCLUDED.from_amount, to_amount=EXCLUDED.to_amount, flat_amount=EXCLUDED.flat_amount, rate_percent=EXCLUDED.rate_percent RETURNING *`,
    [c.organizationId, comp.id, seq, from, to, flat, rate]);
  return rows[0];
}
export async function removeStatutorySlab(client, c, id) {
  need(c, MANAGE);
  const { rows } = await qx(client, `DELETE FROM tenant.hr_statutory_slabs WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, uuid(id, "Slab")]);
  if (!rows[0]) throw new HrError(404, "Slab was not found.", "HR_SLAB_NOT_FOUND");
  return rows[0];
}
export async function deactivateStatutoryComponent(client, c, id, reason) {
  need(c, MANAGE);
  if (!text(reason)) throw new HrError(400, "Give a reason for retiring it.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_statutory_components SET active=false, effective_to=coalesce(effective_to, current_date) WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Statutory component")]);
  if (!rows[0]) throw new HrError(404, "Statutory component was not found.", "HR_STATUTORY_NOT_FOUND");
  await recordEvent(client, c, "statutory_component", rows[0].id, "hr.statutory.deactivated", { reason: text(reason, 300) });
  return rows[0];
}

async function activeComponents(client, c, type, date, state) {
  const params = [c.organizationId, c.companyId, type, date];
  let extra = "";
  if (state) { params.push(state); extra = ` AND (state IS NULL OR state=$5)`; }
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_statutory_components WHERE organization_id=$1 AND company_id=$2 AND statutory_type=$3 AND active AND effective_from <= $4 AND (effective_to IS NULL OR effective_to >= $4)${extra} ORDER BY state NULLS LAST, effective_from DESC`, params);
  // the most specific (state-matched, then most recently effective) row per state wins; take the first
  return rows[0] ? [rows[0]] : [];
}
function slabAmount(slabs, base) {
  let amount = 0;
  const sorted = [...slabs].sort((a, b) => a.sequence - b.sequence);
  for (const s of sorted) {
    const from = Number(s.from_amount);
    const to = s.to_amount === null ? Infinity : Number(s.to_amount);
    if (base <= from) continue;
    const slice = Math.min(base, to) - from;
    if (slice <= 0) continue;
    amount += Number(s.flat_amount) + (slice * Number(s.rate_percent)) / 100;
  }
  return round2(amount);
}
// A single flat slab, matched by which bracket `base` falls in (professional tax is usually a flat
// amount for the bracket the salary falls in, not a marginal calculation like income tax).
function slabFlatMatch(slabs, base) {
  const hit = [...slabs].sort((a, b) => a.sequence - b.sequence).find((s) => base > Number(s.from_amount) && (s.to_amount === null || base <= Number(s.to_amount)));
  return hit ? round2(Number(hit.flat_amount) + (Number(base) * Number(hit.rate_percent)) / 100) : 0;
}

async function computeOne(client, c, comp, { pfWages, esicWages, gross, net, annualEstimate }) {
  if (comp.calculation_basis === "flat_amount") {
    const perMonth = comp.frequency === "monthly" ? 1 : comp.frequency === "half_yearly" ? 1 / 6 : 1 / 12; // accrued monthly regardless of remittance frequency
    void perMonth;
    return { employee: round2(Number(comp.employee_flat_amount)), employer: round2(Number(comp.employer_flat_amount)) };
  }
  if (comp.calculation_basis === "slab") {
    const slabs = (await qx(client, `SELECT * FROM tenant.hr_statutory_slabs WHERE statutory_component_id=$1`, [comp.id])).rows;
    const base = comp.statutory_type === "tds" ? annualEstimate : gross;
    const amount = comp.statutory_type === "tds" ? slabAmount(slabs, base) / 12 : slabFlatMatch(slabs, base);
    return { employee: round2(amount), employer: 0 };
  }
  const wage = { pf_wage: pfWages, esic_wage: esicWages, gross, net }[comp.wage_basis] ?? gross;
  const capped = comp.wage_ceiling !== null ? Math.min(wage, Number(comp.wage_ceiling)) : wage;
  return { employee: round2((capped * Number(comp.employee_rate)) / 100), employer: round2((capped * Number(comp.employer_rate)) / 100) };
}

// ---------------------------------------------------------------- the payroll hook (F439-F442)
registerPayrollHook("statutory", async ({ client, c, employee, gross, taxableGross, pfWages, esicWages, run }) => {
  const lines = [];
  const data = {};
  if (run.run_type !== "regular") return { lines, data };
  const identifiers = employee.statutory_identifiers ?? {};
  const pan = employee.tax_identifiers?.pan;
  const date = String(run.period_end);
  const net = gross; // deductions are computed on gross; net-of-statutory is not circular here
  const annualEstimate = round2(taxableGross * 12);
  const state = identifiers.pt_state || employee.address?.state || null;

  if (identifiers.pf_applicable !== false) {
    for (const comp of await activeComponents(client, c, "pf", date)) {
      const amt = await computeOne(client, c, comp, { pfWages, esicWages, gross, net, annualEstimate });
      if (amt.employee > 0) lines.push({ code: "PF_EE", name: "Provident fund (employee)", type: "deduction", kind: "statutory", amount: amt.employee, taxable: 0, statutoryId: comp.id });
      if (amt.employer > 0) lines.push({ code: "PF_ER", name: "Provident fund (employer)", type: "employer_contribution", kind: "statutory", amount: 0, taxable: 0, employer: amt.employer, statutoryId: comp.id });
      data.pf = { rate: comp.employee_rate, ceiling: comp.wage_ceiling, wages: pfWages };
    }
  }
  if (identifiers.esic_applicable !== false && esicWages > 0) {
    for (const comp of await activeComponents(client, c, "esi", date)) {
      if (comp.wage_ceiling !== null && esicWages > Number(comp.wage_ceiling)) continue; // ESIC does not apply above the wage ceiling at all
      const amt = await computeOne(client, c, comp, { pfWages, esicWages, gross, net, annualEstimate });
      if (amt.employee > 0) lines.push({ code: "ESIC_EE", name: "ESIC (employee)", type: "deduction", kind: "statutory", amount: amt.employee, taxable: 0, statutoryId: comp.id });
      if (amt.employer > 0) lines.push({ code: "ESIC_ER", name: "ESIC (employer)", type: "employer_contribution", kind: "statutory", amount: 0, taxable: 0, employer: amt.employer, statutoryId: comp.id });
      data.esic = { rate: comp.employee_rate, ceiling: comp.wage_ceiling, wages: esicWages };
    }
  }
  for (const comp of await activeComponents(client, c, "professional_tax", date, state)) {
    const amt = await computeOne(client, c, comp, { pfWages, esicWages, gross, net, annualEstimate });
    if (amt.employee > 0) lines.push({ code: "PT", name: `Professional tax${state ? ` (${state})` : ""}`, type: "deduction", kind: "statutory", amount: amt.employee, taxable: 0, statutoryId: comp.id });
    data.professionalTax = { state, gross };
  }
  for (const comp of await activeComponents(client, c, "labor_welfare", date, state)) {
    const amt = await computeOne(client, c, comp, { pfWages, esicWages, gross, net, annualEstimate });
    if (amt.employee > 0) lines.push({ code: "LWF_EE", name: "Labour welfare fund (employee)", type: "deduction", kind: "statutory", amount: amt.employee, taxable: 0, statutoryId: comp.id });
    if (amt.employer > 0) lines.push({ code: "LWF_ER", name: "Labour welfare fund (employer)", type: "employer_contribution", kind: "statutory", amount: 0, taxable: 0, employer: amt.employer, statutoryId: comp.id });
  }
  if (pan) {
    for (const comp of await activeComponents(client, c, "tds", date)) {
      const amt = await computeOne(client, c, comp, { pfWages, esicWages, gross, net, annualEstimate });
      if (amt.employee > 0) lines.push({ code: "TDS", name: "Income tax (TDS)", type: "deduction", kind: "statutory", amount: amt.employee, taxable: 0, statutoryId: comp.id });
      data.tds = { annualEstimate, regime: "new" };
    }
  }
  return { lines, data };
});

// ---------------------------------------------------------------- gratuity (F444)
async function computeGratuity(client, c, employee, asOfDate) {
  const cfg = await settings(client, c);
  const years = round2((Date.parse(asOfDate) - Date.parse(String(employee.joining_date))) / (365.25 * 86400000));
  const eligible = years >= Number(cfg.gratuity_min_years);
  const basicLine = (await qx(client, `SELECT l.amount FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id=l.payslip_id JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id WHERE p.employee_id=$1 AND l.component_kind='basic' AND r.run_type='regular' AND p.status <> 'cancelled' ORDER BY r.period_end DESC LIMIT 1`, [employee.id])).rows[0];
  const lastDrawnBasic = basicLine ? Number(basicLine.amount) : 0;
  let amount = eligible ? round2(((Number(cfg.gratuity_days_per_year) / Number(cfg.gratuity_month_days)) * lastDrawnBasic) * years) : 0;
  const capped = amount > Number(cfg.gratuity_ceiling);
  if (capped) amount = Number(cfg.gratuity_ceiling);
  return { years, eligible, lastDrawnBasic, amount, capped };
}
export async function estimateGratuity(client, c, employeeId) {
  needAny(c, VIEW);
  const e = (await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(employeeId, "Employee")])).rows[0];
  if (!e) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  const asOf = e.separation_date ? String(e.separation_date).slice(0, 10) : today();
  const g = await computeGratuity(client, c, e, asOf);
  const { rows } = await qx(client, `INSERT INTO tenant.hr_gratuity_records(organization_id,company_id,employee_id,as_of_date,years_of_service,last_drawn_basic,eligible,amount,capped,record_type,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'estimate',$10) RETURNING *`,
    [c.organizationId, c.companyId, e.id, asOf, g.years, g.lastDrawnBasic, g.eligible, g.amount, g.capped, c.userId]);
  return rows[0];
}
export async function listGratuityRecords(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra = ` AND g.employee_id=$3`; }
  const { rows } = await qx(client, `SELECT g.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_gratuity_records g JOIN tenant.hr_employees e ON e.id=g.employee_id WHERE g.organization_id=$1 AND g.company_id=$2${extra} ORDER BY g.created_at DESC LIMIT 500`, params);
  return rows;
}
// used by the final-settlement calculation (payroll-close.js) -- returns a settlement line, or null
export async function gratuitySettlementLine(client, c, employee, asOfDate) {
  const g = await computeGratuity(client, c, employee, asOfDate);
  if (!g.eligible || g.amount <= 0) return null;
  await qx(client, `INSERT INTO tenant.hr_gratuity_records(organization_id,company_id,employee_id,as_of_date,years_of_service,last_drawn_basic,eligible,amount,capped,record_type,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'settlement',$10)`,
    [c.organizationId, c.companyId, employee.id, asOfDate, g.years, g.lastDrawnBasic, g.eligible, g.amount, g.capped, c.userId]);
  return { code: "GRATUITY", label: `Gratuity: ${g.years} years of service${g.capped ? " (capped)" : ""}`, kind: "earning", amount: g.amount };
}

// ---------------------------------------------------------------- reports (F445, F447)
export async function getStatutoryReport(client, c, runId) {
  needAny(c, VIEW);
  const run = (await qx(client, `SELECT * FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(runId, "Payroll run")])).rows[0];
  if (!run) throw new HrError(404, "Payroll run was not found.", "HR_RUN_NOT_FOUND");
  const rows = (await qx(client, `SELECT e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, l.component_code, l.amount, l.employer_amount
    FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id=l.payslip_id JOIN tenant.hr_employees e ON e.id=p.employee_id
    WHERE p.payroll_run_id=$1 AND l.component_code IN ('PF_EE','PF_ER','ESIC_EE','ESIC_ER','PT','LWF_EE','LWF_ER','TDS') ORDER BY e.employee_number`, [run.id])).rows;
  const byEmployee = new Map();
  for (const r of rows) {
    const cur = byEmployee.get(r.employee_number) ?? { employeeNumber: r.employee_number, employeeName: r.employee_name, pfEmployee: 0, pfEmployer: 0, esicEmployee: 0, esicEmployer: 0, pt: 0, lwfEmployee: 0, lwfEmployer: 0, tds: 0 };
    const v = Number(r.amount) || Number(r.employer_amount) || 0;
    if (r.component_code === "PF_EE") cur.pfEmployee += v; else if (r.component_code === "PF_ER") cur.pfEmployer += Number(r.employer_amount);
    else if (r.component_code === "ESIC_EE") cur.esicEmployee += v; else if (r.component_code === "ESIC_ER") cur.esicEmployer += Number(r.employer_amount);
    else if (r.component_code === "PT") cur.pt += v; else if (r.component_code === "LWF_EE") cur.lwfEmployee += v; else if (r.component_code === "LWF_ER") cur.lwfEmployer += Number(r.employer_amount);
    else if (r.component_code === "TDS") cur.tds += v;
    byEmployee.set(r.employee_number, cur);
  }
  const employees = [...byEmployee.values()];
  const totals = employees.reduce((n, e) => ({
    pfEmployee: n.pfEmployee + e.pfEmployee, pfEmployer: n.pfEmployer + e.pfEmployer, esicEmployee: n.esicEmployee + e.esicEmployee, esicEmployer: n.esicEmployer + e.esicEmployer,
    pt: n.pt + e.pt, lwfEmployee: n.lwfEmployee + e.lwfEmployee, lwfEmployer: n.lwfEmployer + e.lwfEmployer, tds: n.tds + e.tds,
  }), { pfEmployee: 0, pfEmployer: 0, esicEmployee: 0, esicEmployer: 0, pt: 0, lwfEmployee: 0, lwfEmployer: 0, tds: 0 });
  return { runId: run.id, payrollNumber: run.payroll_number, period: { from: run.period_start, to: run.period_end }, employees, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])) };
}

export async function getComplianceReport(client, c, { year, month } = {}) {
  needAny(c, VIEW);
  const y = Math.trunc(Number(year ?? today().slice(0, 4)));
  const m = Math.trunc(Number(month ?? today().slice(5, 7)));
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12)) throw new HrError(400, "Give a valid year and month.", "HR_REPORT_INVALID");
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const runs = (await qx(client, `SELECT id, payroll_number, status, payment_date FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND run_type='regular' AND period_start >= $3::date AND period_start < ($3::date + interval '1 month') AND status <> 'cancelled'`, [c.organizationId, c.companyId, from])).rows;
  const totals = { pfEmployee: 0, pfEmployer: 0, esicEmployee: 0, esicEmployer: 0, pt: 0, lwfEmployee: 0, lwfEmployer: 0, tds: 0 };
  for (const r of runs) {
    const rep = await getStatutoryReport(client, c, r.id);
    for (const key of Object.keys(totals)) totals[key] = round2(totals[key] + rep.totals[key]);
  }
  const components = await qx(client, `SELECT statutory_type, code, name, due_day FROM tenant.hr_statutory_components WHERE organization_id=$1 AND company_id=$2 AND active AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3)`, [c.organizationId, c.companyId, `${y}-${String(m).padStart(2, "0")}-28`]);
  const dueDates = components.rows.map((r) => ({ type: r.statutory_type, code: r.code, name: r.name, dueDate: r.due_day ? `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${String(r.due_day).padStart(2, "0")}` : null }));
  return { year: y, month: m, runsIncluded: runs.map((r) => r.payroll_number), totals, dueDates, payrollRunsClosed: runs.every((r) => ["posted", "paid"].includes(r.status)) };
}
void uuidOrNull; void dateOrNull;
