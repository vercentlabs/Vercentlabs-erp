import { ConvergenceBoundary } from "@/shared/design";
import Link from "next/link";

const cards = [
  [
    "Bills of material",
    "/manufacturing/boms",
    "Versioned product structures and components.",
  ],
  [
    "Work orders",
    "/manufacturing/work-orders",
    "Plan, release, execute and complete production.",
  ],
  [
    "Work centers",
    "/manufacturing/work-centers",
    "Capacity, efficiency, labor and overhead rates.",
  ],
  [
    "Routings",
    "/manufacturing/routings",
    "Ordered operations and production instructions.",
  ],
  [
    "Material planning",
    "/manufacturing/material-requirements",
    "Shortages and recommended supply actions.",
  ],
  [
    "Production postings",
    "/manufacturing/production-postings",
    "Auditable Stock-linked issues and receipts.",
  ],
];

export default function ManufacturingDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <ConvergenceBoundary area="module" className="module-workbench">
      <section className="panel">
        <p className="eyebrow">Manufacturing</p>
        <h1>Production control</h1>
        <p>
          Plan materials, release governed work, execute operations and post
          finished production through the Stock ledger.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Active work orders", summary.active_work_orders],
          ["Planned work orders", summary.planned_work_orders],
          ["Completed work orders", summary.completed_work_orders],
          ["Material shortages", summary.shortage_count],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value ?? 0)}</strong>
          </article>
        ))}
      </section>

      <section className="resource-cards">
        {cards.map(([title, href, description]) => (
          <Link className="resource-card" href={href} key={href}>
            <span className="eyebrow">Manufacturing workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </ConvergenceBoundary>
  );
}
