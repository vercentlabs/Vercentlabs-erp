// HR & Payroll — the payroll reports, read from the payslips, attendance, leave, payments and Finance's journals (never kept separately):
// payroll register, payslip register, attendance / LWP summary, leave balances, salary payment reconciliation, TDS / EPF / ESI / PT summaries,
// and payroll-to-GL reconciliation (each run's totals against its journal).
import { HrError, qx, has } from "../common.js";

export const PAYROLL_REPORTS = Object.freeze({
  payroll_register: "Payroll register", payslip_register: "Payslip register", attendance: "Attendance / LWP summary", leave_balances: "Leave balance report",
  payments: "Salary payment reconciliation", tds: "TDS deduction summary", epf: "EPF contribution summary", esi: "ESI contribution summary", pt: "Professional Tax summary",
  gl: "Payroll-to-GL reconciliation",
});
const SEE = ["hr_payroll.reports.view", "hr_payroll.payroll.prepare", "hr_payroll.payroll.approve", "hr_payroll.payroll.post"];

// filters: from, to (month, YYYY-MM), runId
export async function getPayrollReport(client, c, kind, filters = {}) {
  if (!SEE.some((p) => has(c, p))) throw new HrError(403, "You do not have permission to see payroll reports.", "HR_FORBIDDEN");
  if (!PAYROLL_REPORTS[kind]) throw new HrError(404, "Unknown report.", "HR_REPORT_NOT_FOUND");
  const from = filters.from ? `${String(filters.from).slice(0, 7)}-01` : "1900-01-01";
  const to = filters.to ? `${String(filters.to).slice(0, 7)}-01` : "2999-12-01";
  const v = [c.organizationId, from, to];
  const runs = `r.organization_id = $1 AND r.status <> 'cancelled' AND date_trunc('month', r.period_start) BETWEEN $2::date AND $3::date`;
  const code = (codes) => `COALESCE(sum(l.amount + l.employer_amount) FILTER (WHERE l.component_code = ANY(ARRAY[${codes.map((x) => `'${x}'`).join(",")}])), 0)`;
  const statutory = (codes, label) => `SELECT to_char(r.period_start, 'YYYY-MM') AS month, e.employee_number AS employee, e.first_name || ' ' || COALESCE(e.last_name, '') AS name,
      ${codes.map(([c2, l2]) => `COALESCE(sum(l.amount) FILTER (WHERE l.component_code = '${c2}' AND l.component_type = 'deduction'), 0) + COALESCE(sum(l.employer_amount) FILTER (WHERE l.component_code = '${c2}'), 0) AS ${l2}`).join(", ")},
      max(l.rule_detail->>'rule') AS rule
    FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id = l.payslip_id JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id JOIN tenant.hr_employees e ON e.id = p.employee_id
    WHERE ${runs} AND p.status <> 'cancelled' AND r.status IN ('approved', 'posted', 'partially_paid', 'paid', 'closed') AND l.component_code = ANY(ARRAY[${codes.map(([c2]) => `'${c2}'`).join(",")}])
    GROUP BY r.period_start, e.employee_number, e.first_name, e.last_name ORDER BY r.period_start, e.employee_number -- ${label}`;
  let rows;
  switch (kind) {
    case "payroll_register": rows = (await qx(client, `SELECT r.payroll_number AS payroll, to_char(r.period_start, 'YYYY-MM') AS month, r.status, r.employee_count AS employees, r.gross_pay AS gross,
        r.total_deductions AS deductions, r.employer_contributions AS employer_cost, r.net_pay AS net, r.paid_amount AS paid, r.approved_at, r.posted_at FROM tenant.hr_payroll_runs r
        WHERE ${runs} ORDER BY r.period_start, r.payroll_number`, v)).rows; break;
    case "payslip_register": rows = (await qx(client, `SELECT p.payslip_number AS payslip, e.employee_number AS employee, e.first_name || ' ' || COALESCE(e.last_name, '') AS name, to_char(r.period_start, 'YYYY-MM') AS month,
        p.paid_days, p.lop_days, p.gross_pay AS gross, p.total_deductions AS deductions, p.net_pay AS net, p.payment_status AS payment, p.paid_amount AS paid, p.published_at
        FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id JOIN tenant.hr_employees e ON e.id = p.employee_id
        WHERE ${runs} AND p.status <> 'cancelled' ORDER BY r.period_start, e.employee_number`, v)).rows; break;
    case "attendance": rows = (await qx(client, `SELECT to_char(r.period_start, 'YYYY-MM') AS month, e.employee_number AS employee, e.first_name || ' ' || COALESCE(e.last_name, '') AS name, p.working_days,
        p.paid_days, p.leave_days, p.lop_days AS lwp_days, (p.source_snapshot->'attendance'->>'unmarkedDays')::numeric AS unmarked_days
        FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id JOIN tenant.hr_employees e ON e.id = p.employee_id
        WHERE ${runs} AND p.status <> 'cancelled' ORDER BY r.period_start, e.employee_number`, v)).rows; break;
    case "leave_balances": rows = (await qx(client, `SELECT e.employee_number AS employee, e.first_name || ' ' || COALESCE(e.last_name, '') AS name, t.code AS leave_type, b.leave_year,
        b.opening_balance AS opening, b.accrued, b.used, b.adjusted, b.closing_balance AS available FROM tenant.hr_leave_balances b JOIN tenant.hr_employees e ON e.id = b.employee_id
        JOIN tenant.hr_leave_types t ON t.id = b.leave_type_id WHERE b.organization_id = $1 AND ($2::date IS NOT NULL OR $3::date IS NOT NULL) ORDER BY e.employee_number, t.code`, v)).rows; break;
    case "payments": rows = (await qx(client, `SELECT r.payroll_number AS payroll, to_char(r.period_start, 'YYYY-MM') AS month, r.net_pay AS net_owed,
        COALESCE((SELECT sum(sp.amount) FROM tenant.hr_salary_payments sp WHERE sp.payroll_run_id = r.id), 0) AS paid,
        r.net_pay - COALESCE((SELECT sum(sp.amount) FROM tenant.hr_salary_payments sp WHERE sp.payroll_run_id = r.id), 0) AS outstanding,
        (SELECT count(*) FROM tenant.hr_payslips p WHERE p.payroll_run_id = r.id AND p.payment_status = 'PAYMENT_EXCEPTION')::int AS payment_exceptions,
        (SELECT count(*) FROM tenant.hr_payslips p WHERE p.payroll_run_id = r.id AND p.status = 'held')::int AS held, r.status
        FROM tenant.hr_payroll_runs r WHERE ${runs} AND r.status IN ('posted', 'partially_paid', 'paid', 'closed') ORDER BY r.period_start`, v)).rows; break;
    case "tds": rows = (await qx(client, statutory([["TDS", "tds"]], "tds"), v)).rows; break;
    case "epf": rows = (await qx(client, statutory([["EPF_EE", "employee_epf"], ["EPF_ER", "employer_epf"], ["EPS_ER", "employer_eps"]], "epf"), v)).rows; break;
    case "esi": rows = (await qx(client, statutory([["ESI_EE", "employee_esi"], ["ESI_ER", "employer_esi"]], "esi"), v)).rows; break;
    case "pt": rows = (await qx(client, statutory([["PT", "professional_tax"]], "pt"), v)).rows; break;
    case "gl": rows = (await qx(client, `SELECT r.payroll_number AS payroll, to_char(r.period_start, 'YYYY-MM') AS month, r.status, r.gross_pay AS payroll_gross, r.net_pay AS payroll_net,
        je.entry_number AS journal, je.status AS journal_status,
        COALESCE((SELECT sum(jl.base_debit_amount) FROM tenant.accounting_journal_lines jl WHERE jl.journal_entry_id = je.id), 0) AS journal_debits,
        ${code(["TDS"])} AS payroll_tds, ${code(["EPF_EE", "EPF_ER", "EPS_ER"])} AS payroll_epf, ${code(["ESI_EE", "ESI_ER"])} AS payroll_esi, ${code(["PT"])} AS payroll_pt,
        CASE WHEN je.id IS NULL THEN 'Not posted' WHEN abs(COALESCE((SELECT sum(jl.base_debit_amount) FROM tenant.accounting_journal_lines jl WHERE jl.journal_entry_id = je.id), 0)
          - (r.gross_pay + COALESCE((SELECT sum(l2.employer_amount) FROM tenant.hr_payslip_lines l2 JOIN tenant.hr_payslips p2 ON p2.id = l2.payslip_id WHERE p2.payroll_run_id = r.id AND l2.component_code IN ('EPF_ER', 'EPS_ER', 'ESI_ER')), 0))) < 0.01
          THEN 'Agrees' ELSE 'Differs' END AS reconciliation
        FROM tenant.hr_payroll_runs r LEFT JOIN tenant.accounting_postings ap ON ap.organization_id = r.organization_id AND ap.posting_event = 'payroll_run' AND ap.source_id = r.id AND ap.status = 'POSTED'
        LEFT JOIN tenant.accounting_journal_entries je ON je.id = ap.journal_entry_id
        LEFT JOIN tenant.hr_payslips p ON p.payroll_run_id = r.id AND p.status <> 'cancelled' LEFT JOIN tenant.hr_payslip_lines l ON l.payslip_id = p.id
        WHERE ${runs} AND r.status IN ('approved', 'posted', 'partially_paid', 'paid', 'closed') GROUP BY r.id, je.id ORDER BY r.period_start`, v)).rows; break;
    default: rows = [];
  }
  return { kind, title: PAYROLL_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val) && !/^0\d/.test(val) && k !== "employee" ? Number(val) : val]))) };
}
export async function exportPayrollReport(client, c, kind = "payroll_register", filters = {}) {
  if (!has(c, "hr_payroll.reports.view") && !has(c, "hr_payroll.payroll.post")) throw new HrError(403, "You do not have permission to export payroll reports.", "HR_FORBIDDEN");
  const report = await getPayrollReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (val) => {
    const s = val === null || val === undefined ? "" : val instanceof Date ? val.toISOString() : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return { fileName: `payroll-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body: [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n") };
}
