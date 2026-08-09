import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmOptions, getCrmRecord } from "@vercentlabs/api";
import CrmOpportunityActions from "@/components/crm-opportunity-actions";
import FavouriteToggle from "@/components/favourite-toggle";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { isFavourited } from "@/lib/favourites";
import { trackRecentRecord } from "@/lib/recent-records";
export const dynamic = "force-dynamic";
const nice = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export default async function OpportunityDetailPage({
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
      const opportunity = await getCrmRecord(
        client,
        context,
        "opportunities",
        id,
      );
      const [options, history, activities, communications, items, competitors] =
        [
          await getCrmOptions(client, context),
          await client.query(
            `SELECT h.*,fs.name AS from_stage,ts.name AS to_stage,u.full_name AS changed_by_name FROM tenant.crm_opportunity_stage_history h LEFT JOIN tenant.crm_pipeline_stages fs ON fs.id=h.from_stage_id LEFT JOIN tenant.crm_pipeline_stages ts ON ts.id=h.to_stage_id LEFT JOIN public.users u ON u.id=h.changed_by WHERE h.organization_id=$1 AND h.opportunity_id=$2 ORDER BY h.changed_at DESC`,
            [context.organizationId, id],
          ),
          await client.query(
            `SELECT * FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 ORDER BY COALESCE(due_at,created_at) DESC`,
            [context.organizationId, id],
          ),
          await client.query(
            `SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY occurred_at DESC`,
            [context.organizationId, id],
          ),
          await client.query(
            `SELECT oi.*,i.name AS item_name FROM tenant.crm_opportunity_items oi JOIN tenant.items i ON i.id=oi.item_id WHERE oi.organization_id=$1 AND oi.opportunity_id=$2 ORDER BY oi.created_at`,
            [context.organizationId, id],
          ),
          await client.query(
            `SELECT c.* FROM tenant.crm_opportunity_competitors oc JOIN tenant.crm_competitors c ON c.id=oc.competitor_id WHERE oc.organization_id=$1 AND oc.opportunity_id=$2`,
            [context.organizationId, id],
          ),
        ];
      return {
        opportunity,
        options,
        history: history.rows,
        activities: activities.rows,
        communications: communications.rows,
        items: items.rows,
        competitors: competitors.rows,
      };
    });
  } catch {
    return notFound();
  }
  const record = data.opportunity as Record<string, unknown>;
  const href = `/crm/opportunities/${id}`;
  const label = String(record.name || "Opportunity");
  await trackRecentRecord(session, {
    targetType: "crm-opportunity",
    href,
    label,
    moduleKey: "crm",
  });
  const favourited = await isFavourited(session, href);
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Opportunity · {String(record.code)}</p>
          <h1>{label}</h1>
          <p>
            {String(
              record.nextStep ||
                record.description ||
                "Manage the next commercial action and expected close.",
            )}
          </p>
        </div>
        <FavouriteToggle
          href={href}
          label={label}
          targetType="crm-opportunity"
          moduleKey="crm"
          initialFavourited={favourited}
        />
        <span className="status-badge neutral">
          {nice(String(record.status))} · {String(record.probability)}%
        </span>
      </section>
      <div className="page-heading-actions">
        {hasPermission(session, PERMISSIONS.salesQuotationCreate) && record.partyId ? (
          <Link className="primary-button" href={`/sales/quotations/new?opportunityId=${id}`}>Create quotation</Link>
        ) : null}
      </div>
      {hasPermission(session, PERMISSIONS.crmOpportunitiesManage) ? (
        <CrmOpportunityActions
          id={id}
          stageId={String(record.stageId)}
          stages={JSON.parse(JSON.stringify(data.options.stages))}
        />
      ) : null}
      <div className="crm-detail-grid">
        <section className="panel">
          <p className="eyebrow">Commercial context</p>
          <h2>Opportunity information</h2>
          <dl className="crm-detail-list">
            {Object.entries(record)
              .filter(
                ([key]) =>
                  !["id", "organizationId", "customData"].includes(key),
              )
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
          <p className="eyebrow">Stage history</p>
          <h2>Pipeline movement</h2>
          <div className="crm-timeline">
            {data.history.map((row) => (
              <article key={String(row.id)}>
                <span>→</span>
                <div>
                  <strong>
                    {String(row.from_stage || "Created")} →{" "}
                    {String(row.to_stage)}
                  </strong>
                  <p>{String(row.note || "")}</p>
                  <time>
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(String(row.changed_at)))}
                  </time>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      <div className="crm-dashboard-grid">
        <section className="panel">
          <p className="eyebrow">Line items</p>
          <h2>Products and services</h2>
          <div className="crm-stage-summary">
            {data.items.map((item) => (
              <div key={String(item.id)}>
                <span>
                  <strong>{String(item.item_name)}</strong>
                  <small>
                    {String(item.quantity)} × {String(item.unit_price)}
                  </small>
                </span>
                <b>{String(item.line_total)}</b>
              </div>
            ))}
            {!data.items.length ? (
              <div className="empty-state">
                <p>No items added yet.</p>
              </div>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Competition</p>
          <h2>Known competitors</h2>
          <div className="crm-stage-summary">
            {data.competitors.map((item) => (
              <div key={String(item.id)}>
                <span>
                  <strong>{String(item.name)}</strong>
                  <small>{String(item.website || "")}</small>
                </span>
              </div>
            ))}
            {!data.competitors.length ? (
              <div className="empty-state">
                <p>No competitors linked.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
