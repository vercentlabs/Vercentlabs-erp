import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmOptions, getCrmRecord } from "@vercentlabs/api";

import CrmOpportunityActions from "@/modules/crm/components/opportunity-actions";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

function nice(value: unknown) {
  return String(value ?? "—").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: String(currency || "INR"), maximumFractionDigits: 0 }).format(Number(value || 0));
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = crmContext(session);

  let data: {
    opportunity: Row;
    options: Record<string, Array<Record<string, unknown>>>;
    history: Row[];
    activities: Row[];
    communications: Row[];
    items: Row[];
  };
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const opportunity = await getCrmRecord(client, context, "opportunities", id);
      const [options, history, activities, communications, items] = await Promise.all([
        getCrmOptions(client, context),
        client.query(`SELECT h.*,fs.name AS from_stage,ts.name AS to_stage,u.full_name AS changed_by_name FROM tenant.crm_opportunity_stage_history h LEFT JOIN tenant.crm_pipeline_stages fs ON fs.id=h.from_stage_id LEFT JOIN tenant.crm_pipeline_stages ts ON ts.id=h.to_stage_id LEFT JOIN public.users u ON u.id=h.changed_by WHERE h.organization_id=$1 AND h.opportunity_id=$2 ORDER BY h.changed_at DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 ORDER BY COALESCE(completed_at,due_at,created_at) DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY occurred_at DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT oi.*,i.name AS item_name FROM tenant.crm_opportunity_items oi JOIN tenant.items i ON i.id=oi.item_id WHERE oi.organization_id=$1 AND oi.opportunity_id=$2 ORDER BY oi.created_at`, [context.organizationId, id]),
      ]);
      return { opportunity, options, history: history.rows, activities: activities.rows, communications: communications.rows, items: items.rows };
    });
  } catch {
    notFound();
  }

  const record = data.opportunity;
  const probability = Number(record.probability || 0);
  const amount = Number(record.amount || 0);
  const expectedRevenue = amount * Math.max(0, Math.min(100, probability)) / 100;
  const stages = (data.options.stages || [])
    .filter((stage) => String(stage.pipelineId) === String(record.pipelineId))
    .map((stage) => ({
      id: String(stage.id),
      name: String(stage.name),
      isWon: Boolean(stage.isWon),
      isLost: Boolean(stage.isLost),
    }));
  const outcomeReasons = (data.options.lostReasons || []).map((reason) => ({
    id: String(reason.id),
    name: String(reason.name),
    outcomeType: String(reason.outcomeType || "lost") as "won" | "lost" | "both",
  }));
  const outcomeReason = outcomeReasons.find((reason) => reason.id === String(record.outcomeReasonId || record.lostReasonId || ""));
  const canManage = hasPermission(session, PERMISSIONS.crmOpportunitiesManage);

  const timeline = [
    ...data.activities.map((row) => ({ kind: "Activity", title: row.subject, detail: row.status, at: row.completed_at || row.due_at || row.created_at })),
    ...data.communications.map((row) => ({ kind: "Communication", title: row.subject || row.channel, detail: `${row.direction || ""} ${row.channel || ""}`.trim(), at: row.occurred_at })),
  ].sort((a, b) => new Date(String(b.at || 0)).getTime() - new Date(String(a.at || 0)).getTime());

  return (
    <div className="crm-record-page crm-opportunity-page">
      <header className="crm-record-hero">
        <div>
          <Link className="crm-record-back" href="/crm/opportunities">← Opportunities</Link>
          <p className="eyebrow">Opportunity · {String(record.code || "")}</p>
          <h1>{String(record.name || "Opportunity")}</h1>
          <p>{String(record.nextStep || record.description || "Manage the next commercial action and expected close.")}</p>
        </div>
        <div className="crm-record-actions">
          <span className={`status-badge ${record.status === "won" ? "success" : record.status === "lost" ? "warning" : "neutral"}`}>{nice(record.status)}</span>
          {canManage ? <Link className="secondary-button" href={`/crm/opportunities?edit=${encodeURIComponent(id)}`}>Edit</Link> : null}
          {hasPermission(session, PERMISSIONS.salesQuotationCreate) && record.partyId ? (
            <Link className="primary-button" href={`/sales/quotations/new?opportunityId=${id}`}>Create quotation</Link>
          ) : null}
        </div>
      </header>

      <section className="crm-record-metrics" aria-label="Opportunity commercial summary">
        <article><span>Amount</span><strong>{money(amount, record.currencyCode)}</strong></article>
        <article><span>Probability</span><strong>{probability}%</strong></article>
        <article><span>Expected revenue</span><strong>{money(expectedRevenue, record.currencyCode)}</strong></article>
        <article><span>Expected close</span><strong>{record.expectedCloseDate ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(String(record.expectedCloseDate))) : "—"}</strong></article>
      </section>

      {canManage && !["won", "lost", "archived"].includes(String(record.status)) ? (
        <CrmOpportunityActions id={id} stageId={String(record.stageId)} updatedAt={String(record.updatedAt)} stages={stages} outcomeReasons={outcomeReasons} />
      ) : null}

      {["won", "lost"].includes(String(record.status)) ? (
        <section className="crm-outcome-banner">
          <div><small>{record.status === "won" ? "Won reason" : "Lost reason"}</small><strong>{outcomeReason?.name || "Reason not recorded"}</strong></div>
          <p>{String(record.outcomeNotes || record.lossNotes || "No outcome notes recorded.")}</p>
        </section>
      ) : null}

      <div className="crm-record-columns">
        <section className="panel">
          <p className="eyebrow">Stage history</p>
          <h2>Pipeline movement</h2>
          <div className="crm-timeline">
            {data.history.map((row) => (
              <article key={String(row.id)}><span>→</span><div><strong>{String(row.from_stage || "Created")} → {String(row.to_stage || "Stage")}</strong><p>{String(row.note || "")}</p><time>{dateTime(row.changed_at)}</time></div></article>
            ))}
            {!data.history.length ? <div className="empty-state"><p>No stage movement recorded yet.</p></div> : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Products & services</p>
          <h2>Opportunity items</h2>
          <div className="crm-stage-summary">
            {data.items.map((item) => (
              <div key={String(item.id)}><span><strong>{String(item.item_name)}</strong><small>{String(item.quantity)} × {money(item.unit_price, record.currencyCode)}</small></span><b>{money(item.line_total, record.currencyCode)}</b></div>
            ))}
            {!data.items.length ? <div className="empty-state"><p>No products or services added yet.</p></div> : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="card-title-row"><div><p className="eyebrow">Timeline</p><h2>Recent engagement</h2></div><Link className="link-button" href="/crm/activities">Open activities</Link></div>
        <div className="crm-timeline">
          {timeline.slice(0, 40).map((entry, index) => (
            <article key={`${entry.kind}-${index}-${String(entry.at)}`}><span>{entry.kind.slice(0, 1)}</span><div><strong>{String(entry.title || entry.kind)}</strong><p>{String(entry.detail || "")}</p><time>{dateTime(entry.at)}</time></div></article>
          ))}
          {!timeline.length ? <div className="empty-state"><p>No opportunity engagement recorded yet.</p></div> : null}
        </div>
      </section>
    </div>
  );
}
