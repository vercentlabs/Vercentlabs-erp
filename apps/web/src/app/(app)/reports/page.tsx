import Link from "next/link";

import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import AppIcon from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { getAccessibleModules } from "@/core/module-access";
import { MODULES_WITHOUT_REPORTS, REPORT_CATALOGUE } from "@/core/reports/catalogue";

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
            nothing here becomes an alternate system of record. Platform admins can
            save permission-gated launch definitions for these real report families.
            T01 deliberately provides no cross-module report builder, no chart/pivot engine, and no
            scheduled-email report runner where no governed engine exists.
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

      {hasPermission(session, PERMISSIONS.platformReportsManage) ? (
        <section className="dashboard-section" aria-labelledby="shared-report-governance-title">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Shared reporting governance</p>
              <h2 id="shared-report-governance-title">Saved report launch definitions</h2>
            </div>
            <Link href="/settings/platform#reports">Manage definitions <AppIcon name="arrow-right" size={16} /></Link>
          </div>
          <p className="billing-commercial-note">
            Shared definitions re-check the underlying module report permission every time they are opened and record launch evidence without duplicating business truth.
          </p>
        </section>
      ) : null}

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
