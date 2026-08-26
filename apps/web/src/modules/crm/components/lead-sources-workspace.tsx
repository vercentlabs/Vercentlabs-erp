"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import LeadSourceFormDrawer from "@/modules/crm/components/lead-source-form-drawer";
import { requestJson } from "@/shared/http/client-request";

type Source = Record<string, unknown>;
const date = (value: unknown) => {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsed);
};
const channel = (value: unknown) =>
  String(value || "other")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
function href(query: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== "" && !(key === "page" && value === 1))
      p.set(key, String(value));
  const suffix = p.toString();
  return suffix ? `/crm/sources?${suffix}` : "/crm/sources";
}

export default function LeadSourcesWorkspace({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  create,
  editing,
}: {
  rows: Source[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  create: boolean;
  editing: Source | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const query = { search, status };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  async function lifecycle(source: Source, active: boolean) {
    const id = String(source.id);
    const name = String(source.name);
    if (
      !active &&
      !window.confirm(
        `Deactivate “${name}”?\n\nIt will no longer be available for new Lead assignments. ${Number(source.leadCount || 0)} existing Lead${Number(source.leadCount || 0) === 1 ? "" : "s"} will keep this historical source.`,
      )
    )
      return;
    setPending(id);
    setMessage("");
    const result = await requestJson(
      `/api/crm/lead-sources/${id}`,
      active
        ? {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reactivate" }),
          }
        : { method: "DELETE" },
    );
    setMessage(
      result.message ||
        (result.ok
          ? "Lead source updated."
          : "Lead source could not be updated."),
    );
    setPending("");
    if (result.ok) router.refresh();
  }
  return (
    <div className="crm-sources-workspace">
      <header className="crm-sources-heading">
        <div>
          <p className="eyebrow">CRM setup · Lead management</p>
          <h1>Lead sources</h1>
          <p>
            Define where Leads originate. Inactive sources remain on historical
            Leads but cannot be newly assigned.
          </p>
        </div>
        <Link className="primary-button" href={href({ ...query, create: 1 })}>
          Create source
        </Link>
      </header>
      {message ? (
        <div className="notice" role="status">
          {message}
        </div>
      ) : null}
      <section
        className="panel crm-sources-panel"
        aria-labelledby="lead-source-list-heading"
      >
        <form className="crm-source-filters" action="/crm/sources" method="get">
          <label>
            <span>Search sources</span>
            <input
              name="search"
              type="search"
              defaultValue={search}
              placeholder="Name or description"
            />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Apply
          </button>
          {search || status !== "active" ? (
            <Link className="link-button" href="/crm/sources">
              Clear
            </Link>
          ) : null}
        </form>
        <div className="crm-source-list-heading">
          <div>
            <p className="eyebrow">Governed catalogue</p>
            <h2 id="lead-source-list-heading">
              {total} {total === 1 ? "source" : "sources"}
            </h2>
          </div>
          <p>
            Showing {from}–{to}
          </p>
        </div>
        {rows.length ? (
          <>
            <div className="table-scroll crm-source-table-wrap">
              <table className="data-table crm-source-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Description</th>
                    <th>Channel</th>
                    <th>Used by</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((source) => (
                    <tr key={String(source.id)}>
                      <td>
                        <strong>{String(source.name)}</strong>
                        {source.isDefault ? (
                          <small>Default</small>
                        ) : source.isSystem ? (
                          <small>Built in</small>
                        ) : null}
                      </td>
                      <td>{String(source.description || "—")}</td>
                      <td>{channel(source.channel)}</td>
                      <td>{Number(source.leadCount || 0)} Leads</td>
                      <td>
                        <span
                          className={`status-badge ${source.status === "active" ? "success" : "neutral"}`}
                        >
                          {source.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>{date(source.updatedAt)}</td>
                      <td>
                        <div className="crm-source-actions">
                          <Link
                            className="secondary-button"
                            href={href({
                              ...query,
                              page,
                              edit: String(source.id),
                            })}
                          >
                            Edit
                          </Link>
                          {source.status === "active" ? (
                            <button
                              type="button"
                              className="link-button danger"
                              disabled={pending === source.id}
                              onClick={() => void lifecycle(source, false)}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="link-button"
                              disabled={pending === source.id}
                              onClick={() => void lifecycle(source, true)}
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="crm-source-cards" aria-label="Lead sources">
              {rows.map((source) => (
                <article className="crm-source-card" key={String(source.id)}>
                  <header>
                    <div>
                      <strong>{String(source.name)}</strong>
                      <small>
                        {channel(source.channel)}
                        {source.isDefault
                          ? " · Default"
                          : source.isSystem
                            ? " · Built in"
                            : ""}
                      </small>
                    </div>
                    <span
                      className={`status-badge ${source.status === "active" ? "success" : "neutral"}`}
                    >
                      {source.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </header>
                  <p>{String(source.description || "No description")}</p>
                  <dl>
                    <div>
                      <dt>Used by</dt>
                      <dd>{Number(source.leadCount || 0)} Leads</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{date(source.updatedAt)}</dd>
                    </div>
                  </dl>
                  <footer>
                    <Link
                      className="secondary-button"
                      href={href({ ...query, page, edit: String(source.id) })}
                    >
                      Edit
                    </Link>
                    {source.status === "active" ? (
                      <button
                        className="link-button danger"
                        type="button"
                        onClick={() => void lifecycle(source, false)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => void lifecycle(source, true)}
                      >
                        Reactivate
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h3>
              {search || status !== "active"
                ? "No matching sources"
                : "No active sources configured"}
            </h3>
            <p>
              {search || status !== "active"
                ? "Adjust the search or status filter."
                : "Sources describe where Leads originate."}
            </p>
            {!search && status === "active" ? (
              <Link className="primary-button" href="/crm/sources?create=1">
                Create source
              </Link>
            ) : null}
          </div>
        )}
        {pages > 1 ? (
          <nav className="crm-source-pagination" aria-label="Lead source pages">
            {page > 1 ? (
              <Link
                className="secondary-button"
                href={href({ ...query, page: page - 1 })}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link
                className="secondary-button"
                href={href({ ...query, page: page + 1 })}
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
      {create || editing ? (
        <LeadSourceFormDrawer source={editing} closeHref={href(query)} />
      ) : null}
    </div>
  );
}
