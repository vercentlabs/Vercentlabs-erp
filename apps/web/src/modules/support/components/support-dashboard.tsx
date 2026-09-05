import { ConvergenceBoundary } from "@/shared/design";
import Link from "next/link";

const resources = [
  ["Tickets", "/support/tickets", "Customer and internal service requests."],
  ["Queues", "/support/queues", "Ownership, routing, workload and skills."],
  ["SLA policies", "/support/sla-policies", "Response and resolution targets."],
  [
    "Escalations",
    "/support/escalations",
    "Breaches, risks and escalation ownership.",
  ],
  [
    "Communications",
    "/support/communications",
    "Customer and internal interaction history.",
  ],
  [
    "Knowledge",
    "/support/knowledge",
    "Reusable support articles and resolution guidance.",
  ],
  [
    "Categories",
    "/support/categories",
    "Issue classification and default routing.",
  ],
  [
    "Customer history",
    "/support/customer-history",
    "Service context beside CRM and commercial records.",
  ],
];

export default function SupportDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <ConvergenceBoundary area="module" className="module-workbench">
      <section className="panel">
        <p className="eyebrow">Support</p>
        <h1>Customer service operations</h1>
        <p>
          Manage requests, ownership, priorities, service targets, escalations,
          communication and knowledge with complete context.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Open tickets", summary.open_tickets],
          ["High priority", summary.high_priority_tickets],
          ["First response breaches", summary.first_response_breaches],
          ["Resolution breaches", summary.resolution_breaches],
          ["Open escalations", summary.open_escalations],
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
            <span className="eyebrow">Support workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </ConvergenceBoundary>
  );
}
