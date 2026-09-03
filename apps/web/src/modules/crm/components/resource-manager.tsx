"use client";

import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DownwardSelect from "@/shared/components/downward-select";
import CrmLeadCreateWorkspace from "@/modules/crm/components/lead-create-workspace";
import CrmLeadDetailWorkspace from "@/modules/crm/components/lead-detail-workspace";
import LeadWorkspaceDrawer from "@/modules/crm/components/lead-workspace-drawer";
import CrmLeadsWorkspace from "@/modules/crm/components/leads-workspace";
import PaginationControls from "@/shared/components/pagination-controls";
import StructuredFieldEditor from "@/shared/components/structured-field-editor";
import type { CrmDefinition, CrmField } from "@/modules/crm";
import { requestJson } from "@/shared/http/client-request";

type Row = Record<string, unknown>;
type Option = {
  id: string;
  name: string;
  status?: string;
  pipelineId?: string;
};
type LeadDetail = {
  lead: Row;
  activities: Row[];
  communications: Row[];
  notes: Row[];
  scoreHistory: Row[];
  opportunities: Row[];
  duplicates: Row[];
  options: Record<string, Option[]>;
  attachments: Row[];
  selectedTags: Row[];
  assignmentHistory: Row[];
  qualification: Row;
  lifecycleHistory: Row[];
};

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
  total,
  page,
  pageSize,
  initialSearch,
  initialStatus,
  options,
  canManage,
  canAssignOwner = false,
  startCreating = false,
  startEditing = null,
  startViewingLead = null,
  canImport,
  canExport,
  leadFilters = {},
  leadBoardRows = [],
  leadBoardTotal = 0,
  preservedQuery = {},
  canManageActivities = false,
  canManageCommunications = false,
}: {
  definition: CrmDefinition;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
  initialStatus: string;
  options: Record<string, Option[]>;
  canManage: boolean;
  canAssignOwner?: boolean;
  startCreating?: boolean;
  startEditing?: Row | null;
  startViewingLead?: LeadDetail | null;
  canImport: boolean;
  canExport: boolean;
  leadFilters?: Record<string, string>;
  leadBoardRows?: Row[];
  leadBoardTotal?: number;
  preservedQuery?: Record<string, string>;
  canManageActivities?: boolean;
  canManageCommunications?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Row | null>(() =>
    canManage
      ? startEditing?.id
        ? startEditing
        : startCreating
          ? {}
          : null
      : null,
  );
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [message, setMessage] = useState("");
  const [leadCreateDirty, setLeadCreateDirty] = useState(false);
  const [leadCreatePending, setLeadCreatePending] = useState(false);
  const leadRouteMode = startCreating
    ? "create"
    : startEditing?.id
      ? `edit:${String(startEditing.id)}`
      : startViewingLead?.lead.id
        ? `view:${String(startViewingLead.lead.id)}`
        : "list";
  const [syncedLeadRouteMode, setSyncedLeadRouteMode] = useState(leadRouteMode);

  if (syncedLeadRouteMode !== leadRouteMode) {
    setSyncedLeadRouteMode(leadRouteMode);
    setEditing(
      canManage && startCreating
        ? {}
        : canManage && startEditing?.id
          ? startEditing
          : null,
    );
  }

  function leadModeUrl(mode?: "create" | "edit" | "view", id?: string) {
    const query = new URLSearchParams(window.location.search);
    query.delete("create");
    query.delete("edit");
    query.delete("view");
    if (mode === "create") query.set("create", "1");
    if ((mode === "edit" || mode === "view") && id) query.set(mode, id);
    const suffix = query.toString();
    return `/crm/leads${suffix ? `?${suffix}` : ""}`;
  }

  function closeLeadMode() {
    router.replace(leadModeUrl(), { scroll: false });
  }

  function closeLeadCreate() {
    if (leadCreatePending) return;
    if (
      leadCreateDirty &&
      !window.confirm(
        "Discard this unsaved lead? Your entered information will be lost.",
      )
    ) {
      return;
    }
    setLeadCreateDirty(false);
    setLeadCreatePending(false);
    closeLeadMode();
  }
  const statusOptions = useMemo(() => {
    const configured =
      definition.fields.find((field) => field.name === "status")?.options || [];
    const options = new Map(
      configured.map((option) => [option.value, option.label]),
    );
    for (const row of rows) {
      const value = String(row.status || "");
      if (value && !options.has(value)) options.set(value, show(value));
    }
    if (initialStatus !== "all" && !options.has(initialStatus))
      options.set(initialStatus, show(initialStatus));
    if (!options.has("archived")) options.set("archived", "Archived");
    return [...options].map(([value, label]) => ({ value, label }));
  }, [definition.fields, initialStatus, rows]);

  function navigate(nextPage: number, nextSearch: string, nextStatus: string) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(preservedQuery)) {
      if (value) query.set(key, value);
    }
    const normalizedSearch = nextSearch.trim();
    if (normalizedSearch) query.set("search", normalizedSearch);
    if (nextStatus !== "all") query.set("status", nextStatus);
    if (nextPage > 1) query.set("page", String(nextPage));
    const suffix = query.toString();
    router.push(`/crm/${definition.key}${suffix ? `?${suffix}` : ""}`);
  }
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
      for (const field of definition.fields) {
        const control = event.currentTarget.elements.namedItem(field.name);
        // Progressive-disclosure editors intentionally omit fields the actor
        // cannot change. Omitting one must preserve its persisted value.
        if (!control) continue;
        body[field.name] =
          field.type === "checkbox"
            ? form.get(field.name) === "on"
            : String(form.get(field.name) ?? "");
      }
      if (definition.key === "leads") {
        const duplicateOverrideControl =
          event.currentTarget.elements.namedItem("duplicateOverrideReason");
        if (duplicateOverrideControl) {
          const reason = String(form.get("duplicateOverrideReason") ?? "").trim();
          if (reason) body.duplicateOverrideReason = reason;
        }
      }
      const id = String(editing.id || "");
      if (definition.key === "leads" && id) {
        const expectedUpdatedAt = String(editing.updatedAt || "").trim();
        if (!expectedUpdatedAt)
          throw new Error("Refresh this Lead before saving changes.");
        body.expectedUpdatedAt = expectedUpdatedAt;
      }
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
      if (definition.key === "leads" && startEditing?.id) {
        router.replace(leadModeUrl());
      } else {
        router.refresh();
      }
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
    const row = rows.find((item) => String(item.id) === id);
    const recordName = String(
      row?.fullName || row?.name || row?.companyName || definition.singular,
    );
    const confirmation =
      definition.key === "leads"
        ? `Archive ${recordName}?\n\nThis removes the lead from active workspaces. Historical information is preserved.`
        : `Archive this ${definition.singular}?`;
    if (!confirm(confirmation)) return;
    setPending(true);
    setMessage("");
    const archivePath =
      definition.key === "leads"
        ? `/api/crm/${definition.key}/${id}?expectedUpdatedAt=${encodeURIComponent(String(row?.updatedAt || ""))}`
        : `/api/crm/${definition.key}/${id}`;
    const result = await requestJson(archivePath, {
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
    setMessage(
      result.message ||
        (result.ok ? "Activity updated." : "Activity update failed."),
    );
    setPending(false);
    if (result.ok) router.refresh();
  }
  async function requestCompletionApproval(id: string) {
    const outcome =
      prompt("Proposed outcome or completion note (optional)") || "";
    setPending(true);
    setMessage("");
    const result = await requestJson("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commandKey: "crm.activity.complete",
        commandPayload: { activityId: id, outcome },
      }),
    });
    setMessage(
      result.message ||
        (result.ok
          ? "Activity completion approval requested."
          : "Approval request failed."),
    );
    setPending(false);
  }
  async function importCsv(file: File) {
    setImportPending(true);
    setMessage(
      `Importing ${file.name}. Keep this page open; the same file cannot be imported twice.`,
    );
    try {
      const result = await requestJson(
        `/api/crm/${definition.key}/import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/csv",
            "X-Import-File-Name": file.name,
          },
          body: await file.text(),
        },
        { timeoutMs: 300_000 },
      );
      setMessage(
        result.message || (result.ok ? "Import completed." : "Import failed."),
      );
      if (result.ok) router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The CSV could not be read.",
      );
    } finally {
      setImportPending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (definition.key === "leads") {
    return (
      <>
        <CrmLeadsWorkspace
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          initialSearch={initialSearch}
          initialStatus={initialStatus}
          options={options}
          canManage={canManage}
          canImport={canImport}
          canExport={canExport}
          pending={pending}
          importPending={importPending}
          message={message}
          editing={editing?.id ? editing : null}
          fields={definition.fields}
          leadFilters={leadFilters}
          boardRows={leadBoardRows}
          boardTotal={leadBoardTotal}
          onNavigate={navigate}
          onCreate={() => {
            setLeadCreateDirty(false);
            setLeadCreatePending(false);
            router.push(leadModeUrl("create"), { scroll: false });
          }}
          onView={(id) =>
            router.push(leadModeUrl("view", id), { scroll: false })
          }
          onEdit={(row) => {
            setEditing(row);
            router.push(leadModeUrl("edit", String(row.id)), { scroll: false });
          }}
          onArchive={(id) => void archive(id)}
          onImport={(file) => void importCsv(file)}
          onCloseEdit={closeLeadMode}
          onSubmitEdit={submit}
        />

        {editing && !editing.id && canManage ? (
          <LeadWorkspaceDrawer
            title="Create lead"
            description="Add the lead without leaving your current queue."
            width="form"
            canDismiss={!leadCreatePending}
            onClose={closeLeadCreate}
          >
            <CrmLeadCreateWorkspace
              options={options}
              canAssignOwner={canAssignOwner}
              embedded
              onCancel={closeLeadCreate}
              onDirtyChange={setLeadCreateDirty}
              onPendingChange={setLeadCreatePending}
              onCreated={(id) => {
                setLeadCreateDirty(false);
                setLeadCreatePending(false);
                setEditing(null);
                router.replace(id ? leadModeUrl("view", id) : leadModeUrl(), {
                  scroll: false,
                });
                router.refresh();
              }}
            />
          </LeadWorkspaceDrawer>
        ) : null}

        {startViewingLead && !editing ? (
          <LeadWorkspaceDrawer
            title={String(
              startViewingLead.lead.fullName ||
                startViewingLead.lead.companyName ||
                "Lead record",
            )}
            description={String(startViewingLead.lead.code || "Lead record")}
            width="wide"
            onClose={closeLeadMode}
          >
            <CrmLeadDetailWorkspace
              {...startViewingLead}
              embedded
              canManage={canManage}
              canAssignOwner={canAssignOwner}
              canManageActivities={canManageActivities}
              canManageCommunications={canManageCommunications}
              onEdit={(lead) => {
                setEditing(lead);
                router.replace(leadModeUrl("edit", String(lead.id)), {
                  scroll: false,
                });
              }}
            />
          </LeadWorkspaceDrawer>
        ) : null}
      </>
    );
  }

  return (
    <div className="crm-resource-layout">
      <section className="panel crm-list-panel">
        <div className="crm-toolbar">
          <div>
            <p className="eyebrow">{definition.group}</p>
            <h2>{total} records</h2>
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
                  disabled={importPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {importPending ? "Importing…" : "Import CSV"}
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
        <form
          className="crm-filter-row"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(1, search, status);
          }}
        >
          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${definition.title.toLowerCase()}`}
            />
          </label>
          <DownwardSelect
            label="Status"
            ariaLabel="Filter by status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              ...statusOptions,
            ]}
          />
          <button className="secondary-button" type="submit">
            Apply filters
          </button>
        </form>
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
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  {definition.columns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        column.format === "datetime"
                          ? "crm-datetime-cell"
                          : undefined
                      }
                    >
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
                      {[
                        "leads",
                        "opportunities",
                        "accounts",
                        "contacts",
                        "privacy-requests",
                      ].includes(definition.key) ? (
                        <Link
                          className="link-button"
                          href={`/crm/${definition.key}/${String(row.id)}`}
                        >
                          Open
                        </Link>
                      ) : null}
                      {canManage &&
                      definition.key === "activities" &&
                      row.status !== "completed" ? (
                        <>
                          <button
                            className="link-button"
                            type="button"
                            disabled={pending}
                            onClick={() => void complete(String(row.id))}
                          >
                            Complete
                          </button>
                          <button
                            className="link-button"
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void requestCompletionApproval(String(row.id))
                            }
                          >
                            Request approval
                          </button>
                        </>
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
              {!rows.length ? (
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
        <PaginationControls
          page={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={(nextPage) =>
            navigate(nextPage, initialSearch, initialStatus)
          }
        />
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
            {definition.fields.filter((field) => !field.formHidden).map((field) => (
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
