"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";
import PaginationControls from "@/components/pagination-controls";

const PAGE_SIZE = 12;

export type FieldDefinition = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox";
  required?: boolean;
  optionsKey?: "companies" | "branches" | "departments";
  options?: Array<{ value: string; label: string }>;
};

export default function ResourceManager({
  resource,
  fields,
  rows,
  options,
  canManage,
}: {
  resource: string;
  fields: FieldDefinition[];
  rows: Array<Record<string, unknown>>;
  options: Record<string, Array<{ id: string; name: string }>>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(
    resource === "organization" ? rows[0] || {} : null,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const key = useMemo(
    () => String(editing?.id || "new") + JSON.stringify(editing || {}),
    [editing],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === "checkbox")
        body[field.name] = form.get(field.name) === "on";
      else {
        const value = String(form.get(field.name) || "");
        body[field.name] = value === "" && field.optionsKey ? null : value;
      }
    }
    const id = String(editing?.id || "");
    const endpoint = id
      ? `/api/settings/${resource}/${id}`
      : `/api/settings/${resource}`;
    const result = await requestJson(endpoint, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok) {
      if (resource !== "organization") setEditing(null);
      router.refresh();
    }
  }

  function labelFor(keyName: string) {
    return (
      fields.find((field) => field.name === keyName)?.label ||
      keyName.replaceAll(/([A-Z])/g, " $1")
    );
  }

  return (
    <div className="resource-layout">
      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Records</p>
            <h2>
              {resource === "organization"
                ? "Current settings"
                : `${rows.length} configured`}
            </h2>
          </div>
          {canManage && resource !== "organization" ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setEditing({})}
            >
              Add record
            </button>
          ) : null}
        </div>
        <div className="resource-cards">
          {visibleRows.map((row) => (
            <article key={String(row.id)} className="resource-card">
              <div>
                <strong>
                  {String(row.name || row.entityType || row.code || "Record")}
                </strong>
                <span>
                  {String(row.code || row.prefix || row.status || "")}
                </span>
              </div>
              <dl>
                {Object.entries(row)
                  .filter(
                    ([name]) => !["id", "name", "isPrimary"].includes(name),
                  )
                  .slice(0, 6)
                  .map(([name, value]) => (
                    <div key={name}>
                      <dt>{labelFor(name)}</dt>
                      <dd>
                        {typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : String(value ?? "—")}
                      </dd>
                    </div>
                  ))}
              </dl>
              {canManage ? (
                <button
                  className="link-button"
                  type="button"
                  onClick={() => setEditing(row)}
                >
                  Edit
                </button>
              ) : null}
            </article>
          ))}
          {!rows.length ? (
            <div className="empty-state">
              <strong>No records yet</strong>
              <p>
                Create the first record to establish this part of the
                organisation structure.
              </p>
            </div>
          ) : null}
        </div>
        {resource !== "organization" ? (
          <PaginationControls
            page={currentPage}
            pageSize={PAGE_SIZE}
            totalItems={rows.length}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {canManage && editing ? (
        <section className="panel sticky-panel" key={key}>
          <p className="eyebrow">{editing.id ? "Edit record" : "New record"}</p>
          <h2>{editing.id ? "Update details" : "Create record"}</h2>
          <form className="form-stack" onSubmit={submit}>
            {fields.map((field) => {
              const rawValue = editing[field.name];
              const dynamicOptions = field.optionsKey
                ? options[field.optionsKey] || []
                : [];
              if (field.type === "checkbox")
                return (
                  <label className="checkbox-row" key={field.name}>
                    <input
                      name={field.name}
                      type="checkbox"
                      defaultChecked={Boolean(rawValue)}
                    />
                    {field.label}
                  </label>
                );
              if (field.type === "select")
                return (
                  <label key={field.name}>
                    {field.label}
                    <select
                      name={field.name}
                      defaultValue={String(
                        rawValue ?? field.options?.[0]?.value ?? "",
                      )}
                      required={field.required}
                    >
                      <option value="">Select</option>
                      {(
                        field.options ||
                        dynamicOptions.map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              return (
                <label key={field.name}>
                  {field.label}
                  <input
                    name={field.name}
                    type={field.type}
                    defaultValue={String(
                      rawValue ?? field.options?.[0]?.value ?? "",
                    )}
                    required={field.required}
                  />
                </label>
              );
            })}
            <div className="form-row">
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                {pending ? "Saving…" : "Save"}
              </button>
              {resource !== "organization" ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
