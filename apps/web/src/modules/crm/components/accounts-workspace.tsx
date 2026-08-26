import Link from "next/link";

import AccountFormDrawer from "@/modules/crm/components/account-form-drawer";

type Account = Record<string, unknown>;

function accountHref(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (
      value !== undefined &&
      value !== "" &&
      value !== "active" &&
      !(key === "page" && value === 1)
    )
      params.set(key, String(value));
  }
  const suffix = params.toString();
  return `/crm/accounts${suffix ? `?${suffix}` : ""}`;
}

function location(account: Account) {
  return (
    [account.city, account.state, account.countryCode]
      .filter(Boolean)
      .join(", ") || "Location not added"
  );
}

export default function AccountsWorkspace({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  industry,
  country,
  filters,
  canManage,
  creating,
}: {
  rows: Account[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  industry: string;
  country: string;
  filters: { industries: string[]; countries: string[] };
  canManage: boolean;
  creating: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const query = { search, status, industry, country };
  const filtered = Boolean(
    search || status !== "active" || industry || country,
  );

  return (
    <div className="crm-accounts-workspace">
      <header className="crm-accounts-heading">
        <div>
          <p className="eyebrow">CRM · Relationships</p>
          <h1>Accounts</h1>
          <p>Companies and organisations in your CRM.</p>
        </div>
        {canManage ? (
          <Link
            className="primary-button"
            href={accountHref({ ...query, create: 1 })}
          >
            Create account
          </Link>
        ) : null}
      </header>

      <section
        className="panel crm-accounts-panel"
        aria-labelledby="account-records-title"
      >
        <form
          className="crm-account-filters"
          method="get"
          action="/crm/accounts"
        >
          <label className="crm-account-search">
            <span>Search accounts</span>
            <input
              name="search"
              type="search"
              defaultValue={search}
              placeholder="Name, code, website, phone, email or city"
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
          <label>
            <span>Industry</span>
            <select name="industry" defaultValue={industry}>
              <option value="">All industries</option>
              {filters.industries.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Country</span>
            <select name="country" defaultValue={country}>
              <option value="">All countries</option>
              {filters.countries.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Apply
          </button>
          {filtered ? (
            <Link
              className="link-button crm-account-clear"
              href="/crm/accounts"
            >
              Clear
            </Link>
          ) : null}
        </form>

        <div className="crm-account-list-heading">
          <div>
            <p className="eyebrow">Account records</p>
            <h2 id="account-records-title">
              {total} {total === 1 ? "account" : "accounts"}
            </h2>
          </div>
          {total ? (
            <p>
              Showing {(page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, total)}
            </p>
          ) : null}
        </div>

        {rows.length ? (
          <>
            <div className="table-scroll crm-account-table-wrap">
              <table className="data-table crm-account-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Industry</th>
                    <th>Contact</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((account) => (
                    <tr key={String(account.id)}>
                      <td>
                        <Link
                          className="crm-account-name-link"
                          href={`/crm/accounts/${String(account.id)}`}
                        >
                          <strong>{String(account.displayName)}</strong>
                          <span>{String(account.code)}</span>
                        </Link>
                      </td>
                      <td>{String(account.industry || "—")}</td>
                      <td>
                        <span className="crm-account-cell-stack">
                          <span>{String(account.phone || "—")}</span>
                          <small>{String(account.email || "")}</small>
                        </span>
                      </td>
                      <td>{location(account)}</td>
                      <td>
                        <span
                          className={`status-badge ${account.status === "active" ? "success" : "neutral"}`}
                        >
                          {account.status === "active" ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td>
                        {new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                        }).format(new Date(String(account.updatedAt)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="crm-account-cards" aria-label="Account records">
              {rows.map((account) => (
                <Link
                  className="crm-account-card"
                  href={`/crm/accounts/${String(account.id)}`}
                  key={String(account.id)}
                >
                  <div>
                    <strong>{String(account.displayName)}</strong>
                    <span>{String(account.code)}</span>
                  </div>
                  <p>{String(account.industry || "Industry not added")}</p>
                  <dl>
                    <div>
                      <dt>Location</dt>
                      <dd>{location(account)}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        {account.status === "active" ? "Active" : "Archived"}
                      </dd>
                    </div>
                  </dl>
                  <span className="crm-account-card-open" aria-hidden="true">
                    View account →
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state crm-account-empty">
            <strong>
              {filtered ? "No matching accounts" : "No accounts yet"}
            </strong>
            <p>
              {filtered
                ? "Adjust or clear the filters to broaden the results."
                : "Create the first company record for this CRM workspace."}
            </p>
            {canManage && !filtered ? (
              <Link className="primary-button" href="/crm/accounts?create=1">
                Create account
              </Link>
            ) : null}
          </div>
        )}

        {totalPages > 1 ? (
          <nav
            className="crm-account-pagination"
            aria-label="Account pagination"
          >
            {page > 1 ? (
              <Link
                className="secondary-button"
                href={accountHref({ ...query, page: page - 1 })}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                className="secondary-button"
                href={accountHref({ ...query, page: page + 1 })}
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      {creating && canManage ? (
        <AccountFormDrawer closeHref={accountHref(query)} />
      ) : null}
    </div>
  );
}
