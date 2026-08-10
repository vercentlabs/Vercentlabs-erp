import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/components/app-icon";
import AuditEventTable, { type AuditEventDisplayRow } from "@/components/audit-event-table";
import GovernancePagination from "@/components/governance-pagination";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { redactAuditPayload } from "@/lib/audit/redact";
import { listAuditEvents } from "@/lib/audit/query";

export const metadata = { title: "Audit logs" };
export const dynamic = "force-dynamic";

const EVENT_CATEGORIES = [
  { value: "", label: "All events" },
  { value: "auth.", label: "Authentication" },
  { value: "access.", label: "Access & roles" },
  { value: "crm.", label: "CRM" },
  { value: "accounting.", label: "Accounting" },
  { value: "sales.", label: "Sales" },
  { value: "billing.", label: "Billing" },
  { value: "business_data.", label: "Master data" },
  { value: "approval.", label: "Approvals" },
  { value: "module.", label: "Modules" },
];

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    event?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
  }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.auditView)) notFound();

  const params = await searchParams;
  const q = params.q || "";
  const event = params.event || "";
  const entityType = params.entityType || "";
  const dateFrom = params.dateFrom || "";
  const dateTo = params.dateTo || "";
  const page = Number(params.page || 1);

  const { rows, total, pageSize } = await listAuditEvents(
    session.organizationId as string,
    {
      search: q,
      eventTypePrefix: event,
      entityType,
      dateFrom,
      dateTo,
      page,
    },
  );

  const displayRows: AuditEventDisplayRow[] = rows.map((row) => ({
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
  if (q) extraParams.q = q;
  if (event) extraParams.event = event;
  if (entityType) extraParams.entityType = entityType;
  if (dateFrom) extraParams.dateFrom = dateFrom;
  if (dateTo) extraParams.dateTo = dateTo;
  const exportQuery = new URLSearchParams(extraParams).toString();

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Audit logs</p>
          <h1>Audit events</h1>
          <p>
            An immutable, append-only record of authentication, access,
            configuration and business events. Sensitive keys are redacted
            before display.
          </p>
        </div>
      </section>

      <nav className="tab-strip" aria-label="Audit log views">
        <span className="tab-strip-item active">Audit events</span>
        <Link className="tab-strip-item" href="/audit-logs/history">
          Record history
        </Link>
        <Link className="tab-strip-item" href="/audit-logs/activity">
          User activity
        </Link>
        <Link className="tab-strip-item" href="/audit-logs/security">
          Security events
        </Link>
      </nav>

      <form className="filter-bar" aria-label="Filter audit events">
        <label>
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Entity, identifier or actor email"
          />
        </label>
        <label>
          Category
          <select name="event" defaultValue={event}>
            {EVENT_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entity type
          <input
            name="entityType"
            defaultValue={entityType}
            placeholder="e.g. crm_lead"
          />
        </label>
        <label>
          From
          <input type="date" name="dateFrom" defaultValue={dateFrom} />
        </label>
        <label>
          To
          <input type="date" name="dateTo" defaultValue={dateTo} />
        </label>
        <button className="secondary-button" type="submit">
          Filter
        </button>
        <a
          className="secondary-button"
          href={`/api/audit-logs/export?${exportQuery}`}
          aria-label="Export filtered audit events as CSV"
        >
          <AppIcon name="search" size={15} /> Export CSV
        </a>
      </form>

      <AuditEventTable rows={displayRows} />
      <GovernancePagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/audit-logs"
        extraParams={extraParams}
      />
    </>
  );
}
