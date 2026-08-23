"use client";

import Link from "next/link";
import {
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import PaginationControls from "@/shared/components/pagination-controls";
import { requestJson } from "@/core/client-request";
import type { CrmField } from "@/modules/crm";

type Row = Record<string, unknown>;
type Option = { id: string; name: string; pipelineId?: string };
type LeadDashboard = { metrics?: Record<string, unknown> };
type LeadFilters = {
  ownerId?: string;
  sourceId?: string;
  priority?: string;
  rating?: string;
  followup?: string;
};
type SavedView = {
  id: string;
  name: string;
  filters?: Record<string, unknown>;
};

const lifecycle = [
  "new",
  "contacted",
  "working",
  "qualified",
  "unqualified",
] as const;
const allStatuses = ["all", ...lifecycle, "converted", "archived"] as const;
const KANBAN_PAGE_SIZE = 10;

function num(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}
function nice(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value)
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
function leadName(row: Row) {
  return String(
    row.fullName ||
      row.companyName ||
      row.email ||
      row.mobile ||
      row.code ||
      "Lead",
  );
}
function initials(row: Row) {
  const parts = leadName(row).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || "L"}${parts[1]?.[0] || ""}`.toUpperCase();
}
function money(value: unknown, currency: unknown) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: String(currency || "INR"),
      maximumFractionDigits: 0,
    }).format(num(value));
  } catch {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
      num(value),
    );
  }
}
function dateTime(value: unknown) {
  if (!value) return "No follow-up";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
function followState(value: unknown) {
  if (!value) return "none";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "none";
  const now = new Date();
  if (date < now) return "overdue";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date >= today && date < tomorrow ? "today" : "scheduled";
}
function optionName(
  options: Record<string, Option[]>,
  key: string,
  value: unknown,
) {
  return value
    ? options[key]?.find((item) => item.id === String(value))?.name ||
        String(value)
    : "";
}
function rawDefault(field: CrmField, row: Row) {
  const value = row[field.name];
  if (field.type === "date" || field.type === "datetime-local") {
    if (!value) return "";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return field.type === "date"
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 16);
  }
  if (value !== undefined && value !== null) return String(value);
  return field.type === "number" ? "0" : field.options?.[0]?.value || "";
}

function EditField({
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
      <label className="crm-suite-check">
        <input
          name={field.name}
          type="checkbox"
          defaultChecked={Boolean(row[field.name])}
        />
        <span>{field.label}</span>
      </label>
    );
  if (field.type === "select") {
    const choices =
      field.options ||
      (field.optionsKey
        ? options[field.optionsKey]?.map((item) => ({
            value: item.id,
            label: item.name,
          }))
        : []) ||
      [];
    return (
      <label>
        <span>
          {field.label}
          {field.required ? <b>*</b> : null}
        </span>
        <select
          name={field.name}
          defaultValue={rawDefault(field, row)}
          required={field.required}
        >
          <option value="">Select</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "textarea")
    return (
      <label className="crm-suite-span">
        <span>
          {field.label}
          {field.required ? <b>*</b> : null}
        </span>
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
      <span>
        {field.label}
        {field.required ? <b>*</b> : null}
      </span>
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

function LeadEditPanel({
  row,
  fields,
  options,
  pending,
  onClose,
  onSubmit,
}: {
  row: Row;
  fields: CrmField[];
  options: Record<string, Option[]>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
  const fieldMap = new Map(fields.map((field) => [field.name, field]));
  const groups = [
    [
      "Identity & contact",
      [
        "firstName",
        "lastName",
        "companyName",
        "jobTitle",
        "email",
        "mobile",
        "phone",
        "website",
      ],
    ],
    [
      "Ownership & attribution",
      ["companyId", "branchId", "sourceId", "campaignId", "ownerUserId"],
    ],
    [
      "Qualification",
      [
        "status",
        "unqualifiedReason",
        "priority",
        "rating",
        "estimatedValue",
        "currencyCode",
        "industry",
        "productInterest",
      ],
    ],
    ["Location & next action", ["city", "state", "nextFollowUpAt"]],
    [
      "Communication preferences",
      ["consentEmail", "consentSms", "consentWhatsapp", "doNotContact"],
    ],
  ] as const;
  return (
    <aside className="crm-suite-editor" aria-label="Edit lead">
      <header>
        <div>
          <p className="eyebrow">Edit lead</p>
          <h2>{leadName(row)}</h2>
          <small>{String(row.code || "CRM lead")}</small>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close editor"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form onSubmit={onSubmit}>
        {groups.map(([title, names]) => {
          const groupFields = names
            .map((name) => fieldMap.get(name))
            .filter((field): field is CrmField => Boolean(field));
          return groupFields.length ? (
            <section key={title}>
              <h3>{title}</h3>
              <div className="crm-suite-edit-grid">
                {groupFields.map((field) => (
                  <EditField
                    key={field.name}
                    field={field}
                    row={row}
                    options={options}
                  />
                ))}
              </div>
            </section>
          ) : null;
        })}
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </aside>
  );
}

export default function CrmLeadsWorkspace({
  rows,
  boardRows,
  total,
  page,
  pageSize,
  initialSearch,
  initialStatus,
  options,
  canManage,
  canImport,
  canExport,
  pending,
  importPending,
  message,
  editing,
  fields,
  leadDashboard,
  leadFilters = {},
  onCreate,
  onEdit,
  onArchive,
  onImport,
  onCloseEdit,
  onSubmitEdit,
}: {
  rows: Row[];
  boardRows: Row[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
  initialStatus: string;
  options: Record<string, Option[]>;
  canManage: boolean;
  canImport: boolean;
  canExport: boolean;
  pending: boolean;
  importPending: boolean;
  message: string;
  editing: Row | null;
  fields: CrmField[];
  leadDashboard?: LeadDashboard | null;
  leadFilters?: LeadFilters;
  onNavigate: (page: number, search: string, status: string) => void;
  onCreate: () => void;
  onEdit: (row: Row) => void;
  onArchive: (id: string) => void;
  onImport: (file: File) => void;
  onCloseEdit: () => void;
  onSubmitEdit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [filters, setFilters] = useState({
    ownerId: leadFilters.ownerId || "",
    sourceId: leadFilters.sourceId || "",
    priority: leadFilters.priority || "all",
    rating: leadFilters.rating || "all",
    followup: leadFilters.followup || "all",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [working, setWorking] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [kanbanPages, setKanbanPages] = useState<Record<string, number>>({});
  const metrics = leadDashboard?.metrics || {};

  useEffect(() => {
    const saved = window.localStorage.getItem("vercentlabs_crm_leads_view");
    const restoreTimer = window.setTimeout(() => {
      if (saved === "kanban" || saved === "table") setView(saved);
    }, 0);
    void refreshViews();
    return () => window.clearTimeout(restoreTimer);
  }, []);
  async function refreshViews() {
    try {
      const result = await requestJson<{ views?: SavedView[] }>(
        "/api/crm/leads/views",
      );
      if (result.ok) setSavedViews(result.views || []);
    } catch {
      /* non-blocking */
    }
  }
  function setPresentation(next: "table" | "kanban") {
    setView(next);
    window.localStorage.setItem("vercentlabs_crm_leads_view", next);
  }
  function navigate(
    nextPage = 1,
    nextStatus = status,
    nextFilters = filters,
    nextSearch = search,
  ) {
    const query = new URLSearchParams();
    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (nextStatus !== "all") query.set("status", nextStatus);
    if (nextFilters.ownerId) query.set("ownerId", nextFilters.ownerId);
    if (nextFilters.sourceId) query.set("sourceId", nextFilters.sourceId);
    if (nextFilters.priority !== "all")
      query.set("priority", nextFilters.priority);
    if (nextFilters.rating !== "all") query.set("rating", nextFilters.rating);
    if (nextFilters.followup !== "all")
      query.set("followup", nextFilters.followup);
    if (nextPage > 1) query.set("page", String(nextPage));
    router.push(`/crm/leads${query.size ? `?${query.toString()}` : ""}`);
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(
      selected.size === rows.length
        ? new Set()
        : new Set(rows.map((row) => String(row.id))),
    );
  }

  async function moveLead(id: string, nextStatus: string) {
    if (!canManage || working) return;
    let reason = "";
    if (nextStatus === "unqualified") {
      reason =
        window.prompt("Why is this lead being disqualified?")?.trim() || "";
      if (!reason) return;
    }
    setWorking(id);
    setLocalMessage("");
    try {
      const result = await requestJson(`/api/crm/leads/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, unqualifiedReason: reason }),
      });
      if (!result.ok)
        throw new Error(result.message || "Lead could not be moved.");
      setLocalMessage(result.message || "Lead updated.");
      router.refresh();
    } catch (error) {
      setLocalMessage(
        error instanceof Error ? error.message : "Lead could not be moved.",
      );
    } finally {
      setWorking("");
    }
  }
  function dragStart(event: DragEvent, id: string) {
    event.dataTransfer.setData("text/vercent-lead-id", id);
    event.dataTransfer.effectAllowed = "move";
  }
  function drop(event: DragEvent, nextStatus: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/vercent-lead-id");
    if (id) void moveLead(id, nextStatus);
  }
  async function bulkApply() {
    if (!selected.size) return;
    const changes: Record<string, unknown> = {};
    if (bulkOwner) changes.ownerUserId = bulkOwner;
    if (bulkStatus) {
      changes.status = bulkStatus;
      if (bulkStatus === "unqualified") {
        const reason =
          window
            .prompt("Disqualification reason for the selected leads?")
            ?.trim() || "";
        if (!reason) return;
        changes.unqualifiedReason = reason;
      }
    }
    if (bulkPriority) changes.priority = bulkPriority;
    if (!Object.keys(changes).length) {
      setLocalMessage("Choose a bulk change first.");
      return;
    }
    setWorking("bulk");
    try {
      const result = await requestJson<{ updated?: number }>(
        "/api/crm/leads/operations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "bulk-update",
            ids: [...selected],
            changes,
          }),
        },
      );
      if (!result.ok) throw new Error(result.message || "Bulk update failed.");
      setLocalMessage(
        `${String(result.updated ?? selected.size)} lead(s) updated.`,
      );
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      setLocalMessage(
        error instanceof Error ? error.message : "Bulk update failed.",
      );
    } finally {
      setWorking("");
    }
  }
  async function saveView() {
    const name = window.prompt("Name this Lead view")?.trim();
    if (!name) return;
    const result = await requestJson("/api/crm/leads/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, filters: { search, status, ...filters } }),
    });
    if (result.ok) {
      setLocalMessage("Saved view stored.");
      await refreshViews();
    } else setLocalMessage(result.message || "Saved view could not be stored.");
  }
  async function deleteView(saved: SavedView) {
    if (!confirm(`Delete saved view “${saved.name}”?`)) return;
    const result = await requestJson("/api/crm/leads/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: saved.id }),
    });
    if (result.ok) await refreshViews();
    else setLocalMessage(result.message || "Saved view could not be deleted.");
  }
  function applySaved(saved: SavedView) {
    const value = saved.filters || {};
    const next = {
      ownerId: String(value.ownerId || ""),
      sourceId: String(value.sourceId || ""),
      priority: String(value.priority || "all"),
      rating: String(value.rating || "all"),
      followup: String(value.followup || "all"),
    };
    const nextSearch = String(value.search || "");
    const nextStatus = String(value.status || "all");
    setSearch(nextSearch);
    setStatus(nextStatus);
    setFilters(next);
    navigate(1, nextStatus, next, nextSearch);
  }

  const groups = useMemo(
    () =>
      lifecycle.map((stage) => {
        const stageRows = boardRows.filter(
          (row) => String(row.status || "new") === stage,
        );
        const pageCount = Math.max(
          1,
          Math.ceil(stageRows.length / KANBAN_PAGE_SIZE),
        );
        const currentPage = Math.min(
          Math.max(kanbanPages[stage] || 1, 1),
          pageCount,
        );
        const offset = (currentPage - 1) * KANBAN_PAGE_SIZE;
        const visibleRows = stageRows.slice(offset, offset + KANBAN_PAGE_SIZE);
        return {
          stage,
          rows: stageRows,
          visibleRows,
          currentPage,
          pageCount,
          firstVisible: stageRows.length ? offset + 1 : 0,
          lastVisible: Math.min(stageRows.length, offset + KANBAN_PAGE_SIZE),
        };
      }),
    [boardRows, kanbanPages],
  );
  const kanbanTotal = useMemo(
    () => groups.reduce((sum, group) => sum + group.rows.length, 0),
    [groups],
  );
  function changeKanbanPage(stage: string, nextPage: number) {
    setKanbanPages((current) => ({
      ...current,
      [stage]: Math.max(1, nextPage),
    }));
  }
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  const activeFilters = [
    filters.ownerId,
    filters.sourceId,
    filters.priority !== "all" ? filters.priority : "",
    filters.rating !== "all" ? filters.rating : "",
    filters.followup !== "all" ? filters.followup : "",
  ].filter(Boolean).length;

  return (
    <div className={`crm-leads-enterprise${editing?.id ? " has-editor" : ""}`}>
      <main className="crm-leads-enterprise-main">
        <header className="crm-suite-command">
          <div>
            <p className="eyebrow">CRM · Lead command centre</p>
            <h1>Leads</h1>
            <p>
              Capture, route, qualify, score, nurture and convert enquiries from
              one governed workspace.
            </p>
          </div>
          <div className="crm-suite-command-actions">
            <Link className="secondary-button" href="/crm/lead-acquisition">
              Acquisition
            </Link>
            <Link className="secondary-button" href="/crm/lead-intelligence">
              Intelligence
            </Link>
            {canManage ? (
              <button
                className="primary-button"
                type="button"
                onClick={onCreate}
              >
                Create lead
              </button>
            ) : null}
          </div>
        </header>
        <section className="crm-suite-metrics" aria-label="Lead health">
          {[
            [
              "Open leads",
              metrics.openLeads,
              "Active visible leads",
              "/crm/leads",
            ],
            [
              "Qualified",
              metrics.qualifiedLeads,
              "Ready for progression",
              "/crm/leads?status=qualified",
            ],
            [
              "Overdue actions",
              metrics.overdueActivities,
              "Needs seller attention",
              "/crm/activities",
            ],
            [
              "Due today",
              metrics.dueToday,
              "Customer actions today",
              "/crm/activities",
            ],
          ].map(([label, value, detail, href]) => (
            <Link href={String(href)} key={String(label)}>
              <small>{String(label)}</small>
              <strong>{String(value ?? "—")}</strong>
              <span>{String(detail)}</span>
            </Link>
          ))}
        </section>

        <section className="crm-leads-toolbar-shell">
          <div className="crm-leads-toolbar-top">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                navigate(1);
              }}
              className="crm-suite-search"
            >
              <AppIcon name="search" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search lead, company, email, phone, code or product interest"
              />
              <button className="secondary-button">Search</button>
            </form>
            <div
              className="crm-leads-view-switch"
              aria-label="Lead presentation"
            >
              <button
                className={view === "table" ? "active" : ""}
                type="button"
                onClick={() => setPresentation("table")}
              >
                Table
              </button>
              <button
                className={view === "kanban" ? "active" : ""}
                type="button"
                onClick={() => setPresentation("kanban")}
              >
                Kanban
              </button>
            </div>
            <div className="crm-leads-data-actions">
              {canExport ? (
                <Link className="secondary-button" href="/api/crm/leads/export">
                  Export
                </Link>
              ) : null}
              {canImport ? (
                <>
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) onImport(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={importPending}
                    onClick={() => fileRef.current?.click()}
                  >
                    {importPending ? "Importing…" : "Quick CSV import"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="crm-leads-filter-grid">
            <label>
              Owner
              <select
                value={filters.ownerId}
                onChange={(event) =>
                  setFilters({ ...filters, ownerId: event.currentTarget.value })
                }
              >
                <option value="">All owners</option>
                {options.users?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select
                value={filters.sourceId}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    sourceId: event.currentTarget.value,
                  })
                }
              >
                <option value="">All sources</option>
                {options.sources?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={filters.priority}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    priority: event.currentTarget.value,
                  })
                }
              >
                <option value="all">All priorities</option>
                {["low", "medium", "high", "urgent"].map((item) => (
                  <option key={item} value={item}>
                    {nice(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rating
              <select
                value={filters.rating}
                onChange={(event) =>
                  setFilters({ ...filters, rating: event.currentTarget.value })
                }
              >
                <option value="all">All ratings</option>
                {["cold", "warm", "hot"].map((item) => (
                  <option key={item} value={item}>
                    {nice(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Follow-up
              <select
                value={filters.followup}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    followup: event.currentTarget.value,
                  })
                }
              >
                <option value="all">Any follow-up</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due today</option>
                <option value="upcoming">Upcoming</option>
                <option value="none">No follow-up</option>
              </select>
            </label>
            <div className="crm-leads-filter-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => navigate(1)}
              >
                Apply{activeFilters ? ` (${activeFilters})` : ""}
              </button>
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  const clear = {
                    ownerId: "",
                    sourceId: "",
                    priority: "all",
                    rating: "all",
                    followup: "all",
                  };
                  setSearch("");
                  setStatus("all");
                  setFilters(clear);
                  navigate(1, "all", clear, "");
                }}
              >
                Clear
              </button>
              <button
                className="link-button"
                type="button"
                onClick={() => void saveView()}
              >
                Save view
              </button>
            </div>
          </div>
          {savedViews.length ? (
            <div className="crm-leads-saved-views">
              <span>Saved views</span>
              {savedViews.slice(0, 10).map((saved) => (
                <span className="crm-leads-saved-view" key={saved.id}>
                  <button type="button" onClick={() => applySaved(saved)}>
                    {saved.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${saved.name}`}
                    onClick={() => void deleteView(saved)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <nav
            className="crm-leads-status-tabs"
            aria-label="Lead lifecycle filter"
          >
            {allStatuses.map((item) => (
              <button
                type="button"
                key={item}
                className={status === item ? "active" : ""}
                aria-current={status === item ? "page" : undefined}
                onClick={() => {
                  setStatus(item);
                  navigate(1, item);
                }}
              >
                {item === "all" ? "All leads" : nice(item)}
              </button>
            ))}
          </nav>
        </section>
        {message || localMessage ? (
          <p className="notice crm-suite-notice" role="status">
            {localMessage || message}
          </p>
        ) : null}
        {selected.size ? (
          <section className="crm-leads-bulk-bar">
            <strong>{selected.size} selected</strong>
            <label>
              Owner
              <select
                value={bulkOwner}
                onChange={(event) => setBulkOwner(event.currentTarget.value)}
              >
                <option value="">No owner change</option>
                {options.users?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={bulkStatus}
                onChange={(event) => setBulkStatus(event.currentTarget.value)}
              >
                <option value="">No status change</option>
                {lifecycle.map((item) => (
                  <option key={item} value={item}>
                    {nice(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={bulkPriority}
                onChange={(event) => setBulkPriority(event.currentTarget.value)}
              >
                <option value="">No priority change</option>
                {["low", "medium", "high", "urgent"].map((item) => (
                  <option key={item} value={item}>
                    {nice(item)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={working === "bulk"}
              onClick={() => void bulkApply()}
            >
              {working === "bulk" ? "Applying…" : "Apply"}
            </button>
            <button
              className="link-button"
              type="button"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </section>
        ) : null}

        {view === "table" ? (
          <section className="crm-leads-table-surface">
            <div className="crm-leads-result-heading">
              <div>
                <p className="eyebrow">Lead queue</p>
                <h2>{total} matching leads</h2>
                <small>
                  Showing {start}–{end}
                </small>
              </div>
            </div>
            <div className="crm-leads-table-scroll">
              <table>
                <colgroup>
                  <col className="crm-leads-col-select" />
                  <col className="crm-leads-col-lead" />
                  <col className="crm-leads-col-owner" />
                  <col className="crm-leads-col-status" />
                  <col className="crm-leads-col-score" />
                  <col className="crm-leads-col-potential" />
                  <col className="crm-leads-col-followup" />
                  <col className="crm-leads-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="select">
                      <input
                        type="checkbox"
                        aria-label="Select visible leads"
                        checked={
                          rows.length > 0 && selected.size === rows.length
                        }
                        onChange={toggleAll}
                      />
                    </th>
                    <th>Lead</th>
                    <th>Owner / source</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Potential</th>
                    <th>Follow-up</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const id = String(row.id);
                    const followup = followState(row.nextFollowUpAt);
                    return (
                      <tr key={id}>
                        <td className="select">
                          <input
                            type="checkbox"
                            aria-label={`Select ${leadName(row)}`}
                            checked={selected.has(id)}
                            onChange={() => toggle(id)}
                          />
                        </td>
                        <td>
                          <div className="crm-lead-id">
                            <div>
                              <Link href={`/crm/leads/${id}`}>
                                {leadName(row)}
                              </Link>
                              <small>
                                {[row.code, row.companyName]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                              <em>
                                {[row.email, row.mobile]
                                  .filter(Boolean)
                                  .join(" · ") || "No contact channel"}
                              </em>
                              {row.doNotContact ? <b>Do not contact</b> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="crm-lead-stack">
                            <strong>
                              {optionName(options, "users", row.ownerUserId) ||
                                "Unassigned"}
                            </strong>
                            <small>
                              {optionName(options, "sources", row.sourceId) ||
                                "No source"}
                            </small>
                            <em>
                              {[row.priority, row.rating]
                                .filter(Boolean)
                                .map(nice)
                                .join(" · ")}
                            </em>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`crm-lead-status status-${String(row.status || "new")}`}
                          >
                            {nice(row.status || "new")}
                          </span>
                        </td>
                        <td>
                          <div className="crm-lead-score">
                            <strong>{Math.round(num(row.score))}</strong>
                            <i>
                              <b
                                style={{
                                  width: `${Math.max(0, Math.min(100, num(row.score)))}%`,
                                }}
                              />
                            </i>
                          </div>
                        </td>
                        <td>
                          <div className="crm-lead-stack">
                            <strong>
                              {money(row.estimatedValue, row.currencyCode)}
                            </strong>
                            <small>
                              {nice(row.industry || "Not classified")}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className={`crm-lead-stack state-${followup}`}>
                            <strong>{dateTime(row.nextFollowUpAt)}</strong>
                            <small>
                              {followup === "overdue"
                                ? "Overdue"
                                : followup === "today"
                                  ? "Due today"
                                  : followup === "none"
                                    ? "No next action"
                                    : "Scheduled"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="crm-lead-row-buttons">
                            <Link
                              className="secondary-button"
                              href={`/crm/leads/${id}`}
                            >
                              Open
                            </Link>
                            {canManage ? (
                              <button
                                className="link-button"
                                type="button"
                                onClick={() => onEdit(row)}
                              >
                                Edit
                              </button>
                            ) : null}
                            {canManage && row.status !== "archived" ? (
                              <button
                                className="link-button danger"
                                type="button"
                                onClick={() => onArchive(id)}
                              >
                                Archive
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="crm-leads-mobile-list">
              {rows.map((row) => {
                const id = String(row.id);
                const followup = followState(row.nextFollowUpAt);
                return (
                  <article key={id}>
                    <header>
                      <div className="crm-lead-id">
                        <div>
                          <Link href={`/crm/leads/${id}`}>{leadName(row)}</Link>
                          <small>
                            {[row.code, row.companyName]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                      </div>
                      <span
                        className={`crm-lead-status status-${String(row.status || "new")}`}
                      >
                        {nice(row.status || "new")}
                      </span>
                    </header>
                    <div className="crm-leads-mobile-facts">
                      <div>
                        <small>Owner</small>
                        <strong>
                          {optionName(options, "users", row.ownerUserId) ||
                            "Unassigned"}
                        </strong>
                      </div>
                      <div>
                        <small>Score</small>
                        <strong>{Math.round(num(row.score))}/100</strong>
                      </div>
                      <div>
                        <small>Potential</small>
                        <strong>
                          {money(row.estimatedValue, row.currencyCode)}
                        </strong>
                      </div>
                      <div className={`state-${followup}`}>
                        <small>Follow-up</small>
                        <strong>{dateTime(row.nextFollowUpAt)}</strong>
                      </div>
                    </div>
                    <div className="crm-leads-mobile-meta">
                      <span>
                        {optionName(options, "sources", row.sourceId) ||
                          "No source"}
                      </span>
                      <span>
                        {[row.priority, row.rating]
                          .filter(Boolean)
                          .map(nice)
                          .join(" · ") || "No priority signals"}
                      </span>
                      {row.doNotContact ? <b>Do not contact</b> : null}
                    </div>
                    <footer>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggle(id)}
                        />
                        <span>Select</span>
                      </label>
                      <Link
                        className="secondary-button"
                        href={`/crm/leads/${id}`}
                      >
                        Open
                      </Link>
                      {canManage ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => onEdit(row)}
                        >
                          Edit
                        </button>
                      ) : null}
                    </footer>
                  </article>
                );
              })}
            </div>
            {!rows.length ? (
              <div className="crm-suite-empty">
                <strong>No matching leads</strong>
                <p>Change the search or filters, or create a new lead.</p>
                {canManage ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={onCreate}
                  >
                    Create lead
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="crm-leads-kanban-shell">
            <div className="crm-leads-kanban-help">
              <div>
                <p className="eyebrow">Lifecycle Kanban</p>
                <h2>Move active leads through qualification</h2>
              </div>
              <p>
                {kanbanTotal} active scoped lead{kanbanTotal === 1 ? "" : "s"}{" "}
                are on this board. Each lifecycle column shows{" "}
                {KANBAN_PAGE_SIZE} cards at a time. Drag with a mouse or use
                each card&apos;s Move selector. Conversion stays a governed
                action inside the Lead record.
              </p>
            </div>
            <div
              className="crm-leads-kanban-summary"
              aria-label="Kanban paging summary"
            >
              <span>
                <strong>{kanbanTotal}</strong> active leads
              </span>
              <span>
                <strong>{KANBAN_PAGE_SIZE}</strong> cards per column page
              </span>
              <span>
                Each column paginates independently so large stages remain
                readable.
              </span>
            </div>
            <div className="crm-leads-kanban">
              {groups.map(
                ({
                  stage,
                  rows: stageRows,
                  visibleRows,
                  currentPage,
                  pageCount,
                  firstVisible,
                  lastVisible,
                }) => (
                  <section
                    key={stage}
                    className={`crm-leads-kanban-column stage-${stage}`}
                    onDragOver={(event) => {
                      if (canManage) event.preventDefault();
                    }}
                    onDrop={(event) => drop(event, stage)}
                  >
                    <header>
                      <div>
                        <strong>{nice(stage)}</strong>
                        <small>
                          {stageRows.length} lead
                          {stageRows.length === 1 ? "" : "s"}
                        </small>
                      </div>
                      <span>{stageRows.length}</span>
                    </header>
                    <div className="crm-leads-kanban-cards">
                      {visibleRows.map((row) => {
                        const id = String(row.id);
                        return (
                          <article
                            key={id}
                            draggable={canManage}
                            onDragStart={(event) => dragStart(event, id)}
                            aria-busy={working === id}
                          >
                            <div className="crm-lead-kanban-top">
                              <span className="crm-lead-avatar-small">
                                {initials(row)}
                              </span>
                              <div>
                                <Link href={`/crm/leads/${id}`}>
                                  {leadName(row)}
                                </Link>
                                <small>
                                  {String(row.companyName || row.code || "")}
                                </small>
                              </div>
                              <b>{Math.round(num(row.score))}</b>
                            </div>
                            <div className="crm-lead-kanban-meta">
                              <span>
                                {money(row.estimatedValue, row.currencyCode)}
                              </span>
                              <span>{nice(row.rating || "Unrated")}</span>
                            </div>
                            <div
                              className={`crm-lead-kanban-follow state-${followState(row.nextFollowUpAt)}`}
                            >
                              {dateTime(row.nextFollowUpAt)}
                            </div>
                            <div className="crm-lead-kanban-owner">
                              {optionName(options, "users", row.ownerUserId) ||
                                "Unassigned"}
                            </div>
                            {canManage ? (
                              <label className="crm-lead-kanban-move">
                                <span>Move lead</span>
                                <select
                                  value={String(row.status || "new")}
                                  disabled={working === id}
                                  onChange={(event) =>
                                    void moveLead(id, event.currentTarget.value)
                                  }
                                >
                                  {lifecycle.map((item) => (
                                    <option key={item} value={item}>
                                      {nice(item)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                          </article>
                        );
                      })}
                      {!stageRows.length ? (
                        <div className="crm-lead-kanban-empty">
                          <strong>No leads in this stage</strong>
                          <span>
                            Drag an eligible lead here or update its lifecycle
                            status.
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {stageRows.length ? (
                      <footer
                        className="crm-lead-kanban-pagination"
                        aria-label={`${nice(stage)} column pagination`}
                      >
                        <span>
                          {firstVisible}–{lastVisible} of {stageRows.length}
                        </span>
                        <div>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={currentPage <= 1}
                            onClick={() =>
                              changeKanbanPage(stage, currentPage - 1)
                            }
                          >
                            Previous
                          </button>
                          <strong>
                            Page {currentPage} of {pageCount}
                          </strong>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={currentPage >= pageCount}
                            onClick={() =>
                              changeKanbanPage(stage, currentPage + 1)
                            }
                          >
                            Next
                          </button>
                        </div>
                      </footer>
                    ) : null}
                  </section>
                ),
              )}
            </div>
          </section>
        )}
        {view === "table" ? (
          <div className="crm-leads-pagination">
            <span>
              {start}–{end} of {total}
            </span>
            <PaginationControls
              page={page}
              pageSize={pageSize}
              totalItems={total}
              onPageChange={(next) => navigate(next)}
            />
          </div>
        ) : null}
      </main>
      {editing?.id && canManage ? (
        <LeadEditPanel
          row={editing}
          fields={fields.filter((field) => !field.structuredKind)}
          options={options}
          pending={pending}
          onClose={onCloseEdit}
          onSubmit={onSubmitEdit}
        />
      ) : null}
    </div>
  );
}
