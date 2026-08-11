import Link from "next/link";

const resources = [
  [
    "Projects",
    "/projects/projects",
    "Portfolio, customer, schedule and billing model.",
  ],
  ["Milestones", "/projects/milestones", "Delivery and billing checkpoints."],
  [
    "Tasks",
    "/projects/tasks",
    "Assignments, dependencies, dates and progress.",
  ],
  ["Time entries", "/projects/time-entries", "Billable and costed team time."],
  ["Expenses", "/projects/expenses", "Project costs and approval status."],
  [
    "Budgets",
    "/projects/budgets",
    "Labor, expense, procurement and revenue baselines.",
  ],
  [
    "Billing",
    "/projects/billing-milestones",
    "Governed requests into Sales and Accounting.",
  ],
  [
    "Profitability",
    "/projects/profitability",
    "Revenue, cost, margin and completion forecast.",
  ],
];

export default function ProjectsDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <div className="module-workbench">
      <section className="panel">
        <p className="eyebrow">Projects</p>
        <h1>Delivery and profitability control</h1>
        <p>
          Connect milestones, tasks, time, expenses, procurement, billing and
          financial performance without duplicating source ledgers.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Active projects", summary.active_projects],
          ["Overdue projects", summary.overdue_projects],
          ["Overdue tasks", summary.overdue_tasks],
          ["Contracted revenue", summary.contracted_revenue],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value ?? 0)}</strong>
          </article>
        ))}
      </section>

      <section className="resource-cards">
        {resources.map(([title, href, description]) => (
          <Link className="resource-card" href={href} key={href}>
            <span className="eyebrow">Project workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
