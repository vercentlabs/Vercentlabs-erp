import Link from "next/link";

import ContactAccountLookup from "@/modules/crm/prospect-and-relationship-master-data/contact-account-lookup";
import ContactFormDrawer from "@/modules/crm/prospect-and-relationship-master-data/contact-form-drawer";
import {
  EnterpriseDataGrid,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

type Contact = Record<string, unknown>;

function href(query: Record<string, string | number | undefined>) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "" || (key === "page" && value === 1)) continue;
    parameters.set(key, String(value));
  }
  const value = parameters.toString();
  return value ? `/crm/contacts?${value}` : "/crm/contacts";
}

function name(contact: Contact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function date(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsed);
}

export default function ContactsWorkspace({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  accountId,
  accountName,
  canManage,
  create,
}: {
  rows: Contact[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  accountId: string;
  accountName: string;
  canManage: boolean;
  create: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const query = { search, status, accountId };

  return (
    <div className="crm-contacts-workspace">
      <header className="crm-contacts-heading">
        <div>
          <p className="eyebrow">CRM · Relationships</p>
          <h1>Contacts</h1>
          <p>People associated with your customers and business relationships.</p>
        </div>
        {canManage ? (
          <Link className="primary-button" href={href({ ...query, create: 1 })}>
            Create contact
          </Link>
        ) : null}
      </header>

      <section className="panel crm-contacts-panel" aria-labelledby="contact-records-heading">
        <form className="crm-contact-filters" action="/crm/contacts" method="get">
          <label className="crm-contact-search">
            <span>Search contacts</span>
            <input
              name="search"
              type="search"
              suppressHydrationWarning
              defaultValue={search}
              placeholder="Name, email, phone, job title or account"
            />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={status}>
              <option value="active">Active</option>
              <option value="inactive">Archived</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <ContactAccountLookup initialId={accountId} initialName={accountName} label="Account filter" />
          <button className="secondary-button" type="submit">Apply</button>
          {(search || status !== "active" || accountId) ? (
            <Link className="link-button crm-contact-clear" href="/crm/contacts">Clear</Link>
          ) : null}
        </form>

        <div className="crm-contact-list-heading">
          <div>
            <p className="eyebrow">Contact records</p>
            <h2 id="contact-records-heading">{total} {total === 1 ? "contact" : "contacts"}</h2>
          </div>
          <p>Showing {from}–{to}</p>
        </div>

        {(() => {
          const statusTone = (contact: Contact) =>
            contact.status === "active" ? "success" : "neutral";
          const statusLabel = (contact: Contact) =>
            contact.status === "active" ? "Active" : "Archived";
          const columns: DataGridColumn<Contact>[] = [
            {
              id: "contact",
              header: "Contact",
              cell: (contact) => (
                <Link
                  className="crm-contact-name-link"
                  href={`/crm/contacts/${String(contact.id)}`}
                >
                  {name(contact)}
                </Link>
              ),
            },
            {
              id: "account",
              header: "Account",
              cell: (contact) =>
                contact.accountId ? (
                  <span className="crm-contact-cell-stack">
                    <Link href={`/crm/accounts/${String(contact.accountId)}`}>
                      {String(contact.accountName)}
                    </Link>
                    {contact.accountStatus === "inactive" ? (
                      <small>Archived account</small>
                    ) : null}
                  </span>
                ) : (
                  <span className="crm-contact-muted">Standalone</span>
                ),
            },
            {
              id: "role",
              header: "Role",
              cell: (contact) => String(contact.designation || "—"),
            },
            {
              id: "contactInfo",
              header: "Contact information",
              cell: (contact) => (
                <span className="crm-contact-cell-stack">
                  <span>{String(contact.email || "—")}</span>
                  <small>{String(contact.mobile || contact.phone || "")}</small>
                </span>
              ),
            },
            {
              id: "status",
              header: "Status",
              cell: (contact) => (
                <StatusBadge tone={statusTone(contact)}>
                  {statusLabel(contact)}
                </StatusBadge>
              ),
            },
            {
              id: "updated",
              header: "Updated",
              cell: (contact) => date(contact.updatedAt),
            },
          ];
          return (
            <EnterpriseDataGrid
              caption="Contact records"
              rows={rows}
              rowKey={(contact) => String(contact.id)}
              columns={columns}
              emptyState={
                <StatePanel
                  title={
                    search || accountId || status !== "active"
                      ? "No matching contacts"
                      : "No contacts yet"
                  }
                  description={
                    search || accountId || status !== "active"
                      ? "Adjust the search or filters and try again."
                      : "Contacts represent the people you work with at customer and prospect companies."
                  }
                  action={
                    canManage && !search && !accountId && status === "active" ? (
                      <Link className="primary-button" href="/crm/contacts?create=1">
                        Create contact
                      </Link>
                    ) : undefined
                  }
                />
              }
              renderMobileCard={(contact) => (
                <Link
                  className="crm-contact-card"
                  href={`/crm/contacts/${String(contact.id)}`}
                >
                  <div>
                    <strong>{name(contact)}</strong>
                    <StatusBadge tone={statusTone(contact)}>
                      {statusLabel(contact)}
                    </StatusBadge>
                  </div>
                  <p>{String(contact.designation || "No job title")}</p>
                  <dl>
                    <div>
                      <dt>Account</dt>
                      <dd>{String(contact.accountName || "Standalone")}</dd>
                    </div>
                    <div>
                      <dt>Contact</dt>
                      <dd>
                        {String(
                          contact.email || contact.mobile || contact.phone || "—",
                        )}
                      </dd>
                    </div>
                  </dl>
                  <span className="crm-contact-card-open" aria-hidden="true">
                    →
                  </span>
                </Link>
              )}
            />
          );
        })()}

        {pageCount > 1 ? (
          <nav className="crm-contact-pagination" aria-label="Contact pages">
            {page > 1 ? <Link className="secondary-button" href={href({ ...query, page: page - 1 })}>Previous</Link> : <span />}
            <span>Page {page} of {pageCount}</span>
            {page < pageCount ? <Link className="secondary-button" href={href({ ...query, page: page + 1 })}>Next</Link> : <span />}
          </nav>
        ) : null}
      </section>

      {create ? <ContactFormDrawer closeHref={href(query)} /> : null}
    </div>
  );
}
