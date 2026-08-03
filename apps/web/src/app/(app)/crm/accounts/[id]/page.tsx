import { notFound } from "next/navigation";
import {
  findAccountDuplicates,
  getAccountHierarchy,
  getCustomer360,
} from "@vercentlabs/api";
import CrmAccountIntelligenceActions from "@/components/crm-account-intelligence-actions";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: String(currency || "INR"),
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export default async function AccountCustomer360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  let data: {
    customer: Row;
    hierarchy: Row;
    duplicates: Row[];
    accounts: Row[];
  };
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const customer = (await getCustomer360(client, context, id)) as Row;
      const account = customer.account as Row;
      const hierarchy = (await getAccountHierarchy(client, context, id)) as Row;
      const duplicates = await findAccountDuplicates(client, context, {
        displayName: account.display_name,
        legalName: account.legal_name,
        gstin: account.gstin,
        pan: account.pan,
        excludeId: id,
      });
      const accounts = await client.query(
        `SELECT id,display_name AS name FROM tenant.business_parties
         WHERE organization_id=$1 AND status='active' ORDER BY display_name LIMIT 500`,
        [context.organizationId],
      );
      return { customer, hierarchy, duplicates, accounts: accounts.rows };
    });
  } catch {
    return notFound();
  }
  const account = data.customer.account as Row;
  const metrics = data.customer.metrics as Row;
  const timeline = (data.customer.timeline || []) as Row[];
  const hierarchy = data.hierarchy;
  const ancestors = (hierarchy.ancestors || []) as Row[];
  const descendants = (hierarchy.descendants || []) as Row[];
  const contacts = (data.customer.contacts || []) as Row[];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM · Customer 360</p>
          <h1>{String(account.display_name || "Account")}</h1>
          <p>
            {[account.legal_name, account.gstin, account.party_type]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="status-badge neutral">
          {String(account.status)} ·{" "}
          {String(account.privacy_status || "active")}
        </span>
      </section>

      <section className="module-metric-grid" aria-label="Customer 360 summary">
        {[
          ["Opportunities", metrics.opportunities || 0],
          ["Quotations", metrics.quotations || 0],
          ["Orders", metrics.orders || 0],
          ["Invoices", metrics.invoices || 0],
          ["Outstanding", money(metrics.outstanding, account.currency_code)],
          ["Open service cases", metrics.open_service_cases || 0],
        ].map(([label, value]) => (
          <article className="module-metric-card" key={String(label)}>
            <span className="module-metric-label">{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>

      <CrmAccountIntelligenceActions
        accountId={id}
        currentParentId={
          account.parent_party_id ? String(account.parent_party_id) : null
        }
        accounts={data.accounts.map((row) => ({
          id: String(row.id),
          name: String(row.name),
        }))}
        duplicates={data.duplicates.map((row) => ({
          id: String(row.id),
          displayName: String(row.display_name || row.legal_name || row.code),
          matchScore: Number(row.match_score || 0),
        }))}
        canManage={hasPermission(session, PERMISSIONS.crmAccountsManage)}
        canRecordService={hasPermission(
          session,
          PERMISSIONS.crmCommunicationsManage,
        )}
      />

      <div className="module-dashboard-grid module-dashboard-grid-wide">
        <section className="panel module-panel">
          <p className="eyebrow">Account hierarchy</p>
          <h2>Parents and subsidiaries</h2>
          <div className="crm-stage-summary">
            {ancestors.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>Parent · level {String(row.depth)}</small>
                </span>
              </div>
            ))}
            {descendants.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>Subsidiary · level {String(row.depth)}</small>
                </span>
              </div>
            ))}
            {!ancestors.length && !descendants.length ? (
              <div className="empty-state">
                <p>This account is not connected to a corporate hierarchy.</p>
              </div>
            ) : null}
          </div>
        </section>
        <section className="panel module-panel">
          <p className="eyebrow">People</p>
          <h2>Contacts</h2>
          <div className="crm-stage-summary">
            {contacts.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {`${String(row.first_name)} ${String(row.last_name || "")}`.trim()}
                  </strong>
                  <small>
                    {String(row.designation || row.email || "No role recorded")}
                  </small>
                </span>
                <a
                  className="link-button"
                  href={`/crm/contacts/${String(row.id)}`}
                >
                  Open
                </a>
              </div>
            ))}
            {!contacts.length ? (
              <div className="empty-state">
                <p>No contacts recorded.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">Unified chronology</p>
        <h2>CRM, quotes, orders, invoices and support</h2>
        <div className="crm-timeline">
          {timeline.map((entry) => {
            const details = (entry.details || {}) as Row;
            return (
              <article
                key={`${String(entry.entry_type)}-${String(entry.entry_id)}`}
              >
                <span>
                  {String(entry.entry_type || "?")
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div>
                  <strong>{String(entry.title || entry.entry_type)}</strong>
                  <p>
                    {String(entry.entry_type).replaceAll("_", " ")} ·{" "}
                    {String(entry.status || "recorded")}
                    {entry.amount
                      ? ` · ${money(entry.amount, entry.currency_code)}`
                      : ""}
                  </p>
                  {details.description ? (
                    <p>{String(details.description)}</p>
                  ) : null}
                  <time>{formatDate(entry.occurred_at)}</time>
                </div>
              </article>
            );
          })}
          {!timeline.length ? (
            <div className="empty-state">
              <p>No customer events have been recorded.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
