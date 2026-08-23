import AppIcon from "@/shared/components/app-icon";

export type AuditEventDisplayRow = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata: unknown;
  beforeData: unknown;
  afterData: unknown;
  entityHref?: string;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function hasDetail(row: AuditEventDisplayRow) {
  return Boolean(
    (row.metadata && Object.keys(row.metadata as object).length) ||
      row.beforeData ||
      row.afterData,
  );
}

// Server-rendered — every value arriving here has already been through
// redactAuditPayload() (Part 42/43). Detail JSON sits inside a collapsed
// <details> per row so a page of 50-200 events never renders megabytes of
// visible JSON at once (Part 41); the browser only needs to lay it out
// once a user actually opens it.
export default function AuditEventTable({
  rows,
  emptyMessage = "No matching audit events.",
}: {
  rows: AuditEventDisplayRow[];
  emptyMessage?: string;
}) {
  if (!rows.length) {
    return (
      <div className="empty-state compact">
        <span className="empty-state-icon" aria-hidden="true">
          <AppIcon name="audit" size={20} />
        </span>
        <div>
          <strong>Nothing here</strong>
          <p>{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="table-panel audit-event-table-panel">
      <table>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Event</th>
            <th scope="col">Actor</th>
            <th scope="col">Entity</th>
            <th scope="col">IP</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatTime(row.createdAt)}</td>
              <td>
                <strong>{row.eventType}</strong>
              </td>
              <td>
                {row.actorName || "System"}
                <br />
                <small>{row.actorEmail || ""}</small>
              </td>
              <td>
                {row.entityId ? (
                  <a
                    href={`/audit-logs/history?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}`}
                  >
                    {row.entityType} · {row.entityId}
                  </a>
                ) : (
                  row.entityType
                )}
              </td>
              <td>{row.ipAddress || "—"}</td>
              <td>
                {hasDetail(row) ? (
                  <details className="audit-event-detail">
                    <summary>View</summary>
                    {row.metadata && Object.keys(row.metadata as object).length ? (
                      <>
                        <p className="audit-event-detail-label">Metadata</p>
                        <pre>{JSON.stringify(row.metadata, null, 2)}</pre>
                      </>
                    ) : null}
                    {row.beforeData ? (
                      <>
                        <p className="audit-event-detail-label">Before</p>
                        <pre>{JSON.stringify(row.beforeData, null, 2)}</pre>
                      </>
                    ) : null}
                    {row.afterData ? (
                      <>
                        <p className="audit-event-detail-label">After</p>
                        <pre>{JSON.stringify(row.afterData, null, 2)}</pre>
                      </>
                    ) : null}
                  </details>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
