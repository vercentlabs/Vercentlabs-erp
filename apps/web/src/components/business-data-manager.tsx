"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";
import DownwardSelect from "@/components/downward-select";
import PaginationControls from "@/components/pagination-controls";

import type {
  BusinessDataDefinition,
  BusinessDataField,
  BusinessDataOptionKey,
} from "@/lib/business-data";

type Option = { id: string; name: string };
type Row = Record<string, unknown>;
const PAGE_SIZE = 10;

function parseCsvRows(source: string): Row[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "");

  const commitCell = () => {
    record.push(cell);
    cell = "";
  };
  const commitRecord = () => {
    commitCell();
    if (record.some((value) => value.trim() !== "")) records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell === "") {
      quoted = true;
    } else if (character === ",") {
      commitCell();
    } else if (character === "\n") {
      commitRecord();
    } else if (character !== "\r") {
      cell += character;
    }
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  if (cell !== "" || record.length) commitRecord();
  if (records.length < 2) {
    throw new Error("The CSV must contain a header and at least one data row.");
  }

  const headers = records[0].map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new Error("Every CSV column must have a header.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV column headers must be unique.");
  }

  return records
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
      ),
    );
}

function parseImportRows(fileName: string, source: string): Row[] {
  if (fileName.toLowerCase().endsWith(".csv")) return parseCsvRows(source);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("The JSON file is not valid.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (!rows) throw new Error("The JSON file must contain an array of rows.");
  if (
    rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error("Every imported row must be a JSON object.");
  }
  return rows as Row[];
}

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
  detailBasePath,
  presentation = "default",
}: {
  definition: BusinessDataDefinition;
  rows: Row[];
  total: number;
  options: Record<string, Option[]>;
  canManage: boolean;
  canImport: boolean;
  detailBasePath?: string;
  presentation?: "default" | "crm";
}) {
  const router = useRouter();
  const crmPresentation = presentation === "crm";
  const importInput = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">(
    "success",
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

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
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

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

      const result = await requestJson<{
        errors?: Record<string, string[] | undefined>;
      }>(endpoint, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!result.ok) {
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
      const result = await requestJson(
        `/api/business-data/${definition.key}/${id}`,
        { method: "DELETE" },
      );

      if (!result.ok) {
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

  async function importRecords(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPending(true);
    setImporting(true);
    setMessage("");

    try {
      if (!/\.(csv|json)$/i.test(file.name)) {
        throw new Error("Choose a CSV or JSON file.");
      }
      if (file.size > 1_000_000) {
        throw new Error("The import file must be smaller than 1 MB.");
      }

      const importedRows = parseImportRows(file.name, await file.text());
      if (!importedRows.length) throw new Error("The import file has no rows.");
      if (importedRows.length > 100) {
        throw new Error("Import up to 100 rows at a time.");
      }

      const result = await requestJson<{
        errors?: Array<{ row: number; message: string }>;
        succeededRows?: number;
        failedRows?: number;
      }>(
        `/api/business-data/${definition.key}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, rows: importedRows }),
        },
        { timeoutMs: 60_000 },
      );

      if (!result.ok) {
        const firstError = result.errors?.[0];
        throw new Error(
          firstError
            ? `Row ${firstError.row}: ${firstError.message}`
            : result.message || "The records could not be imported.",
        );
      }

      announce("success", result.message || "Records imported successfully.");
      router.refresh();
    } catch (error) {
      announce(
        "error",
        error instanceof Error
          ? error.message
          : "The file could not be imported.",
      );
    } finally {
      setImporting(false);
      setPending(false);
    }
  }

  const editorKey = String(editing?.id || "new");
  const hasActions = canManage || Boolean(detailBasePath);

  return (
    <div
      className={
        crmPresentation ? "crm-resource-layout" : "business-data-layout"
      }
    >
      <section
        className={
          crmPresentation
            ? "panel crm-list-panel"
            : "panel business-data-list-panel"
        }
      >
        <div
          className={crmPresentation ? "crm-toolbar" : "business-data-toolbar"}
        >
          <div>
            <p className="eyebrow">
              {crmPresentation ? definition.group : "Records"}
            </p>
            <h2>
              {crmPresentation
                ? `${filteredRows.length} records`
                : filteredRows.length === total
                  ? `${total} configured`
                  : `${filteredRows.length} of ${total}`}
            </h2>
          </div>

          <div
            className={
              crmPresentation
                ? "crm-toolbar-actions"
                : "business-data-toolbar-actions"
            }
          >
            <a
              className="secondary-button"
              href={`/api/business-data/${definition.key}/export`}
            >
              Export CSV
            </a>
            {canImport ? (
              <>
                <input
                  ref={importInput}
                  className="sr-only"
                  type="file"
                  accept={
                    crmPresentation
                      ? ".csv,text/csv"
                      : ".csv,.json,text/csv,application/json"
                  }
                  onChange={(event) => void importRecords(event)}
                />
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => importInput.current?.click()}
                >
                  {importing
                    ? "Importing…"
                    : crmPresentation
                      ? "Import CSV"
                      : "Import"}
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

        <div
          className={
            crmPresentation ? "crm-filter-row" : "business-data-filters"
          }
        >
          <label>
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={`Search ${definition.title.toLowerCase()}`}
            />
          </label>
          <DownwardSelect
            label="Status"
            ariaLabel="Filter by status"
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "locked", label: "Locked" },
            ]}
          />
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

        <div
          className={
            crmPresentation ? "table-scroll" : "business-data-table-wrap"
          }
        >
          <table
            className={crmPresentation ? "data-table" : "business-data-table"}
          >
            <thead>
              <tr>
                {definition.columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
                {hasActions ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
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
                  {hasActions ? (
                    <td>
                      <div
                        className={
                          crmPresentation
                            ? "row-actions"
                            : "business-data-row-actions"
                        }
                      >
                        {detailBasePath ? (
                          <Link
                            className="link-button"
                            href={`${detailBasePath}/${String(row.id)}`}
                          >
                            View
                          </Link>
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
                              disabled={
                                pending ||
                                String(row.status) === "inactive" ||
                                String(row.status) === "locked"
                              }
                              onClick={() => void archive(row)}
                            >
                              Archive
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {crmPresentation && !filteredRows.length ? (
                <tr>
                  <td
                    colSpan={definition.columns.length + (hasActions ? 1 : 0)}
                  >
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

          {!crmPresentation && !filteredRows.length ? (
            <div className="empty-state">
              <strong>No matching records</strong>
              <p>
                Adjust the filters or create the first governed{" "}
                {definition.singular}.
              </p>
            </div>
          ) : null}
        </div>
        <PaginationControls
          page={currentPage}
          pageSize={PAGE_SIZE}
          totalItems={filteredRows.length}
          onPageChange={setPage}
        />
      </section>

      {canManage && editing ? (
        <aside
          className={
            crmPresentation ? "panel crm-editor" : "panel business-data-editor"
          }
          key={editorKey}
          aria-labelledby="business-data-editor-title"
        >
          <div className="card-title-row">
            <div>
              <p className="eyebrow">
                {crmPresentation
                  ? editing.id
                    ? "Edit"
                    : "Create"
                  : editing.id
                    ? "Edit record"
                    : "New record"}
              </p>
              <h2 id="business-data-editor-title">
                {crmPresentation
                  ? definition.singular.replace(/^./, (character) =>
                      character.toUpperCase(),
                    )
                  : editing.id
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

          <form
            className={crmPresentation ? "form-stack" : "business-data-form"}
            onSubmit={submit}
          >
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

            <div
              className={
                crmPresentation ? "form-row" : "business-data-form-actions"
              }
            >
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                {pending ? "Saving…" : crmPresentation ? "Save" : "Save record"}
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
