// HR & Payroll — the statutory calculation of one employee's payslip, from the ACTIVE rule versions in force on the period's last day:
//
//   EPF   when the employee is covered (statutory identifiers: PF applicable): the PF wage (components marked PF wage, else Basic), capped at the
//         version's wage ceiling when it says so; employee share = rate × wage; the employer's share split into EPS (capped by its own
//         ceiling) and EPF (the rest). Rounded to the rupee.
//   ESI   coverage is decided for the whole contribution period (April–September, October–March) by the ESI wage at its start: covered then,
//         covered to its end. Employee and employer shares of the ESI wage (components marked ESIC wage, else gross), rounded up to the rupee.
//   PT    the state the employee works in (statutory identifiers: PT state): the slab of the month's gross, the month's override (Maharashtra's
//         February), the women's exemption where the state has one.
//   TDS   new regime: the year's taxable salary projected from what was paid this financial year (payslips and opening figures) plus this
//         month's taxable pay for the months still to come (to the leaving month when the employee leaves this year); less the standard
//         deduction; the slabs; the rebate (with marginal relief); cess; less TDS already deducted, spread over the remaining months. Without a
//         PAN not less than the version's minimum rate of this month's taxable pay. The old regime is not calculated (a blocking exception
//         unless a monthly TDS amount was entered as variable pay), nor is surcharge (above its threshold: a blocking exception).
// An employee a rule applies to without an ACTIVE version is a blocking exception: the payroll can't be submitted. Nothing is guessed.
import { qx } from "../common.js";
import { STATES, financialYearOf, fyRange } from "./st-rules.js";

const r0 = (n) => Math.round(Number(n) + Number.EPSILON);
const up = (n) => Math.ceil(Number(n) - 1e-9);
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function activeRule(client, c, family, date) {
  return (await qx(client, `SELECT * FROM tenant.hr_statutory_components WHERE organization_id = $1 AND rule_family = $2 AND status = 'ACTIVE' AND effective_from <= $3
      AND (effective_to IS NULL OR effective_to >= $3) ORDER BY version_number DESC LIMIT 1`, [c.organizationId, family, date])).rows[0] ?? null;
}
const stateCode = (value) => {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (STATES[v.toUpperCase()]) return v.toUpperCase();
  return Object.entries(STATES).find(([, name]) => name.toLowerCase() === v.toLowerCase())?.[0] ?? null;
};
const slabOf = (slabs, value) => slabs.find((s) => value >= s.from - 0.005 && (s.to === null || value <= s.to + 0.005));
const deduction = (rule, code, name, amount, detail) => ({ code, name, type: "deduction", kind: "statutory", amount: money(amount), taxable: 0, employer: 0, statutoryId: rule.id, detail });
const employerLine = (rule, code, name, amount, detail) => ({ code, name, type: "employer_contribution", kind: "statutory", amount: 0, taxable: 0, employer: money(amount), statutoryId: rule.id, detail });
const missing = (family, what) => ({ code: "STATUTORY_RULE_MISSING", severity: "error", message: `No active, verified ${what} rule (${family}) is in force for this period. Verify one in Payroll › Statutory rules.` });

// What this financial year has already paid the employee before this run: taxable pay and TDS (payslips of approved / posted / paid runs,
// plus opening figures).
async function yearToDate(client, c, emp, run, fy) {
  const { start } = fyRange(fy);
  const paid = (await qx(client, `SELECT COALESCE(sum(l.taxable_amount) FILTER (WHERE l.component_type = 'earning'), 0) AS taxable,
        COALESCE(sum(l.amount) FILTER (WHERE l.component_type = 'deduction' AND l.component_code = 'TDS'), 0) AS tds
      FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id = l.payslip_id JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id
     WHERE p.organization_id = $1 AND p.employee_id = $2 AND r.id <> $3 AND r.status IN ('approved', 'posted', 'partially_paid', 'paid', 'closed') AND p.status <> 'cancelled'
       AND r.period_end >= $4 AND r.period_end < $5`, [c.organizationId, emp.id, run.id, start, run.period_start])).rows[0];
  const opening = (await qx(client, `SELECT COALESCE(sum(taxable_earnings), 0) AS taxable, COALESCE(sum(tds_deducted), 0) AS tds FROM tenant.hr_payroll_ytd_openings
      WHERE organization_id = $1 AND employee_id = $2 AND financial_year = $3`, [c.organizationId, emp.id, fy])).rows[0];
  return { taxable: money(Number(paid.taxable) + Number(opening.taxable)), tds: money(Number(paid.tds) + Number(opening.tds)), openingTaxable: Number(opening.taxable) };
}
const fyIndex = (month) => (month >= 4 ? month - 3 : month + 9); // April = 1 … March = 12

export function incomeTax(cfg, income) {
  let tax = 0;
  for (const s of cfg.slabs) {
    if (income <= s.from) break;
    const top = s.to === null ? income : Math.min(income, s.to);
    tax += (top - s.from) * (s.rate / 100);
  }
  let rebate = 0;
  if (cfg.rebateIncomeLimit > 0) {
    if (income <= cfg.rebateIncomeLimit) rebate = Math.min(tax, cfg.rebateMaximum);
    else if (tax > income - cfg.rebateIncomeLimit) rebate = tax - (income - cfg.rebateIncomeLimit); // marginal relief
  }
  const afterRebate = Math.max(0, tax - rebate);
  return { slabTax: money(tax), rebate: money(rebate), tax: money(afterRebate), cess: money(afterRebate * (cfg.cessRate / 100)), total: r0(afterRebate * (1 + cfg.cessRate / 100)) };
}

// lines: the payslip's earnings and deductions so far ({ code, type, amount, taxable, pfWage, esiWage }). Returns { lines, exceptions, detail }.
export async function computeStatutory(client, c, { emp, run, lines }) {
  const date = String(run.period_end);
  const month = Number(date.slice(5, 7));
  const out = [];
  const exceptions = [];
  const detail = {};
  const earnings = lines.filter((l) => l.type === "earning");
  const gross = money(earnings.reduce((n, l) => n + l.amount, 0));
  const st = emp.statutory_identifiers ?? {};
  const tax = emp.tax_identifiers ?? {};

  // EPF
  if (st.pf_applicable === true) {
    const rule = await activeRule(client, c, "EPF", date);
    if (!rule) exceptions.push(missing("EPF", "EPF"));
    else {
      const cfg = rule.configuration;
      const flagged = earnings.filter((l) => l.pfWage);
      const wage = money((flagged.length ? flagged : earnings.filter((l) => l.kind === "basic" || l.code === "BASIC")).reduce((n, l) => n + l.amount, 0));
      if (!flagged.length && wage === 0) exceptions.push({ code: "PF_WAGE_UNDEFINED", severity: "error", message: "EPF applies but no component is marked as PF wage and there is no Basic pay." });
      const base = cfg.applyCeiling && cfg.wageCeiling ? Math.min(wage, cfg.wageCeiling) : wage;
      const employee = r0(base * cfg.employeeRate / 100);
      const eps = r0((cfg.epsWageCeiling ? Math.min(wage, cfg.epsWageCeiling) : wage) * cfg.employerEpsRate / 100);
      const employerTotal = r0(base * (cfg.employerEpfRate + cfg.employerEpsRate) / 100);
      const d = { rule: `${rule.rule_family} v${rule.version_number}`, wage, base, employee, eps, epf: employerTotal - eps };
      detail.epf = d;
      if (employee > 0) out.push(deduction(rule, "EPF_EE", "Provident Fund (employee)", employee, d));
      if (employerTotal - eps > 0) out.push(employerLine(rule, "EPF_ER", "Provident Fund (employer)", employerTotal - eps, d));
      if (eps > 0) out.push(employerLine(rule, "EPS_ER", "Pension Scheme (employer)", eps, d));
    }
  }

  // ESI
  if (st.esic_applicable !== false) {
    const rule = await activeRule(client, c, "ESI", date);
    const flagged = earnings.filter((l) => l.esiWage);
    const wage = money((flagged.length ? flagged : earnings).reduce((n, l) => n + l.amount, 0));
    if (!rule) { if (st.esic_applicable === true) exceptions.push(missing("ESI", "ESI")); }
    else {
      const cfg = rule.configuration;
      const period = cfg.contributionPeriods.find((p) => (p.from <= p.to ? month >= p.from && month <= p.to : month >= p.from || month <= p.to));
      const year = Number(date.slice(0, 4));
      const startYear = period && period.from > month ? year - 1 : year;
      const periodStart = period ? `${startYear}-${String(period.from).padStart(2, "0")}-01` : date;
      // The ESI wage of the first payslip of the contribution period decides coverage for all of it.
      const firstSlip = (await qx(client, `SELECT p.source_snapshot FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id WHERE p.employee_id = $1 AND r.id <> $2
          AND r.status IN ('approved', 'posted', 'partially_paid', 'paid', 'closed') AND p.status <> 'cancelled' AND r.period_start >= $3 AND r.period_end < $4 ORDER BY r.period_start LIMIT 1`,
      [emp.id, run.id, periodStart, run.period_start])).rows[0];
      const coverageWage = firstSlip?.source_snapshot?.statutory?.esi?.wage ?? wage;
      const covered = st.esic_applicable === true || coverageWage <= cfg.wageLimit;
      const employee = covered ? up(wage * cfg.employeeRate / 100) : 0;
      const employer = covered ? up(wage * cfg.employerRate / 100) : 0;
      detail.esi = { rule: `${rule.rule_family} v${rule.version_number}`, wage, coverageWage, periodStart, covered, employee, employer };
      if (employee > 0) out.push(deduction(rule, "ESI_EE", "ESI (employee)", employee, detail.esi));
      if (employer > 0) out.push(employerLine(rule, "ESI_ER", "ESI (employer)", employer, detail.esi));
    }
  }

  // Professional Tax
  const state = stateCode(st.pt_state);
  if (st.pt_state && !state) exceptions.push({ code: "PT_STATE_UNKNOWN", severity: "error", message: `The Professional Tax state "${st.pt_state}" is not recognised.` });
  else if (state) {
    const rule = await activeRule(client, c, `PT-${state}`, date);
    if (!rule) exceptions.push(missing(`PT-${state}`, `Professional Tax (${STATES[state]})`));
    else {
      const cfg = rule.configuration;
      let amount = slabOf(cfg.slabs, gross)?.amount ?? 0;
      const override = cfg.monthOverrides?.[month];
      if (override && gross >= override.from - 0.005) amount = override.amount;
      if (cfg.femaleExemptUpTo && String(emp.gender ?? "").toLowerCase() === "female" && gross <= cfg.femaleExemptUpTo) amount = 0;
      detail.pt = { rule: `${rule.rule_family} v${rule.version_number}`, state, gross, amount };
      if (amount > 0) out.push(deduction(rule, "PT", "Professional Tax", amount, detail.pt));
    }
  }

  // TDS
  const regime = tax.regime === "old" ? "old" : "new";
  const manualTds = lines.some((l) => l.type === "deduction" && l.code === "TDS");
  if (regime === "old") {
    if (!manualTds) exceptions.push({ code: "TDS_OLD_REGIME", severity: "error", message: "The employee chose the old tax regime, whose TDS is not calculated: enter this month's TDS as a variable deduction (code TDS)." });
  } else if (!manualTds) {
    const rule = await activeRule(client, c, "TDS-NEW", date);
    const currentTaxable = money(earnings.reduce((n, l) => n + (l.taxable ?? 0), 0));
    if (!rule) { if (currentTaxable > 0) exceptions.push(missing("TDS-NEW", "income-tax (new regime)")); }
    else {
      const cfg = rule.configuration;
      const fy = financialYearOf(date);
      const ytd = await yearToDate(client, c, emp, run, fy);
      const leaving = emp.separation_date && String(emp.separation_date) >= String(run.period_start) && financialYearOf(String(emp.separation_date)) === fy ? Number(String(emp.separation_date).slice(5, 7)) : 3;
      const remaining = Math.max(1, fyIndex(leaving) - fyIndex(month) + 1);
      const projected = money(ytd.taxable + currentTaxable * remaining);
      const income = Math.max(0, money(projected - cfg.standardDeduction));
      if (cfg.surchargeFrom && income > cfg.surchargeFrom) exceptions.push({ code: "TDS_SURCHARGE_UNSUPPORTED", severity: "error", message: `Projected taxable income ${income} is above ${cfg.surchargeFrom}, where surcharge applies; it is not calculated. Enter this month's TDS as a variable deduction (code TDS).` });
      else {
        const annual = incomeTax(cfg, income);
        const due = Math.max(0, annual.total - ytd.tds);
        let monthly = r0(due / remaining);
        const noPan = !tax.pan;
        if (noPan && currentTaxable > 0) monthly = Math.max(monthly, r0(currentTaxable * cfg.noPanMinimumRate / 100));
        detail.tds = { rule: `${rule.rule_family} v${rule.version_number}`, financialYear: fy, ytdTaxable: ytd.taxable, ytdTds: ytd.tds, currentTaxable, remainingMonths: remaining, projected,
          standardDeduction: cfg.standardDeduction, taxableIncome: income, ...annual, monthly, noPan };
        if (monthly > 0) out.push(deduction(rule, "TDS", "Income tax (TDS)", monthly, detail.tds));
      }
    }
  }
  return { lines: out, exceptions, detail };
}
