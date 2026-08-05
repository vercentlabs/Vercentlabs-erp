import Link from "next/link";

const resources = [
  [
    "Quality plans",
    "/quality/plans",
    "Inspection rules, methods, limits and sampling.",
  ],
  [
    "Inspections",
    "/quality/inspections",
    "Incoming, in-process, final and return checks.",
  ],
  [
    "Quality holds",
    "/quality/holds",
    "Block inventory, batches, receipts and production.",
  ],
  [
    "Non-conformance",
    "/quality/non-conformances",
    "Defects, containment and disposition.",
  ],
  ["CAPA", "/quality/capa", "Root cause, corrective action and effectiveness."],
  [
    "Supplier quality",
    "/quality/supplier-quality",
    "Supplier rejection and quality scorecards.",
  ],
  [
    "Audits",
    "/quality/audits",
    "Internal, supplier, process and compliance audits.",
  ],
  [
    "Traceability",
    "/quality/traceability",
    "Inspection, hold, batch, serial and source history.",
  ],
];

export default function QualityDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <div className="module-workspace">
      <section className="panel">
        <p className="eyebrow">Quality</p>
        <h1>Inspection and corrective-action control</h1>
        <p>
          Embed incoming, production, stock and return quality checks into the
          operational flow with governed release and complete traceability.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Open inspections", summary.open_inspections],
          ["Failed inspections", summary.failed_inspections],
          ["Active holds", summary.active_holds],
          ["Open non-conformance", summary.open_nonconformances],
          ["Open CAPA", summary.open_capa],
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
            <span className="eyebrow">Quality workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
