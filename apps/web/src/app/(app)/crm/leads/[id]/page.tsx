import { notFound } from "next/navigation";
import { findCrmDuplicates, getCrmRecord } from "@vercentlabs/api";
import CrmLeadActions from "@/components/crm-lead-actions";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
const nice = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  let data;
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const lead = await getCrmRecord(client, context, "leads", id);
      const [
        activities,
        communications,
        notes,
        scoreHistory,
        opportunities,
        duplicates,
      ] = [
        await client.query(
          `SELECT a.*,u.full_name AS assigned_name FROM tenant.crm_activities a LEFT JOIN public.users u ON u.id=a.assigned_to WHERE a.organization_id=$1 AND a.entity_type='lead' AND a.entity_id=$2 ORDER BY COALESCE(a.completed_at,a.due_at,a.created_at) DESC LIMIT 100`,
          [context.organizationId, id],
        ),
        await client.query(
          `SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND lead_id=$2 ORDER BY occurred_at DESC LIMIT 100`,
          [context.organizationId, id],
        ),
        await client.query(
          `SELECT n.*,u.full_name AS author_name FROM tenant.crm_notes n LEFT JOIN public.users u ON u.id=n.created_by WHERE n.organization_id=$1 AND n.entity_type='lead' AND n.entity_id=$2 ORDER BY is_pinned DESC,created_at DESC`,
          [context.organizationId, id],
        ),
        await client.query(
          `SELECT * FROM tenant.crm_lead_score_history WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC`,
          [context.organizationId, id],
        ),
        await client.query(
          `SELECT * FROM tenant.crm_opportunities WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC`,
          [context.organizationId, id],
        ),
        await findCrmDuplicates(client, context, lead, id),
      ];
      return {
        lead,
        activities: activities.rows,
        communications: communications.rows,
        notes: notes.rows,
        scoreHistory: scoreHistory.rows,
        opportunities: opportunities.rows,
        duplicates,
      };
    });
  } catch {
    return notFound();
  }
  const lead = data.lead as Record<string, unknown>;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Lead · {String(lead.code)}</p>
          <h1>{String(lead.fullName || lead.companyName || "Lead")}</h1>
          <p>
            {[lead.companyName, lead.jobTitle, lead.email, lead.mobile]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="status-badge neutral">
          {nice(String(lead.status))} · score {String(lead.score || 0)}
        </span>
      </section>
      {hasPermission(session, PERMISSIONS.crmLeadsManage) ? (
        <CrmLeadActions
          leadId={id}
          status={String(lead.status)}
          duplicates={JSON.parse(JSON.stringify(data.duplicates))}
        />
      ) : null}
      <div className="crm-detail-grid">
        <section className="panel">
          <p className="eyebrow">Profile</p>
          <h2>Lead information</h2>
          <dl className="crm-detail-list">
            {Object.entries(lead)
              .filter(
                ([key]) =>
                  !["id", "organizationId", "customData"].includes(key),
              )
              .slice(0, 30)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{nice(key.replace(/([A-Z])/g, " $1"))}</dt>
                  <dd>
                    {value === null || value === ""
                      ? "—"
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="panel">
          <p className="eyebrow">Journey</p>
          <h2>Timeline</h2>
          <div className="crm-timeline">
            {[
              ...data.activities.map((row) => ({
                ...row,
                __kind: "Activity",
                __date: row.completed_at || row.due_at || row.created_at,
                __title: row.subject,
              })),
              ...data.communications.map((row) => ({
                ...row,
                __kind: "Communication",
                __date: row.occurred_at,
                __title: row.subject || row.channel,
              })),
              ...data.notes.map((row) => ({
                ...row,
                __kind: "Note",
                __date: row.created_at,
                __title: "Note",
              })),
              ...data.opportunities.map((row) => ({
                ...row,
                __kind: "Opportunity",
                __date: row.created_at,
                __title: row.name,
              })),
            ]
              .sort(
                (a, b) =>
                  new Date(String(b.__date)).getTime() -
                  new Date(String(a.__date)).getTime(),
              )
              .map((event, index) => (
                <article
                  key={`${String(event.__kind)}-${String(event.id)}-${index}`}
                >
                  <span>{String(event.__kind).slice(0, 1)}</span>
                  <div>
                    <strong>{String(event.__title)}</strong>
                    <p>
                      {String(
                        event.description ||
                          event.body ||
                          event.outcome ||
                          event.status ||
                          "",
                      )}
                    </p>
                    <time>
                      {event.__date
                        ? new Intl.DateTimeFormat("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(String(event.__date)))
                        : ""}
                    </time>
                  </div>
                </article>
              ))}
            {!data.activities.length &&
            !data.communications.length &&
            !data.notes.length &&
            !data.opportunities.length ? (
              <div className="empty-state">
                <strong>No timeline events yet</strong>
                <p>
                  Log an activity, note or communication to begin the
                  relationship history.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <section className="panel">
        <p className="eyebrow">Scoring</p>
        <h2>Score history</h2>
        <div className="crm-stage-summary">
          {data.scoreHistory.map((row) => (
            <div key={String(row.id)}>
              <span>
                <strong>{String(row.reason)}</strong>
                <small>
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(String(row.created_at)))}
                </small>
              </span>
              <b>
                {String(row.previous_score)} → {String(row.new_score)}
              </b>
            </div>
          ))}
          {!data.scoreHistory.length ? (
            <div className="empty-state">
              <p>No score changes recorded.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
