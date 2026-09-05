"use client";
import { useEffect, useState } from "react";
import { ConvergenceBoundary } from "@/shared/design";
import Link from "next/link";
type D = Record<string, string | number>;
export default function StockDashboard() {
  const [d, setD] = useState<D>({});
  useEffect(() => {
    fetch("/api/stock/dashboard")
      .then((r) => r.json())
      .then((x) => setD(x.dashboard || {}))
      .catch(() => setD({}));
  }, []);
  return (
    <ConvergenceBoundary area="module" className="module-workbench">
      <section className="module-hero">
        <p className="eyebrow">Inventory control</p>
        <h1>Stock</h1>
        <p>
          Real-time availability, traceability, replenishment and valuation
          across every warehouse.
        </p>
      </section>
      <section className="metric-grid">
        {[
          ["On hand", d.total_quantity || 0],
          ["Reserved", d.reserved_quantity || 0],
          ["Inventory value", d.inventory_value || 0],
          ["Low stock", d.low_stock_items || 0],
        ].map(([l, v]) => (
          <article className="metric-card" key={String(l)}>
            <span>{l}</span>
            <strong>{v}</strong>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Operate inventory</h2>
        <div className="module-hero-actions">
          <Link className="primary-button" href="/stock/movements">
            Movement history
          </Link>
          <Link className="secondary-button" href="/stock/transfers">
            Transfers
          </Link>
          <Link className="secondary-button" href="/stock/balances">
            Stock balances
          </Link>
          <Link className="secondary-button" href="/stock/reorder-rules">
            Replenishment
          </Link>
        </div>
      </section>
    </ConvergenceBoundary>
  );
}
