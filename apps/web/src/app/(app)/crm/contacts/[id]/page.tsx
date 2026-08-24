import Link from "next/link";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmContext } from "@/modules/crm";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

function dateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = crmContext(session);

  let data: { contact: Row; opportunities: Row[]; activities: Row[]; communications: Row[]; notes: Row[] };
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const result = await client.query(
        `SELECT contact.*,party.display_name AS account_name FROM tenant.contacts contact JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id WHERE contact.organization_id=$1 AND contact.id=$2 LIMIT 1`,
        [context.organizationId, id],
      );
      if (!result.rows[0]) throw new Error("Contact not found");
      const contact = result.rows[0];
      const [opportunities, activities, communications, notes] = await Promise.all([
        client.query(`SELECT * FROM tenant.crm_opportunities WHERE organization_id=$1 AND contact_id=$2 AND status<>'archived' ORDER BY updated_at DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='contact' AND entity_id=$2 ORDER BY COALESCE(completed_at,due_at,created_at) DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND contact_id=$2 ORDER BY occurred_at DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_notes WHERE organization_id=$1 AND entity_type='contact' AND entity_id=$2 ORDER BY is_pinned DESC,created_at DESC LIMIT 100`, [context.organizationId, id]),
      ]);
      return { contact, opportunities: opportunities.rows, activities: activities.rows, communications: communications.rows, notes: notes.rows };
    });
  } catch {
    notFound();
  }

  const contact = data.contact;
  const timeline = [
    ...data.activities.map((row) => ({ kind: "Activity", title: row.subject, at: row.completed_at || row.due_at || row.created_at, detail: row.status })),
    ...data.communications.map((row) => ({ kind: "Communication", title: row.subject || row.channel, at: row.occurred_at, detail: `${row.direction || ""} ${row.channel || ""}`.trim() })),
    ...data.notes.map((row) => ({ kind: "Note", title: row.is_pinned ? "Pinned note" : "Note", at: row.created_at, detail: row.body })),
  ].sort((a, b) => new Date(String(b.at || 0)).getTime() - new Date(String(a.at || 0)).getTime());

  return (
    <div className="crm-record-page">
      <header className="crm-record-hero">
        <div>
          <Link className="crm-record-back" href="/crm/contacts">← Contacts</Link>
          <p className="eyebrow">CRM · Contact</p>
          <h1>{`${String(contact.first_name)} ${String(contact.last_name || "")}`.trim()}</h1>
          <p>{[contact.designation, contact.email, contact.mobile || contact.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="crm-record-actions">
          <span className="status-badge neutral">{String(contact.status || "active")}</span>
          <Link className="secondary-button" href={`/crm/accounts/${String(contact.party_id)}`}>Open account</Link>
        </div>
      </header>

      <section className="crm-record-facts">
        <div><small>Account</small><strong><Link href={`/crm/accounts/${String(contact.party_id)}`}>{String(contact.account_name)}</Link></strong></div>
        <div><small>Email</small><strong>{String(contact.email || "—")}</strong></div>
        <div><small>Mobile</small><strong>{String(contact.mobile || contact.phone || "—")}</strong></div>
        <div><small>Primary contact</small><strong>{contact.is_primary ? "Yes" : "No"}</strong></div>
      </section>

      <div className="crm-record-columns">
        <section className="panel">
          <div className="card-title-row"><div><p className="eyebrow">Pipeline</p><h2>Linked opportunities</h2></div><Link className="link-button" href="/crm/opportunities">All opportunities</Link></div>
          <div className="crm-stage-summary">
            {data.opportunities.map((row) => (
              <div key={String(row.id)}><span><strong>{String(row.name)}</strong><small>{String(row.status)} · {String(row.probability || 0)}%</small></span><Link className="link-button" href={`/crm/opportunities/${String(row.id)}`}>Open</Link></div>
            ))}
            {!data.opportunities.length ? <div className="empty-state"><p>No opportunities linked to this contact.</p></div> : null}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Communication</p>
          <h2>Recent interactions</h2>
          <p>{data.communications.length} communication records and {data.activities.length} activities are linked to this contact.</p>
          <Link className="secondary-button" href="/crm/activities">Open activity queue</Link>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">Timeline</p>
        <h2>Contact activity</h2>
        <div className="crm-timeline">
          {timeline.slice(0, 40).map((entry, index) => (
            <article key={`${entry.kind}-${index}-${String(entry.at)}`}><span>{entry.kind.slice(0, 1)}</span><div><strong>{String(entry.title || entry.kind)}</strong><p>{String(entry.detail || "")}</p><time>{dateTime(entry.at)}</time></div></article>
          ))}
          {!timeline.length ? <div className="empty-state"><p>No contact activity recorded yet.</p></div> : null}
        </div>
      </section>
    </div>
  );
}
