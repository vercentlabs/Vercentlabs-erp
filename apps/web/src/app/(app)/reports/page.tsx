import Link from "next/link";

import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/authorization";
import { getAccessibleModules } from "@/lib/module-access";
import { MODULES_WITHOUT_REPORTS, REPORT_CATALOGUE } from "@/lib/reports/catalogue";

export const metadata = { title: "Reports & analytics" };
export const dynamic = "force-dynamic";

const MODULE_LABEL: Record<string, string> = Object.fromEntries(
  ERP_MODULE_CATALOG.map((module) => [module.key, module.name]),
);

// No blanket permission gate on this page — same pattern as My Work
// (Prompt 8): every entry is already gated by its own module accessibility
// plus its own real report-view permission, so an unentitled user simply
// sees a smaller (or empty) catalogue rather than being blocked at the
// nav level. This page never runs a report itself — it is metadata/links
// only (Part 76: "Run a report only when opened").
export default async function ReportsPage() {
  const session = await requireWorkspace();

  const accessible = await getAccessibleModules(session);
  const accessibleModuleIds = new Set(
    accessible.filter((entry) => entry.accessible).map((entry) => entry.moduleId),
  );

  const visible = REPORT_CATALOGUE.filter(
    (entry) => accessibleModuleIds.has(entry.moduleId) && hasPermission(session, entry.permission),
  );

  const grouped = new Map<string, typeof visible>();
  for (const entry of visible) {
    const list = grouped.get(entry.moduleId) || [];
    list.push(entry);
    grouped.set(entry.moduleId, list);
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Administration · Reports &amp; analytics</p>
          <h1>Reports &amp; analytics</h1>
          <p>
            A catalogue of real reports across the modules you have access
            to. Reports run inside their own module when you open them —
            nothing here is pre-computed. There is no cross-module report
            builder, no chart/pivot engine, and no scheduled/emailed reports
            yet.
          </p>
        </div>
      </section>

      {[...grouped.entries()].map(([moduleId, entries]) => (
        <section className="dashboard-section" key={moduleId} aria-label={MODULE_LABEL[moduleId]}>
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{MODULE_LABEL[moduleId] || moduleId}</p>
              <h2>{entries.length} report{entries.length === 1 ? "" : "s"}</h2>
            </div>
            <Link href={entries[0].route}>
              Open {MODULE_LABEL[moduleId]} reports <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <div className="master-data-grid">
            {entries.map((entry) => (
              <Link href={entry.route} key={entry.key} className="master-data-card">
                <span className="master-data-card-icon" aria-hidden="true">
                  <AppIcon name={entry.moduleId} size={21} />
                </span>
                <div>
                  <strong>{entry.label}</strong>
                  <span>{entry.description}</span>
                </div>
                <AppIcon name="arrow-right" size={17} />
              </Link>
            ))}
          </div>
        </section>
      ))}

      {!visible.length ? (
        <div className="empty-state">
          <strong>No reports available yet</strong>
          <p>
            Reports become visible here once you have access to a module
            with a real reports implementation.
          </p>
        </div>
      ) : null}

      <section className="dashboard-section" aria-labelledby="reports-gap-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Not yet implemented</p>
            <h2 id="reports-gap-title">Modules without reports</h2>
          </div>
        </div>
        <p className="billing-commercial-note">
          {MODULES_WITHOUT_REPORTS.map((id) => MODULE_LABEL[id] || id).join(", ")}{" "}
          have a reports-view permission defined but no report implementation
          behind it yet.
        </p>
      </section>
    </>
  );
}
