import { getCrmReport } from "@vercent/api";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { canViewCrmReport } from "@/lib/crm-api";
import { tenantTransaction } from "@/lib/db";
export const metadata = { title: "CRM reports" };
export const dynamic = "force-dynamic";
const names = [
  "pipeline",
  "conversion",
  "sources",
  "activities",
  "forecast",
  "campaigns",
  "revenue-operations",
  "account-health",
  "privacy",
  "pipeline-intelligence",
  "engagement-intelligence",
  "relationship-coverage",
  "partner-pipeline",
  "ai-governance",
] as const;
const title = (value: string) =>
  value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }
  if (typeof value === "object") return "Configured";
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2,
    }).format(value);
  }
  return String(value).replaceAll("_", " ");
}
export default async function CrmReportsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmReportsView)) notFound();
  const context = crmContext(session);
  const visibleNames = names.filter((name) => canViewCrmReport(session, name));
  const reports = await tenantTransaction(
    context.organizationId,
    async (client) => {
      const entries = [];
      for (const name of visibleNames) {
        entries.push([name, await getCrmReport(client, context, name)]);
      }
      return Object.fromEntries(entries);
    },
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM analytics</p>
          <h1>Pipeline, conversion and activity reports</h1>
          <p>
            Review revenue health, engagement, pipeline risk, relationship
            coverage, partner contribution, governed AI, privacy and seller
            execution.
          </p>
        </div>
        <span className="status-badge neutral">Live tenant data</span>
      </section>
      <div className="crm-report-grid">
        {visibleNames.map((name) => {
          const rows = (
            reports[name] as { rows: Array<Record<string, unknown>> }
          ).rows;
          const columns = Array.from(
            new Set(rows.flatMap((row) => Object.keys(row))),
          );
          return (
            <section className="panel" key={name}>
              <div className="card-title-row">
                <div>
                  <p className="eyebrow">Report</p>
                  <h2>{title(name)}</h2>
                </div>
                {rows.length ? (
                  <a
                    className="link-button"
                    download
                    href={`/api/crm/reports/${name}?format=csv`}
                  >
                    Download CSV
                  </a>
                ) : (
                  <span className="status-badge neutral">No data to export</span>
                )}
              </div>
              {rows.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th key={column}>{title(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index}>
                          {columns.map((column) => (
                            <td key={column}>{displayValue(row[column])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state crm-report-empty-state">
                  <strong>No report data yet</strong>
                  <p>
                    This report will populate automatically when matching CRM
                    activity is recorded for the current company and branch.
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
