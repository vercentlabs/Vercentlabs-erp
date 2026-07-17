import { getCrmReport } from "@vercent/api";
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
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export default async function CrmReportsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmReportsView)) return null;
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
                <a className="link-button" href={`/api/crm/reports/${name}`}>
                  JSON
                </a>
              </div>
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
                          <td key={column}>
                            {row[column] === null
                              ? "—"
                              : String(row[column] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={Math.max(1, columns.length)}>
                          <div className="empty-state">
                            <p>No report data yet.</p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
