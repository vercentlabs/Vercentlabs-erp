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
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: String(currency || "INR"),
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default async function CrmAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = crmContext(session);

  let data: {
    account: Row;
    contacts: Row[];
    opportunities: Row[];
    activities: Row[];
    communications: Row[];
    notes: Row[];
  };
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const accountResult = await client.query(
        `SELECT * FROM tenant.business_parties WHERE organization_id=$1 AND id=$2 AND party_type IN ('customer','both','prospect') LIMIT 1`,
        [context.organizationId, id],
      );
      if (!accountResult.rows[0]) throw new Error("Account not found");
      const [contacts, opportunities, activities, communications, notes] = await Promise.all([
        client.query(`SELECT * FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND status='active' ORDER BY is_primary DESC,first_name,last_name`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_opportunities WHERE organization_id=$1 AND party_id=$2 AND status<>'archived' ORDER BY updated_at DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='party' AND entity_id=$2 ORDER BY COALESCE(completed_at,due_at,created_at) DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND party_id=$2 ORDER BY occurred_at DESC LIMIT 100`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_notes WHERE organization_id=$1 AND entity_type='party' AND entity_id=$2 ORDER BY is_pinned DESC,created_at DESC LIMIT 100`, [context.organizationId, id]),
      ]);
      return {
        account: accountResult.rows[0],
        contacts: contacts.rows,
        opportunities: opportunities.rows,
        activities: activities.rows,
        communications: communications.rows,
        notes: notes.rows,
      };
    });
  } catch {
    notFound();
  }

  const account = data.account;
  const openOpportunities = data.opportunities.filter((row) => row.status === "open");
  const pipeline = openOpportunities.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const timeline = [
    ...data.activities.map((row) => ({ kind: "Activity", title: row.subject, at: row.completed_at || row.due_at || row.created_at, detail: row.status })),
    ...data.communications.map((row) => ({ kind: "Communication", title: row.subject || row.channel, at: row.occurred_at, detail: `${row.direction || ""} ${row.channel || ""}`.trim() })),
    ...data.notes.map((row) => ({ kind: "Note", title: row.is_pinned ? "Pinned note" : "Note", at: row.created_at, detail: row.body })),
  ].sort((a, b) => new Date(String(b.at || 0)).getTime() - new Date(String(a.at || 0)).getTime());

  return (
    <div className="crm-record-page">
      <header className="crm-record-hero">
        <div>
          <Link className="crm-record-back" href="/crm/accounts">← Accounts</Link>
          <p className="eyebrow">CRM · Account</p>
          <h1>{String(account.display_name || "Account")}</h1>
          <p>{[account.legal_name, account.gstin, account.party_type].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="crm-record-actions">
          <span className="status-badge neutral">{String(account.status || "active")}</span>
          <Link className="primary-button" href="/crm/opportunities?create=1">New opportunity</Link>
        </div>
      </header>

      <section className="crm-record-metrics" aria-label="Account relationship summary">
        <article><span>Contacts</span><strong>{data.contacts.length}</strong></article>
        <article><span>Open opportunities</span><strong>{openOpportunities.length}</strong></article>
        <article><span>Open pipeline</span><strong>{money(pipeline, account.currency_code)}</strong></article>
        <article><span>Recent interactions</span><strong>{timeline.length}</strong></article>
      </section>

      <div className="crm-record-columns">
        <section className="panel">
          <div className="card-title-row"><div><p className="eyebrow">Relationships</p><h2>Contacts</h2></div><Link className="link-button" href="/crm/contacts">All contacts</Link></div>
          <div className="crm-stage-summary">
            {data.contacts.map((contact) => (
              <div key={String(contact.id)}>
                <span><strong>{`${String(contact.first_name)} ${String(contact.last_name || "")}`.trim()}</strong><small>{String(contact.designation || contact.email || contact.mobile || "Contact")}</small></span>
                <Link className="link-button" href={`/crm/contacts/${String(contact.id)}`}>Open</Link>
              </div>
            ))}
            {!data.contacts.length ? <div className="empty-state"><p>No active contacts yet.</p></div> : null}
          </div>
        </section>

        <section className="panel">
          <div className="card-title-row"><div><p className="eyebrow">Pipeline</p><h2>Opportunities</h2></div><Link className="link-button" href="/crm/opportunities">All opportunities</Link></div>
          <div className="crm-stage-summary">
            {data.opportunities.slice(0, 12).map((opportunity) => (
              <div key={String(opportunity.id)}>
                <span><strong>{String(opportunity.name)}</strong><small>{String(opportunity.status)} · {String(opportunity.probability || 0)}%</small></span>
                <Link className="link-button" href={`/crm/opportunities/${String(opportunity.id)}`}>Open</Link>
              </div>
            ))}
            {!data.opportunities.length ? <div className="empty-state"><p>No opportunities linked to this account.</p></div> : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="card-title-row"><div><p className="eyebrow">Timeline</p><h2>Relationship activity</h2></div><Link className="link-button" href="/crm/activities">Open activities</Link></div>
        <div className="crm-timeline">
          {timeline.slice(0, 40).map((entry, index) => (
            <article key={`${entry.kind}-${index}-${String(entry.at)}`}>
              <span>{entry.kind.slice(0, 1)}</span>
              <div><strong>{String(entry.title || entry.kind)}</strong><p>{String(entry.detail || "")}</p><time>{dateTime(entry.at)}</time></div>
            </article>
          ))}
          {!timeline.length ? <div className="empty-state"><p>No CRM interactions recorded for this account yet.</p></div> : null}
        </div>
      </section>
    </div>
  );
}
