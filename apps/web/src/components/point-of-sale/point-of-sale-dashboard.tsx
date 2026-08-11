import Link from "next/link";

const resources = [
  [
    "Checkout",
    "/point-of-sale/checkout",
    "Fast retail sale and payment capture.",
  ],
  [
    "Stores",
    "/point-of-sale/stores",
    "Store, branch, warehouse and price list setup.",
  ],
  [
    "Terminals",
    "/point-of-sale/terminals",
    "Terminal configuration and receipt numbering.",
  ],
  [
    "Shifts",
    "/point-of-sale/shifts",
    "Cashier opening, activity and closing control.",
  ],
  [
    "Sales",
    "/point-of-sale/sales",
    "Receipts, customers, taxes, discounts and payments.",
  ],
  [
    "Returns",
    "/point-of-sale/returns",
    "Governed returns, refunds and restocking.",
  ],
  [
    "Cash movements",
    "/point-of-sale/cash-movements",
    "Opening, paid-in, paid-out and refund cash.",
  ],
  [
    "Reconciliation",
    "/point-of-sale/reconciliations",
    "Expected versus counted and provider settlement.",
  ],
];

export default function PointOfSaleDashboard({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  return (
    <div className="module-workbench">
      <section className="panel">
        <p className="eyebrow">Point of Sale</p>
        <h1>Retail checkout and shift control</h1>
        <p>
          Process sales, payments, returns and cash reconciliation while keeping
          Stock, Sales and Accounting evidence aligned.
        </p>
      </section>

      <section className="metric-grid">
        {[
          ["Sales today", summary.sales_today],
          ["Revenue today", summary.revenue_today],
          ["Open shifts", summary.open_shifts],
          ["Returns today", summary.returns_today],
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
            <span className="eyebrow">POS workflow</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
