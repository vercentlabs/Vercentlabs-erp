"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  BusinessDataDefinition,
  BusinessDataField,
  BusinessDataOptionKey,
} from "@/lib/business-data";

type Option = { id: string; name: string };
type Row = Record<string, unknown>;

function normalizedDate(value: unknown) {
  if (!value) return "";
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function optionLabel(
  options: Record<string, Option[]>,
  key: BusinessDataOptionKey | undefined,
  value: unknown,
) {
  if (!key || value === null || value === undefined || value === "") {
    return null;
  }
  return (
    options[key]?.find((option) => option.id === String(value))?.name ||
    String(value)
  );
}

function displayValue(
  value: unknown,
  column: BusinessDataDefinition["columns"][number],
  options: Record<string, Option[]>,
) {
  const option = optionLabel(options, column.optionsKey, value);
  if (option) return option;

  if (column.format === "boolean") {
    return value ? "Yes" : "No";
  }

  if (column.format === "currency") {
    const number = Number(value || 0);
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(number);
  }

  if (column.format === "date") {
    if (!value) return "—";
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
        }).format(date);
  }

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value).replaceAll("_", " ");
}

function fieldDefault(field: BusinessDataField, editing: Row) {
  const value = editing[field.name];

  if (field.type === "date") {
    return normalizedDate(value);
  }

  if (value !== null && value !== undefined) {
    return String(value);
  }

  if (field.name === "status") {
    return field.options?.[0]?.value || "active";
  }

  if (field.type === "select") {
    return field.options?.[0]?.value || "";
  }

  if (field.type === "number") {
    return "0";
  }

  return "";
}

export default function BusinessDataManager({
  definition,
  rows,
  total,
  options,
  canManage,
  canImport,
}: {
  definition: BusinessDataDefinition;
  rows: Row[];
  total: number;
  options: Record<string, Option[]>;
  canManage: boolean;
  canImport: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">(
    "success",
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesStatus =
        status === "all" || String(row.status || "") === status;
      if (!matchesStatus) return false;
      if (!normalizedSearch) return true;

      return definition.columns.some((column) => {
        const value = optionLabel(options, column.optionsKey, row[column.key]);
        return String(value ?? row[column.key] ?? "")
          .toLowerCase()
          .includes(normalizedSearch);
      });
    });
  }, [definition.columns, options, rows, search, status]);

  function announce(kind: "success" | "error", value: string) {
    setMessageKind(kind);
    setMessage(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    setPending(true);
    setMessage("");

    try {
      const form = new FormData(event.currentTarget);
      const body: Record<string, unknown> = {};

      for (const field of definition.fields) {
        if (field.type === "checkbox") {
          body[field.name] = form.get(field.name) === "on";
        } else {
          body[field.name] = String(form.get(field.name) ?? "");
        }
      }

      const id = String(editing.id || "");
      const endpoint = id
        ? `/api/business-data/${definition.key}/${id}`
        : `/api/business-data/${definition.key}`;

      const response = await fetch(endpoint, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        errors?: Record<string, string[] | undefined>;
      };

      if (!response.ok || !result.ok) {
        const firstFieldError = Object.values(result.errors || {})
          .flat()
          .find(Boolean);
        throw new Error(
          firstFieldError || result.message || "The record could not be saved.",
        );
      }

      announce("success", result.message || "Record saved successfully.");
      setEditing(null);
      router.refresh();
    } catch (error) {
      announce(
        "error",
        error instanceof Error
          ? error.message
          : "The record could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function archive(row: Row) {
    const id = String(row.id || "");
    if (!id) return;

    const confirmed = window.confirm(
      `Archive this ${definition.singular}? Existing references will be preserved.`,
    );
    if (!confirmed) return;

    setPending(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/business-data/${definition.key}/${id}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "The record could not be archived.");
      }

      announce("success", result.message || "Record archived successfully.");
      router.refresh();
    } catch (error) {
      announce(
        "error",
        error instanceof Error
          ? error.message
          : "The record could not be archived.",
      );
    } finally {
      setPending(false);
    }
  }

  const editorKey = String(editing?.id || "new");

  return (
    <div className="business-data-layout">
      <section className="panel business-data-list-panel">
        <div className="business-data-toolbar">
          <div>
            <p className="eyebrow">Records</p>
            <h2>
              {filteredRows.length === total
                ? `${total} configured`
                : `${filteredRows.length} of ${total}`}
            </h2>
          </div>

          <div className="business-data-toolbar-actions">
            <a
              className="secondary-button"
              href={`/api/business-data/${definition.key}/export`}
            >
              Export CSV
            </a>
            {canImport ? (
              <span
                className="status-badge neutral"
                title="Governed JSON import API is enabled for this resource."
              >
                Import API ready
              </span>
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

        <div className="business-data-filters">
          <label>
            Search
            <input
              type="search"
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
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="locked">Locked</option>
            </select>
          </label>
        </div>

        {message ? (
          <p
            className={`notice ${
              messageKind === "error" ? "error" : "success"
            }`}
            role="status"
          >
            {message}
          </p>
        ) : null}

        <div className="business-data-table-wrap">
          <table className="business-data-table">
            <thead>
              <tr>
                {definition.columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
                {canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={String(row.id)}>
                  {definition.columns.map((column) => (
                    <td key={column.key}>
                      {column.format === "status" ? (
                        <span
                          className={`status-badge ${
                            String(row[column.key]) === "active" ||
                            String(row[column.key]) === "open"
                              ? "success"
                              : "neutral"
                          }`}
                        >
                          {displayValue(row[column.key], column, options)}
                        </span>
                      ) : (
                        displayValue(row[column.key], column, options)
                      )}
                    </td>
                  ))}
                  {canManage ? (
                    <td>
                      <div className="business-data-row-actions">
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
                          disabled={
                            pending ||
                            String(row.status) === "inactive" ||
                            String(row.status) === "locked"
                          }
                          onClick={() => void archive(row)}
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>

          {!filteredRows.length ? (
            <div className="empty-state">
              <strong>No matching records</strong>
              <p>
                Adjust the filters or create the first governed{" "}
                {definition.singular}.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {canManage && editing ? (
        <aside
          className="panel business-data-editor"
          key={editorKey}
          aria-labelledby="business-data-editor-title"
        >
          <div className="card-title-row">
            <div>
              <p className="eyebrow">
                {editing.id ? "Edit record" : "New record"}
              </p>
              <h2 id="business-data-editor-title">
                {editing.id
                  ? `Update ${definition.singular}`
                  : `Create ${definition.singular}`}
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

          <form className="business-data-form" onSubmit={submit}>
            {definition.fields.map((field) => {
              const defaultValue = fieldDefault(field, editing);
              const dynamicOptions = field.optionsKey
                ? options[field.optionsKey] || []
                : [];

              if (field.type === "checkbox") {
                return (
                  <label className="checkbox-row" key={field.name}>
                    <input
                      name={field.name}
                      type="checkbox"
                      defaultChecked={Boolean(editing[field.name])}
                    />
                    <span>{field.label}</span>
                  </label>
                );
              }

              if (field.type === "select") {
                return (
                  <label key={field.name}>
                    {field.label}
                    <select
                      name={field.name}
                      required={field.required}
                      defaultValue={defaultValue}
                    >
                      {!field.required ? (
                        <option value="">Not specified</option>
                      ) : (
                        <option value="">Select</option>
                      )}
                      {(
                        field.options ||
                        dynamicOptions.map((option) => ({
                          value: option.id,
                          label: option.name,
                        }))
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (field.type === "textarea") {
                return (
                  <label key={field.name}>
                    {field.label}
                    <textarea
                      name={field.name}
                      defaultValue={defaultValue}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  </label>
                );
              }

              return (
                <label key={field.name}>
                  {field.label}
                  <input
                    name={field.name}
                    type={field.type}
                    defaultValue={defaultValue}
                    placeholder={field.placeholder}
                    required={field.required}
                    step={field.step}
                  />
                </label>
              );
            })}

            <div className="business-data-form-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                {pending ? "Saving…" : "Save record"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </aside>
      ) : null}
    </div>
  );
}
