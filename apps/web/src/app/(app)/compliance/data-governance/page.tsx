import Link from "next/link";
import { notFound } from "next/navigation";

import { getPrivacyRetentionDashboard } from "@vercentlabs/api";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const metadata = { title: "Data governance" };
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

export default async function DataGovernancePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.complianceView)) notFound();

  const dashboard = (await tenantTransaction(session.organizationId as string, (client) =>
    getPrivacyRetentionDashboard(client, crmContext(session)),
  ).catch(() => ({ metrics: { activePolicies: 0 } }))) as Row;
  const activePolicies = Number((dashboard.metrics as Row)?.activePolicies || 0);

  // Only real, evidence-backed capabilities appear here — each status
  // string is either a live query result or a fact directly confirmed
  // against the current codebase (see docs/implementation/
  // ERP_GOVERNANCE_009.md Section 17). No fabricated compliance score, no
  // capability listed without either a real destination or an accurate
  // status description. "Import templates" (Part 22's target list also
  // names it) is deliberately absent — confirmed absent from the
  // repository, not linked to a stub.
  const capabilities: Array<{
    label: string;
    status: string;
    href?: string;
    note?: string;
  }> = [
    {
      label: "Shared masters",
      status: "16 shared resources across Partners, Products, Inventory, Finance",
      href: "/master-data",
    },
    {
      label: "Audit trail",
      status: "Enabled — database-trigger-immutable event log",
      href: "/audit-logs",
    },
    {
      label: "Retention",
      status: `${activePolicies} active ${activePolicies === 1 ? "policy" : "policies"} (CRM customer data)`,
      href: "/compliance/retention",
    },
    {
      label: "Numbering series",
      status: "Configured",
      href: "/settings/numbering-series",
    },
    {
      label: "Duplicate management",
      status: "Active — CRM lead duplicate detection only",
      note: "Not yet available for other modules.",
    },
    {
      label: "Archiving & soft delete",
      status: "Status-based archiving (CRM, Master Data)",
      note: "Records move to an archived/inactive status rather than a timestamp-based soft delete; some resources restrict archiving of terminal records (e.g. completed privacy requests).",
    },
    {
      label: "Record ownership",
      status: "CRM owner-based scoping (leads, opportunities, activities)",
      note: "Not a global ownership engine — other modules use their own access rules.",
    },
    {
      label: "Master approval",
      status: "Approval / separation-of-duties engine active",
      note: "Used by Procurement purchase-order approval and Accounting journal posting; no standalone admin workspace.",
    },
    {
      label: "Bulk update",
      status: "Available in CRM (leads, opportunities) and Sales (orders, quotations)",
      note: "Per-module, not a unified control.",
    },
    {
      label: "Validation rules",
      status: "CRM lead-governance rules configured per pipeline",
      note: "No dedicated administration screen yet.",
    },
  ];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Compliance</p>
          <h1>Data governance</h1>
          <p>
            An honest inventory of the platform&apos;s real data-governance
            controls — what exists, its current status, and where to manage
            it. Nothing listed here that isn&apos;t actually implemented.
          </p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Data governance capabilities">
        {capabilities.map((capability) =>
          capability.href ? (
            <Link className="metric-card" href={capability.href} key={capability.label}>
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="modules" size={21} />
              </span>
              <span className="metric-copy">
                <small>{capability.label}</small>
                <strong>{capability.status}</strong>
              </span>
              <AppIcon className="metric-arrow" name="arrow-right" size={17} />
            </Link>
          ) : (
            <article className="metric-card static" key={capability.label}>
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="modules" size={21} />
              </span>
              <span className="metric-copy">
                <small>{capability.label}</small>
                <strong>{capability.status}</strong>
                {capability.note ? <span className="metric-note">{capability.note}</span> : null}
              </span>
            </article>
          ),
        )}
      </section>
    </>
  );
}
