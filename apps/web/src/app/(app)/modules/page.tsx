import AppIcon, { type AppIconName } from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { query } from "@/lib/db";
import { moduleCatalog } from "@/lib/platform";

export const metadata = { title: "Module launcher" };

export default async function ModulesPage() {
  const session = await requireWorkspace();
  const rows = await query<{
    module_key: string;
    status: "registered" | "enabled" | "disabled";
  }>(
    "SELECT module_key, status FROM organization_modules WHERE organization_id=$1",
    [session.organizationId],
  );
  const status = new Map(rows.map((row) => [row.module_key, row.status]));
  const enabledCount = rows.filter((row) => row.status === "enabled").length;

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Module registry</p>
          <h1>Your ERP capability map</h1>
          <p>
            Keep the operating model clear by enabling complete workflows rather
            than isolated screens.
          </p>
        </div>
        <div className="page-heading-summary">
          <span className="status-badge neutral">1 released · 11 roadmap</span>
          <span className="status-badge success">{enabledCount} enabled</span>
        </div>
      </section>

      <section className="module-intro panel muted-panel">
        <span className="panel-icon" aria-hidden="true">
          <AppIcon name="sparkles" size={21} />
        </span>
        <div>
          <strong>Build depth before breadth</strong>
          <p>
            Each module becomes valuable when its records, approvals, audit
            trail and connected business flow are complete.
          </p>
        </div>
      </section>

      <section className="module-grid" aria-label="ERP modules">
        {moduleCatalog.map((module, index) => {
          const moduleStatus =
            module.availability === "released"
              ? status.get(module.key) || "enabled"
              : "roadmap";
          return (
            <article className="module-card" key={module.key}>
              <div className="module-card-topline">
                <span className="module-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`status-pill ${moduleStatus === "enabled" ? "active" : moduleStatus === "disabled" ? "inactive" : "pending"}`}
                >
                  {moduleStatus}
                </span>
              </div>
              <div className="module-card-body">
                <span className="module-icon" aria-hidden="true">
                  <AppIcon name={module.key as AppIconName} size={24} />
                </span>
                <div>
                  <h2>{module.name}</h2>
                  <p>{module.description}</p>
                </div>
              </div>
              <span className="module-readonly">
                {module.availability === "released"
                  ? "Included in this release"
                  : "Planned for a future release"}
              </span>
            </article>
          );
        })}
      </section>
    </>
  );
}
