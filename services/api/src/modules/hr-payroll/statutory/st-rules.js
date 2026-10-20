// HR & Payroll — statutory rules: the rule families, the starting templates and the validation of a version's configuration.
//
// A rule family is one statutory obligation in one jurisdiction: EPF, ESI, Professional Tax of one state (PT-MH, PT-KA …), TDS on salaries
// under one regime (TDS-NEW, TDS-OLD). Each family has numbered versions with effective dates. A version is a DRAFT until someone other than
// its author checks it against the current law (the act, notification or circular it cites) and activates it; payroll then uses the ACTIVE
// version in force on the period's last day, never one hard-coded in the application. The templates below are starting points only: their
// figures are what the authors believed correct and are to be verified before use (they are created as drafts).
import { HrError, text } from "../common.js";

export const ST = Object.freeze({ manage: "hr_payroll.statutory.manage", verify: "hr_payroll.statutory.verify", ytd: "hr_payroll.ytd.manage",
  prepare: "hr_payroll.payroll.prepare", reports: "hr_payroll.reports.view" });
export const TYPES = Object.freeze({ pf: "EPF", esi: "ESI", professional_tax: "Professional Tax", tds: "TDS on salaries" });
export const STATES = Object.freeze({ MH: "Maharashtra", KA: "Karnataka", TN: "Tamil Nadu", WB: "West Bengal", GJ: "Gujarat", TS: "Telangana", AP: "Andhra Pradesh", KL: "Kerala",
  MP: "Madhya Pradesh", OD: "Odisha", AS: "Assam", MG: "Meghalaya", TR: "Tripura", SK: "Sikkim", MN: "Manipur", MZ: "Mizoram", JH: "Jharkhand", BR: "Bihar", PB: "Punjab", PY: "Puducherry" });

// Starting templates (to be verified against the law in force before they are activated).
export const TEMPLATES = Object.freeze({
  EPF: { statutoryType: "pf", name: "Employees' Provident Fund", jurisdiction: "IN", wageBasis: "pf_wage",
    source: "EPF & MP Act 1952; EPF Scheme 1952 ¶29; EPS 1995 ¶3 — verify current contribution rates and the wage ceiling",
    configuration: { employeeRate: 12, employerEpfRate: 3.67, employerEpsRate: 8.33, wageCeiling: 15000, applyCeiling: true, epsWageCeiling: 15000 } },
  ESI: { statutoryType: "esi", name: "Employees' State Insurance", jurisdiction: "IN", wageBasis: "esic_wage",
    source: "ESI Act 1948 §39; ESI (Central) Rules — verify current rates and the coverage wage limit",
    configuration: { employeeRate: 0.75, employerRate: 3.25, wageLimit: 21000, contributionPeriods: [{ from: 4, to: 9 }, { from: 10, to: 3 }] } },
  "PT-MH": { statutoryType: "professional_tax", name: "Professional Tax — Maharashtra", jurisdiction: "IN-MH", state: "MH", wageBasis: "gross",
    source: "Maharashtra State Tax on Professions, Trades, Callings and Employments Act 1975, Schedule I — verify current slabs",
    configuration: { slabs: [{ from: 0, to: 7500, amount: 0 }, { from: 7500.01, to: 10000, amount: 175 }, { from: 10000.01, to: null, amount: 200 }],
      monthOverrides: { 2: { from: 10000.01, amount: 300 } }, femaleExemptUpTo: 25000 } },
  "PT-KA": { statutoryType: "professional_tax", name: "Professional Tax — Karnataka", jurisdiction: "IN-KA", state: "KA", wageBasis: "gross",
    source: "Karnataka Tax on Professions, Trades, Callings and Employments Act 1976 — verify current slabs",
    configuration: { slabs: [{ from: 0, to: 24999.99, amount: 0 }, { from: 25000, to: null, amount: 200 }] } },
  "TDS-NEW": { statutoryType: "tds", name: "TDS on salaries — new regime", jurisdiction: "IN", taxRegime: "new", wageBasis: "gross",
    source: "Income-tax law in force for the financial year (salary TDS) — verify slabs, standard deduction, rebate and cess for the year",
    configuration: { slabs: [{ from: 0, to: 400000, rate: 0 }, { from: 400000, to: 800000, rate: 5 }, { from: 800000, to: 1200000, rate: 10 }, { from: 1200000, to: 1600000, rate: 15 },
      { from: 1600000, to: 2000000, rate: 20 }, { from: 2000000, to: 2400000, rate: 25 }, { from: 2400000, to: null, rate: 30 }],
      standardDeduction: 75000, rebateIncomeLimit: 1200000, rebateMaximum: 60000, cessRate: 4, surchargeFrom: 5000000, noPanMinimumRate: 20 } },
});

const num = (v, label, { min = 0, max = Infinity, nullable = false } = {}) => {
  if (nullable && (v === null || v === undefined || v === "")) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HrError(400, `${label} must be a number from ${min}${max === Infinity ? "" : ` to ${max}`}.`, "HR_STATUTORY_INVALID");
  return n;
};
function slabs(list, label, valueKey) {
  if (!Array.isArray(list) || !list.length) throw new HrError(400, `${label}: add at least one slab.`, "HR_STATUTORY_INVALID");
  const out = list.map((s, i) => ({ from: num(s.from, `${label} slab ${i + 1}: from`), to: num(s.to, `${label} slab ${i + 1}: to`, { nullable: true }),
    [valueKey]: num(s[valueKey], `${label} slab ${i + 1}: ${valueKey}`, valueKey === "rate" ? { max: 100 } : {}) }));
  out.forEach((s, i) => {
    if (s.to !== null && s.to < s.from) throw new HrError(400, `${label} slab ${i + 1} ends before it starts.`, "HR_STATUTORY_INVALID");
    if (i < out.length - 1 && s.to === null) throw new HrError(400, `${label}: only the last slab is open-ended.`, "HR_STATUTORY_INVALID");
    if (i > 0 && out[i - 1].to !== null && s.from < out[i - 1].to - 0.01) throw new HrError(400, `${label}: slabs ${i} and ${i + 1} overlap.`, "HR_STATUTORY_INVALID");
  });
  return out;
}
// The configuration of a version, checked for its type.
export function cleanConfiguration(type, cfg = {}) {
  switch (type) {
    case "pf": return { employeeRate: num(cfg.employeeRate, "Employee rate", { max: 100 }), employerEpfRate: num(cfg.employerEpfRate, "Employer EPF rate", { max: 100 }),
      employerEpsRate: num(cfg.employerEpsRate, "Employer EPS rate", { max: 100 }), wageCeiling: num(cfg.wageCeiling, "Wage ceiling", { nullable: true }), applyCeiling: cfg.applyCeiling !== false,
      epsWageCeiling: num(cfg.epsWageCeiling, "EPS wage ceiling", { nullable: true }) };
    case "esi": {
      const periods = Array.isArray(cfg.contributionPeriods) && cfg.contributionPeriods.length ? cfg.contributionPeriods : [{ from: 4, to: 9 }, { from: 10, to: 3 }];
      return { employeeRate: num(cfg.employeeRate, "Employee rate", { max: 100 }), employerRate: num(cfg.employerRate, "Employer rate", { max: 100 }), wageLimit: num(cfg.wageLimit, "Coverage wage limit"),
        contributionPeriods: periods.map((p) => ({ from: num(p.from, "Period start month", { min: 1, max: 12 }), to: num(p.to, "Period end month", { min: 1, max: 12 }) })) };
    }
    case "professional_tax": {
      const overrides = {};
      for (const [month, o] of Object.entries(cfg.monthOverrides ?? {})) overrides[num(month, "Override month", { min: 1, max: 12 })] = { from: num(o.from, "Override from"), amount: num(o.amount, "Override amount") };
      return { slabs: slabs(cfg.slabs, "Professional tax", "amount"), monthOverrides: overrides, femaleExemptUpTo: num(cfg.femaleExemptUpTo, "Women exempt up to", { nullable: true }) };
    }
    case "tds": return { slabs: slabs(cfg.slabs, "Income tax", "rate"), standardDeduction: num(cfg.standardDeduction ?? 0, "Standard deduction"),
      rebateIncomeLimit: num(cfg.rebateIncomeLimit ?? 0, "Rebate income limit"), rebateMaximum: num(cfg.rebateMaximum ?? 0, "Rebate maximum"), cessRate: num(cfg.cessRate ?? 0, "Cess rate", { max: 100 }),
      surchargeFrom: num(cfg.surchargeFrom, "Surcharge threshold", { nullable: true }), noPanMinimumRate: num(cfg.noPanMinimumRate ?? 20, "Rate without PAN", { max: 100 }) };
    default: throw new HrError(400, "Choose EPF, ESI, Professional Tax or TDS.", "HR_STATUTORY_INVALID");
  }
}
export const familyOf = (type, { state = null, regime = null } = {}) =>
  type === "pf" ? "EPF" : type === "esi" ? "ESI" : type === "professional_tax" ? `PT-${text(state, 4).toUpperCase()}` : `TDS-${(regime ?? "new").toUpperCase()}`;
// The financial year (April–March) a date falls in, as "2026-27".
export const financialYearOf = (date) => {
  const y = Number(String(date).slice(0, 4));
  const m = Number(String(date).slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};
export const fyRange = (fy) => {
  const start = Number(fy.slice(0, 4));
  return { start: `${start}-04-01`, end: `${start + 1}-03-31` };
};
