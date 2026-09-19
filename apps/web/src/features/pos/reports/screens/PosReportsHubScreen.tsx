"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, FileCheck2, Receipt, ScrollText } from "lucide-react";

// A CONSOLIDATION screen, not a new financial-calculation surface: F303
// (day-end/Z reports), F304 (reconciliation), F305 (accounting posting) and
// F307 (analytics) each already have a real, complete screen of their own
// with its own real backend computation -- this page computes nothing and
// duplicates no figure from any of them. It exists only because "Reports"
// was previously a bare planned() nav entry with nowhere to land; this is
// the lightweight index a cashier or manager actually expects to find
// there, one click away from each of the four real reporting surfaces.
const REPORT_LINKS = [
  {
    href: "/pos/reports/day-end",
    icon: ScrollText,
    title: "Day-end (Z) reports",
    description: "Generate, review and finalize each shift or business day's immutable sales, tax, returns, tender and cash reconciliation.",
  },
  {
    href: "/pos/reconciliation",
    icon: FileCheck2,
    title: "Reconciliation",
    description: "Import settlement evidence and resolve cross-report variance exceptions across every payment method.",
  },
  {
    href: "/pos/accounting",
    icon: Receipt,
    title: "Accounting posting",
    description: "Every completed sale and return's GL posting status, with retry for anything that failed to post.",
  },
  {
    href: "/pos/analytics",
    icon: BarChart3,
    title: "Analytics",
    description: "Date-range, store, terminal and cashier drilldown analytics across sales, discounts, returns and tenders.",
  },
] as const;

export function PosReportsHubScreen() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Reports</h1>
        <p className="text-sm text-text-secondary">Every POS reporting surface in one place — day-end reports, reconciliation, accounting posting and analytics.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REPORT_LINKS.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5 transition-colors hover:border-brand hover:bg-surface-muted"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-brand-soft text-brand">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <ArrowRight className="size-4 text-text-muted" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text">{title}</h2>
              <p className="mt-1 text-sm text-text-secondary">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
