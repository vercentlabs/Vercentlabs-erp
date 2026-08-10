import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { businessDataDefinitions } from "@/lib/business-data";

export const metadata = { title: "Data management" };
export const dynamic = "force-dynamic";

// Prompt 10, Part 46: the operational counterpart to Prompt 9's Data
// Governance (which answers "what controls exist / what's the state").
// This page answers "where do I go to actually import/export/bulk-update/
// deduplicate/archive a record" — every link points at a real, already-
// working capability (confirmed by direct audit: CRM and Master Data
// resource pages already have a working file-upload import button wired
// to the real, permission/field-validated import routes; this page adds
// no new upload UI of its own, only discoverability).
const BUSINESS_DATA_IMPORT_EXPORT_RESOURCES = [
  "parties",
  "contacts",
  "addresses",
  "items",
  "warehouses",
  "currencies",
] as const;

export default async function DataManagementPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.dataManagementView)) notFound();

  const canImportCrm = hasPermission(session, PERMISSIONS.crmImport);
  const canExportCrm = hasPermission(session, PERMISSIONS.crmExport);
  const canImportBusinessData = hasPermission(session, PERMISSIONS.businessDataImport);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Administration · Data management</p>
          <h1>Data management</h1>
          <p>
            Operate on real data — import, export, bulk-update and
            deduplicate. For governance status (retention/archiving/
            ownership policy), see{" "}
            <Link href="/compliance/data-governance">Data governance</Link>.
          </p>
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="data-import-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Import</p>
            <h2 id="data-import-title">Bring data in</h2>
          </div>
        </div>
        <div className="master-data-grid">
          <article className="master-data-card static">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="crm" size={21} />
            </span>
            <div>
              <strong>CRM records</strong>
              <span>
                {canImportCrm
                  ? "Open any CRM resource (leads, contacts, opportunities, …) and use its Import button — 2 MB / 1,000-row limit, duplicate-file detection, row-level validation."
                  : "Requires CRM import permission."}
              </span>
            </div>
          </article>
          {BUSINESS_DATA_IMPORT_EXPORT_RESOURCES.map((resource) => (
            <Link
              href={`/master-data/${resource}`}
              key={`import-${resource}`}
              className="master-data-card"
            >
              <span className="master-data-card-icon" aria-hidden="true">
                <AppIcon name="stock" size={21} />
              </span>
              <div>
                <strong>{businessDataDefinitions[resource].title}</strong>
                <span>
                  {canImportBusinessData
                    ? "Import via this resource's own page."
                    : "Requires master-data import permission."}
                </span>
              </div>
              <AppIcon name="arrow-right" size={17} />
            </Link>
          ))}
        </div>
        <p className="billing-commercial-note">
          No import capability exists yet for accounting, sales, procurement,
          stock, manufacturing, projects, assets, POS, quality, support, or
          HR &amp; payroll records — only CRM and the master-data resources
          above.
        </p>
      </section>

      <section className="dashboard-section" aria-labelledby="data-export-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Export</p>
            <h2 id="data-export-title">Take data out</h2>
          </div>
        </div>
        <div className="master-data-grid">
          <article className="master-data-card static">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="crm" size={21} />
            </span>
            <div>
              <strong>CRM records</strong>
              <span>
                {canExportCrm
                  ? "Every CRM resource has an Export CSV action."
                  : "Requires CRM export permission."}
              </span>
            </div>
          </article>
          <article className="master-data-card static">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="stock" size={21} />
            </span>
            <div>
              <strong>Master data</strong>
              <span>Each of the 16 shared resources has an Export CSV action.</span>
            </div>
          </article>
          <Link href="/audit-logs" className="master-data-card">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="audit" size={21} />
            </span>
            <div>
              <strong>Audit events</strong>
              <span>Filtered, redacted, bounded CSV export.</span>
            </div>
            <AppIcon name="arrow-right" size={17} />
          </Link>
        </div>
        <p className="billing-commercial-note">
          No export capability exists yet for accounting, sales, procurement,
          stock, manufacturing, projects, assets, POS, quality, support, or
          HR &amp; payroll records.
        </p>
      </section>

      <section className="dashboard-section" aria-labelledby="data-bulk-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Bulk update</p>
            <h2 id="data-bulk-title">Change many records at once</h2>
          </div>
        </div>
        <div className="master-data-grid">
          <Link href="/crm/leads" className="master-data-card">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="crm" size={21} />
            </span>
            <div>
              <strong>CRM leads</strong>
              <span>Owner, status, source, follow-up date, priority — up to 200 at a time.</span>
            </div>
            <AppIcon name="arrow-right" size={17} />
          </Link>
          <Link href="/crm/opportunities" className="master-data-card">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="crm" size={21} />
            </span>
            <div>
              <strong>CRM opportunities</strong>
              <span>Owner, forecast category, expected close date, next step.</span>
            </div>
            <AppIcon name="arrow-right" size={17} />
          </Link>
          <Link href="/sales/orders" className="master-data-card">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="sales" size={21} />
            </span>
            <div>
              <strong>Sales orders</strong>
              <span>Owner and requested delivery date.</span>
            </div>
            <AppIcon name="arrow-right" size={17} />
          </Link>
          <Link href="/sales/quotations" className="master-data-card">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="sales" size={21} />
            </span>
            <div>
              <strong>Sales quotations</strong>
              <span>Governed field set, same explicit allowlist pattern.</span>
            </div>
            <AppIcon name="arrow-right" size={17} />
          </Link>
        </div>
        <p className="billing-commercial-note">
          Every bulk-update path uses an explicit field allowlist — none can
          write an arbitrary column.
        </p>
      </section>

      <section className="dashboard-section" aria-labelledby="data-duplicate-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Duplicate management</p>
            <h2 id="data-duplicate-title">Find and merge duplicates</h2>
          </div>
        </div>
        <div className="master-data-grid">
          <Link href="/crm/leads" className="master-data-card">
            <span className="master-data-card-icon" aria-hidden="true">
              <AppIcon name="crm" size={21} />
            </span>
            <div>
              <strong>CRM leads, contacts &amp; accounts</strong>
              <span>Duplicate candidates are surfaced on each record&apos;s own detail page.</span>
            </div>
            <AppIcon name="arrow-right" size={17} />
          </Link>
        </div>
        <p className="billing-commercial-note">
          No duplicate-detection capability exists for any other module today.
        </p>
      </section>
    </>
  );
}
