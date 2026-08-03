import { notFound } from "next/navigation";
import { findContactDuplicates } from "@vercentlabs/api";
import CrmContactMergeActions from "@/components/crm-contact-merge-actions";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  let data: { contact: Row; duplicates: Row[]; timeline: Row[] };
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const result = await client.query(
        `SELECT contact.*,party.display_name AS account_name
         FROM tenant.contacts contact
         JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id
         WHERE contact.organization_id=$1 AND contact.id=$2`,
        [context.organizationId, id],
      );
      if (!result.rows[0]) throw new Error("Contact not found");
      const contact = result.rows[0];
      const duplicates = await findContactDuplicates(client, context, {
        email: contact.email,
        mobile: contact.mobile,
        phone: contact.phone,
        firstName: contact.first_name,
        lastName: contact.last_name,
        excludeId: id,
      });
      const timeline = await client.query(
        `SELECT 'activity' AS entry_type,id,COALESCE(completed_at,start_at,created_at) AS occurred_at,subject AS title,status
         FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='contact' AND entity_id=$2
         UNION ALL
         SELECT 'communication',id,occurred_at,COALESCE(subject,channel),status
         FROM tenant.crm_communications WHERE organization_id=$1 AND contact_id=$2
         ORDER BY occurred_at DESC LIMIT 200`,
        [context.organizationId, id],
      );
      return { contact, duplicates, timeline: timeline.rows };
    });
  } catch {
    return notFound();
  }
  const contact = data.contact;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM · Contact</p>
          <h1>
            {`${String(contact.first_name)} ${String(contact.last_name || "")}`.trim()}
          </h1>
          <p>
            {[
              contact.account_name,
              contact.designation,
              contact.email,
              contact.mobile || contact.phone,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="status-badge neutral">
          {String(contact.status)} ·{" "}
          {String(contact.privacy_status || "active")}
        </span>
      </section>
      <CrmContactMergeActions
        contactId={id}
        canManage={hasPermission(session, PERMISSIONS.crmAccountsManage)}
        duplicates={data.duplicates.map((row) => ({
          id: String(row.id),
          firstName: String(row.first_name),
          lastName: row.last_name ? String(row.last_name) : undefined,
          accountName: row.account_name ? String(row.account_name) : undefined,
          matchScore: Number(row.match_score || 0),
        }))}
      />
      <section className="panel">
        <p className="eyebrow">Relationship history</p>
        <h2>Contact timeline</h2>
        <div className="crm-timeline">
          {data.timeline.map((entry) => (
            <article key={`${String(entry.entry_type)}-${String(entry.id)}`}>
              <span>{String(entry.entry_type).slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{String(entry.title)}</strong>
                <p>{String(entry.status)}</p>
                <time>
                  {entry.occurred_at
                    ? new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(String(entry.occurred_at)))
                    : ""}
                </time>
              </div>
            </article>
          ))}
          {!data.timeline.length ? (
            <div className="empty-state">
              <p>No contact events recorded.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
