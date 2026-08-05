import Link from "next/link";

const resources = [
  [
    "Employees",
    "/hr-payroll/employees",
    "Employee records, reporting lines and employment details.",
  ],
  [
    "Departments",
    "/hr-payroll/departments",
    "Organisation structure and cost-centre ownership.",
  ],
  [
    "Attendance",
    "/hr-payroll/attendance",
    "Presence, hours, overtime, lateness and absence.",
  ],
  [
    "Shifts",
    "/hr-payroll/shifts",
    "Work schedules, grace periods and working days.",
  ],
  [
    "Leave",
    "/hr-payroll/leave-requests",
    "Leave requests, approvals and balances.",
  ],
  [
    "Expenses",
    "/hr-payroll/expenses",
    "Employee claims, project links and reimbursement.",
  ],
  [
    "Salary structures",
    "/hr-payroll/salary-structures",
    "Earnings, deductions and compensation rules.",
  ],
  [
    "Payroll runs",
    "/hr-payroll/payroll-runs",
    "Calculation, approval and Accounting handoff.",
  ],
  [
    "Payslips",
    "/hr-payroll/payslips",
    "Employee payroll results and component lines.",
  ],
  [
    "Statutory",
    "/hr-payroll/statutory-components",
    "PF, ESI, professional tax, TDS and other rules.",
  ],
];

export default function HrPayrollDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <div className="module-workspace">
      <section className="panel">
        <p className="eyebrow">HR &amp; Payroll</p>
        <h1>Workforce and payroll control</h1>
        <p>
          Connect employees, attendance, leave, expenses, compensation, payroll
          approvals, payslips and financial handoff.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Active employees", summary.active_employees],
          ["Employees on leave", summary.employees_on_leave],
          ["New joiners", summary.new_joiners],
          ["Open payroll runs", summary.open_payroll_runs],
          ["Latest net pay", summary.latest_net_pay],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value ?? 0)}</strong>
          </article>
        ))}
      </section>

      <section className="resource-grid">
        {resources.map(([title, href, description]) => (
          <Link className="resource-card" href={href} key={href}>
            <span className="eyebrow">HR workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
