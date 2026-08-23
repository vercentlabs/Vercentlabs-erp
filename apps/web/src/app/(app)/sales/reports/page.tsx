import Link from "next/link";

import { getSalesReport } from "@vercentlabs/api";

import AppIcon from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { tenantTransaction } from "@/core/db";
import { salesContext } from "@/modules/sales";

export const dynamic = "force-dynamic";

const reports = [
  "quotation-conversion",
  "order-intake",
  "expiring-quotations",
  "pending-approvals",
  "active-holds",
  "fulfillment",
  "billing-readiness",
  "customer-performance",
] as const;

type ReportKey = (typeof reports)[number];
type ReportRow = Record<string, unknown>;

const reportMeta: Record<
  ReportKey,
  { title: string; description: string; signal: string }
> = {
  "quotation-conversion": {
    title: "Quotation conversion",
    description: "Track how consistently proposals move into accepted business.",
    signal: "Commercial effectiveness",
  },
  "order-intake": {
    title: "Order intake",
    description: "Review confirmed order volume and base-currency value over time.",
    signal: "Booked revenue",
  },
  "expiring-quotations": {
    title: "Expiring quotations",
    description: "Prioritise proposals that need customer action before validity ends.",
    signal: "Time-sensitive pipeline",
  },
  "pending-approvals": {
    title: "Pending approvals",
    description: "Find quotations waiting for governed commercial approval.",
    signal: "Decision queue",
  },
  "active-holds": {
    title: "Active order holds",
    description: "Surface confirmed orders blocked by credit, compliance or operations.",
    signal: "Revenue at risk",
  },
  fulfillment: {
    title: "Fulfilment readiness",
    description: "Monitor delivery commitments and operational execution status.",
    signal: "Customer promise",
  },
  "billing-readiness": {
    title: "Billing readiness",
    description: "Identify orders that are ready, partly invoiced or blocked for billing.",
    signal: "Cash conversion",
  },
  "customer-performance": {
    title: "Customer performance",
    description: "Compare booked order value and order count by customer.",
    signal: "Account concentration",
  },
};

const humanize = (value: string) =>
  value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

function formatValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (key.includes("date") || key.includes("at") || key === "period") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return key === "period"
        ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(date)
        : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
    }
  }
  if (key.includes("total") || key.includes("amount") || key.includes("value")) {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(amount);
    }
  }
  if (typeof value === "number") return new Intl.NumberFormat("en-IN").format(value);
  return humanize(String(value));
}

export default async function SalesReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const session = await requireWorkspace();
  const context = salesContext(session);
  const { report } = await searchParams;
  const selected = (reports.includes(report as ReportKey)
    ? report
    : "order-intake") as ReportKey;
  const rows = (await tenantTransaction(context.organizationId, (client) =>
    getSalesReport(client, context, selected),
  )) as ReportRow[];
  const columns = Array.from(
    rows.reduce<Set<string>>((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  ).slice(0, 8);
  const meta = reportMeta[selected];

  return (
    <div className="module-workbench sales-workbench report-workbench">
      <section className="module-hero compact-module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="sales" size={22} />
          </span>
          <div>
            <p className="eyebrow">Sales intelligence</p>
            <h1>Commercial performance</h1>
            <p>
              Decision-ready reports for proposals, order intake, fulfilment and
              billing—without exposing raw system data.
            </p>
          </div>
        </div>
        <div className="module-hero-actions">
          <Link className="secondary-button" href="/sales">
            Sales overview
          </Link>
          <Link className="primary-button" href="/sales/quotations/new">
            New quotation
          </Link>
        </div>
      </section>

      <div className="enterprise-report-layout">
        <nav className="enterprise-report-nav" aria-label="Sales reports">
          <p className="eyebrow">Report library</p>
          {reports.map((key) => (
            <Link
              aria-current={key === selected ? "page" : undefined}
              className={key === selected ? "active" : ""}
              href={`/sales/reports?report=${key}`}
              key={key}
            >
              <span>{reportMeta[key].title}</span>
              <small>{reportMeta[key].signal}</small>
            </Link>
          ))}
        </nav>

        <section className="enterprise-report-surface">
          <header className="enterprise-report-header">
            <div>
              <p className="eyebrow">{meta.signal}</p>
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </div>
            <span className="record-count-pill">
              {rows.length} {rows.length === 1 ? "record" : "records"}
            </span>
          </header>

          {rows.length ? (
            <div className="table-scroll enterprise-table-frame">
              <table className="data-table enterprise-data-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column}>{humanize(column)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={String(row.id || row.quotation_number || row.sales_order_number || index)}>
                      {columns.map((column) => (
                        <td key={column} data-label={humanize(column)}>
                          {formatValue(column, row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="module-empty-state report-empty-state">
              <span className="module-empty-icon" aria-hidden="true">
                <AppIcon name="sales" size={22} />
              </span>
              <strong>No report records yet</strong>
              <p>
                This report will populate as governed sales transactions move
                through the workflow.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
