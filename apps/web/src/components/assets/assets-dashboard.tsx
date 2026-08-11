import Link from "next/link";

const resources = [
  [
    "Asset register",
    "/assets/assets",
    "Asset identity, value, status and custody.",
  ],
  [
    "Categories",
    "/assets/categories",
    "Useful life, depreciation and account defaults.",
  ],
  [
    "Assignments",
    "/assets/assignments",
    "Current custodian, department and location.",
  ],
  [
    "Transfers",
    "/assets/transfers",
    "Controlled movement between branches and teams.",
  ],
  [
    "Maintenance plans",
    "/assets/maintenance-plans",
    "Preventive schedules and due dates.",
  ],
  [
    "Maintenance orders",
    "/assets/maintenance-orders",
    "Downtime, parts, labor and external cost.",
  ],
  [
    "Inspections",
    "/assets/inspections",
    "Condition, custody, safety and compliance checks.",
  ],
  [
    "Depreciation",
    "/assets/depreciation-runs",
    "Governed depreciation and Accounting handoff.",
  ],
  [
    "Disposals",
    "/assets/disposals",
    "Sale, scrap, write-off and gain or loss evidence.",
  ],
];

export default function AssetsDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <div className="module-workbench">
      <section className="panel">
        <p className="eyebrow">Assets</p>
        <h1>Lifecycle and maintenance control</h1>
        <p>
          Control acquisition, capitalization, assignment, maintenance,
          depreciation, audits and disposal with complete evidence.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Total assets", summary.total_assets],
          ["Assigned assets", summary.assigned_assets],
          ["In maintenance", summary.assets_in_maintenance],
          ["Maintenance due", summary.maintenance_due],
          ["Net book value", summary.total_net_book_value],
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
            <span className="eyebrow">Asset workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
