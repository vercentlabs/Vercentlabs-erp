import Link from "next/link";
import { getCrmAccountIntelligenceReadiness } from "@vercentlabs/api";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function AccountIntelligenceReadinessPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmReportsView)) return notFound();
  const context = crmContext(session);
  const readiness = (await tenantTransaction(context.organizationId, (client) =>
    getCrmAccountIntelligenceReadiness(client, context),
  )) as Row;
  const checks = (readiness.checks || []) as Row[];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-02 readiness</p>
          <h1>Account intelligence and privacy</h1>
          <p>
            Executable acceptance for CRM-027, CRM-028, CRM-029, CRM-030 and
            CRM-035.
          </p>
        </div>
        <span
          className={`status-badge ${readiness.readiness === "ready" ? "success" : "danger"}`}
        >
          {String(readiness.readiness)} · {String(readiness.score)}%
        </span>
      </section>
      <section className="module-hero-actions" aria-label="CRM-02 operations">
        <Link className="secondary-button" href="/crm/privacy-retention">
          Privacy retention
        </Link>
        <Link className="secondary-button" href="/crm/accounts">
          Accounts
        </Link>
        <Link className="secondary-button" href="/crm/contacts">
          Contacts
        </Link>
      </section>
      <section className="panel">
        <div className="crm-stage-summary">
          {checks.map((check) => (
            <div key={String(check.capabilityId)}>
              <span>
                <strong>{String(check.capabilityId)}</strong>
                <small>
                  {check.recordedAt
                    ? new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(String(check.recordedAt)))
                    : "No acceptance run"}
                </small>
              </span>
              <b>{String(check.status)}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
