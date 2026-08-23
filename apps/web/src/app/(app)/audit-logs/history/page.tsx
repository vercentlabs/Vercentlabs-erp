import Link from "next/link";
import { notFound } from "next/navigation";

import AuditEventTable, { type AuditEventDisplayRow } from "@/core/components/audit-event-table";
import GovernancePagination from "@/core/components/governance-pagination";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { redactAuditPayload } from "@/core/audit/redact";
import { listAuditEvents } from "@/core/audit/query";

export const metadata = { title: "Record history" };
export const dynamic = "force-dynamic";

export default async function RecordHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; entityId?: string; page?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.auditView)) notFound();

  const params = await searchParams;
  const entityType = params.entityType || "";
  const entityId = params.entityId || "";
  const page = Number(params.page || 1);
  const hasLookup = Boolean(entityType && entityId);

  const result = hasLookup
    ? await listAuditEvents(session.organizationId as string, {
        entityType,
        entityId,
        page,
        pageSize: 100,
      })
    : { rows: [], total: 0, page: 1, pageSize: 100 };

  const displayRows: AuditEventDisplayRow[] = result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    ipAddress: row.ip_address,
    createdAt: row.created_at.toISOString(),
    metadata: redactAuditPayload(row.metadata),
    beforeData: redactAuditPayload(row.before_data),
    afterData: redactAuditPayload(row.after_data),
  }));

  const extraParams: Record<string, string> = {};
  if (entityType) extraParams.entityType = entityType;
  if (entityId) extraParams.entityId = entityId;

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Audit logs</p>
          <h1>Record history</h1>
          <p>
            What changed on a specific record, who changed it, and when.
            Field-level protections still apply — sensitive keys are
            redacted before display.
          </p>
        </div>
      </section>

      <nav className="tab-strip" aria-label="Audit log views">
        <Link className="tab-strip-item" href="/audit-logs">
          Audit events
        </Link>
        <span className="tab-strip-item active">Record history</span>
        <Link className="tab-strip-item" href="/audit-logs/activity">
          User activity
        </Link>
        <Link className="tab-strip-item" href="/audit-logs/security">
          Security events
        </Link>
      </nav>

      <form className="filter-bar" aria-label="Look up record history">
        <label>
          Entity type
          <input name="entityType" defaultValue={entityType} placeholder="e.g. crm_lead" required />
        </label>
        <label>
          Entity ID
          <input name="entityId" defaultValue={entityId} placeholder="Record identifier" required />
        </label>
        <button className="secondary-button" type="submit">
          Look up
        </button>
      </form>

      {hasLookup ? (
        <>
          <AuditEventTable
            rows={displayRows}
            emptyMessage="No audit events found for this entity type and ID."
          />
          <GovernancePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            basePath="/audit-logs/history"
            extraParams={extraParams}
          />
        </>
      ) : (
        <div className="empty-state">
          <strong>Enter an entity type and ID</strong>
          <p>
            Record-history rows on the Audit events list link here for the
            record they belong to; you can also look one up directly.
          </p>
        </div>
      )}
    </>
  );
}
