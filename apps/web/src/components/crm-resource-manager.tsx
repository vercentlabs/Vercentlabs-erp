"use client";

import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StructuredFieldEditor from "@/components/structured-field-editor";
import type { CrmDefinition, CrmField } from "@/lib/crm";
import { requestJson } from "@/lib/client-request";

type Row = Record<string, unknown>;
type Option = { id: string; name: string; pipelineId?: string };

function dateInput(value: unknown, includeTime = false) {
  if (!value) return "";
  const text = new Date(String(value)).toISOString();
  return includeTime ? text.slice(0, 16) : text.slice(0, 10);
}
function rawDefault(field: CrmField, row: Row) {
  const value = row[field.name];
  if (field.type === "date") return dateInput(value);
  if (field.type === "datetime-local") return dateInput(value, true);
  if (Array.isArray(value) || (value && typeof value === "object"))
    return JSON.stringify(value, null, 2);
  if (value !== undefined && value !== null) return String(value);
  if (field.type === "number") return "0";
  return field.options?.[0]?.value || "";
}
function show(value: unknown, format?: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value))
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return `${count} ${count === 1 ? "value" : "values"} configured`;
  }
  if (format === "currency")
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
      Number(value),
    );
  if (format === "date" || format === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat(
          "en-IN",
          format === "date"
            ? { dateStyle: "medium" }
            : { dateStyle: "medium", timeStyle: "short" },
        ).format(date);
  }
  return String(value).replaceAll("_", " ");
}

export default function CrmResourceManager({
  definition,
  rows,
  options,
  canManage,
  startCreating = false,
  canImport,
  canExport,
}: {
  definition: CrmDefinition;
  rows: Row[];
  options: Record<string, Option[]>;
  canManage: boolean;
  startCreating?: boolean;
  canImport: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Row | null>(() =>
    startCreating && canManage ? {} : null,
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (status === "all" || String(row.status || "") === status) &&
          (!search.trim() ||
            Object.values(row).some((value) =>
              String(value ?? "")
                .toLowerCase()
                .includes(search.toLowerCase()),
            )),
      ),
    [rows, search, status],
  );
  const label = (key: string, value: unknown) => {
    const column = definition.columns.find((item) => item.key === key);
    const option = column?.optionsKey
      ? options[column.optionsKey]?.find((item) => item.id === String(value))
          ?.name
      : null;
    return option || show(value, column?.format);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setPending(true);
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const body: Row = {};
      for (const field of definition.fields)
        body[field.name] =
          field.type === "checkbox"
            ? form.get(field.name) === "on"
            : String(form.get(field.name) ?? "");
      const id = String(editing.id || "");
      const result = await requestJson<{
        errors?: Record<string, string[]>;
      }>(
        id ? `/api/crm/${definition.key}/${id}` : `/api/crm/${definition.key}`,
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!result.ok)
        throw new Error(
          Object.values(result.errors || {}).flat()[0] ||
            result.message ||
            "CRM record could not be saved.",
        );
      setMessage(result.message || "Saved.");
      setEditing(null);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "CRM record could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  async function archive(id: string) {
    if (!confirm(`Archive this ${definition.singular}?`)) return;
    setPending(true);
    setMessage("");
    const result = await requestJson(`/api/crm/${definition.key}/${id}`, {
      method: "DELETE",
    });
    setMessage(result.message || (result.ok ? "Archived." : "Archive failed."));
    setPending(false);
    if (result.ok) router.refresh();
  }
  async function complete(id: string) {
    const outcome = prompt("Outcome or completion note (optional)") || "";
    setPending(true);
    setMessage("");
    const result = await requestJson(`/api/crm/activities/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    setMessage(result.message || (result.ok ? "Activity updated." : "Activity update failed."));
    setPending(false);
    if (result.ok) router.refresh();
  }
  async function importCsv(file: File) {
    setPending(true);
    setMessage("");
    const result = await requestJson(
      `/api/crm/${definition.key}/import`,
      {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      },
      { timeoutMs: 60_000 },
    );
    setMessage(result.message || (result.ok ? "Import completed." : "Import failed."));
    setPending(false);
    if (fileRef.current) fileRef.current.value = "";
    if (result.ok) router.refresh();
  }

  return (
    <div className="crm-resource-layout">
      <section className="panel crm-list-panel">
        <div className="crm-toolbar">
          <div>
            <p className="eyebrow">{definition.group}</p>
            <h2>{filtered.length} records</h2>
          </div>
          <div className="crm-toolbar-actions">
            {canExport ? (
              <a
                className="secondary-button"
                href={`/api/crm/${definition.key}/export`}
              >
                Export CSV
              </a>
            ) : null}
            {canImport ? (
              <>
                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importCsv(file);
                  }}
                />
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                >
                  Import CSV
                </button>
              </>
            ) : null}
            {canManage ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => setEditing({})}
              >
                Add {definition.singular}
              </button>
            ) : null}
          </div>
        </div>
        <div className="crm-filter-row">
          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${definition.title.toLowerCase()}`}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              {[
                "new",
                "contacted",
                "working",
                "qualified",
                "unqualified",
                "converted",
                "open",
                "won",
                "lost",
                "planned",
                "active",
                "paused",
                "completed",
                "cancelled",
                "inactive",
                "archived",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {definition.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={String(row.id)}>
                  {definition.columns.map((column) => (
                    <td key={column.key}>
                      {column.format === "status" ? (
                        <span className="status-badge neutral">
                          {label(column.key, row[column.key])}
                        </span>
                      ) : (
                        label(column.key, row[column.key])
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
                      {definition.key === "leads" ||
                      definition.key === "opportunities" ? (
                        <Link
                          className="link-button"
                          href={`/crm/${definition.key}/${String(row.id)}`}
                        >
                          Open
                        </Link>
                      ) : null}
                      {definition.key === "activities" &&
                      row.status !== "completed" ? (
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => void complete(String(row.id))}
                        >
                          Complete
                        </button>
                      ) : null}
                      {canManage ? (
                        <>
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => setEditing(row)}
                          >
                            Edit
                          </button>
                          <button
                            className="link-button danger"
                            type="button"
                            onClick={() => void archive(String(row.id))}
                          >
                            Archive
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td colSpan={definition.columns.length + 1}>
                    <div className="empty-state">
                      <strong>No matching records</strong>
                      <p>
                        {search || status !== "all"
                          ? "Adjust the filters to find a record."
                          : `Create the first ${definition.singular} to begin this workflow.`}
                      </p>
                      {canManage && !search && status === "all" ? (
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => setEditing({})}
                        >
                          Add {definition.singular}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {editing && canManage ? (
        <section className="panel crm-editor">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">{editing.id ? "Edit" : "Create"}</p>
              <h2>
                {definition.singular.replace(/^./, (c) => c.toUpperCase())}
              </h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close editor"
              onClick={() => setEditing(null)}
            >
              ×
            </button>
          </div>
          <form className="form-stack" onSubmit={submit}>
            {definition.fields.map((field) => (
              <Field
                key={`${String(editing.id || "new")}:${field.name}`}
                field={field}
                row={editing}
                options={options}
              />
            ))}
            <div className="form-row">
              <button className="primary-button" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  field,
  row,
  options,
}: {
  field: CrmField;
  row: Row;
  options: Record<string, Option[]>;
}) {
  if (field.type === "checkbox")
    return (
      <label className="checkbox-row">
        <input
          name={field.name}
          type="checkbox"
          defaultChecked={Boolean(row[field.name])}
        />
        {field.label}
      </label>
    );
  if (field.type === "select")
    return (
      <label>
        {field.label}
        <select
          name={field.name}
          defaultValue={rawDefault(field, row)}
          required={field.required}
        >
          <option value="">Select</option>
          {(
            field.options ||
            (field.optionsKey
              ? options[field.optionsKey]?.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))
              : []) ||
            []
          ).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (field.structuredKind)
    return (
      <StructuredFieldEditor
        field={field}
        initialValue={rawDefault(field, row)}
        options={options}
      />
    );
  if (field.type === "textarea")
    return (
      <label>
        {field.label}
        <textarea
          name={field.name}
          defaultValue={rawDefault(field, row)}
          required={field.required}
          rows={4}
        />
      </label>
    );
  return (
    <label>
      {field.label}
      <input
        name={field.name}
        type={field.type}
        step={field.type === "number" ? "any" : undefined}
        defaultValue={rawDefault(field, row)}
        required={field.required}
      />
    </label>
  );
}
