"use client";

import Link from "next/link";
import {
  DragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import PaginationControls from "@/shared/components/pagination-controls";
import { requestJson } from "@/shared/http/client-request";
import type { CrmField } from "@/modules/crm";
import LeadWorkspaceDrawer from "@/modules/crm/components/lead-workspace-drawer";

type Row = Record<string, unknown>;
type Option = {
  id: string;
  name: string;
  status?: string;
  pipelineId?: string;
  code?: string;
  sortOrder?: number;
  allowedFromCodes?: string[];
};
type LeadFilters = {
  ownerId?: string;
  sourceId?: string;
  priority?: string;
  rating?: string;
  followup?: string;
  qualification?: string;
};
type SavedView = {
  id: string;
  name: string;
  filters?: Record<string, unknown>;
};

const KANBAN_PAGE_SIZE = 6;

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
function leadOwnerName(row: Row) {
  const name = String(row.ownerName || "").trim();
  if (!name) return "Unassigned";
  return row.ownerStatus === "inactive" ? `${name} (Inactive)` : name;
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
    let choices =
      field.options ||
      (field.optionsKey
        ? options[field.optionsKey]?.map((item) => ({
            value: item.id,
            label: item.name,
          }))
        : []) ||
      [];
    if (field.name === "sourceId" && row.sourceId) {
      const current = options.allSources?.find(
        (item) => item.id === String(row.sourceId),
      );
      if (current && !choices.some((choice) => choice.value === current.id))
        choices = [
          { value: current.id, label: `${current.name} — Inactive` },
          ...choices,
        ];
    }
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
  const [duplicateDraft, setDuplicateDraft] = useState({
    firstName: String(row.firstName || ""),
    lastName: String(row.lastName || ""),
    email: String(row.email || ""),
    mobile: String(row.mobile || ""),
    phone: String(row.phone || ""),
    companyName: String(row.companyName || ""),
  });
  const [duplicateState, setDuplicateState] = useState<{
    classification: "none" | "probable" | "exact";
    matches: Row[];
    canOverride: boolean;
    checking: boolean;
  }>({
    classification: "none",
    matches: [],
    canOverride: false,
    checking: false,
  });
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    const email = duplicateDraft.email.trim();
    const mobile = duplicateDraft.mobile.replace(/\D+/g, "");
    const phone = duplicateDraft.phone.replace(/\D+/g, "");
    const hasUsefulIdentity =
      email.length > 3 ||
      mobile.length >= 7 ||
      phone.length >= 7 ||
      (duplicateDraft.firstName.trim().length > 1 &&
        duplicateDraft.companyName.trim().length > 1);
    if (!hasUsefulIdentity) {
      // The form change handler clears stale duplicate state as identity fields
      // change. Keep this effect limited to debounced external synchronization.
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDuplicateState((current) => ({ ...current, checking: true }));
      const query = new URLSearchParams({
        excludeId: String(row.id || ""),
      });
      for (const [key, value] of Object.entries(duplicateDraft)) {
        if (value.trim()) query.set(key, value.trim());
      }
      const result = await requestJson<{
        classification?: "none" | "probable" | "exact";
        matches?: Row[];
        duplicates?: Row[];
        canOverride?: boolean;
      }>(`/api/crm/leads/duplicates?${query.toString()}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setDuplicateState({
          classification: "none",
          matches: [],
          canOverride: false,
          checking: false,
        });
        return;
      }
      setDuplicateState({
        classification: result.classification || "none",
        matches: result.matches || result.duplicates || [],
        canOverride: Boolean(result.canOverride),
        checking: false,
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [duplicateDraft, row.id]);

  const duplicateBlocked =
    duplicateState.classification === "exact" &&
    (!duplicateState.canOverride || overrideReason.trim().length < 10);

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
      ["companyId", "branchId", "sourceId"],
    ],
    [
      "Qualification",
      [
        "priority",
        "rating",
        "estimatedValue",
        "currencyCode",
        "industry",
        "productInterest",
      ],
    ],
    [
      "Location & next action",
      ["city", "state", "countryCode", "nextFollowUpAt"],
    ],
    [
      "Communication preferences",
      ["consentEmail", "consentSms", "consentWhatsapp", "doNotContact"],
    ],
  ] as const;
  return (
    <div className="crm-suite-editor">
      <header>
        <div>
          <p className="eyebrow">Edit lead</p>
          <h2 id="crm-lead-editor-title">{leadName(row)}</h2>
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
      <form
        onSubmit={onSubmit}
        onChange={(event) => {
          const changedName = event.target.getAttribute("name") || "";
          if (
            ![
              "firstName",
              "lastName",
              "email",
              "mobile",
              "phone",
              "companyName",
            ].includes(changedName)
          )
            return;
          const form = event.currentTarget;
          const data = new FormData(form);
          // Clear the previous decision immediately in the user event, not inside
          // useEffect. This prevents a stale exact match from blocking the edit
          // while the new identity is being debounced/rechecked and satisfies
          // React 19's set-state-in-effect rule without suppressing lint.
          setDuplicateState({
            classification: "none",
            matches: [],
            canOverride: false,
            checking: false,
          });
          setOverrideReason("");
          setDuplicateDraft({
            firstName: String(data.get("firstName") ?? ""),
            lastName: String(data.get("lastName") ?? ""),
            email: String(data.get("email") ?? ""),
            mobile: String(data.get("mobile") ?? ""),
            phone: String(data.get("phone") ?? ""),
            companyName: String(data.get("companyName") ?? ""),
          });
        }}
      >
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
        {duplicateState.checking ? (
          <div className="crm-f008-edit-warning" role="status">
            Checking for matching Leads…
          </div>
        ) : duplicateState.matches.length ? (
          <section
            className={`crm-f008-edit-warning is-${duplicateState.classification}`}
            aria-live="polite"
          >
            <strong>
              {duplicateState.classification === "exact"
                ? "Matching Lead found"
                : "Possible duplicate"}
            </strong>
            <p>
              {duplicateState.matches.some((match) => match.restricted)
                ? "At least one matching Lead is outside your current record access. Its private details are not shown."
                : `Matched on ${[
                    ...new Set(
                      duplicateState.matches.flatMap((match) =>
                        Array.isArray(match.signals)
                          ? match.signals.map(String)
                          : [],
                      ),
                    ),
                  ]
                    .map((signal) => signal.replaceAll("_", " "))
                    .join(", ") || "identity information"}.`}
            </p>
            {duplicateState.classification === "exact" &&
            duplicateState.canOverride ? (
              <label>
                <span>Duplicate override reason *</span>
                <textarea
                  name="duplicateOverrideReason"
                  value={overrideReason}
                  minLength={10}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) =>
                    setOverrideReason(event.currentTarget.value)
                  }
                  placeholder="Explain why this Lead must remain separate."
                />
                <small>
                  Required for an authorized exact-duplicate update and stored
                  as immutable evidence.
                </small>
              </label>
            ) : null}
          </section>
        ) : null}
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={pending || duplicateBlocked}
            title={
              duplicateBlocked
                ? "Resolve the exact duplicate before saving."
                : undefined
            }
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export default function CrmLeadsWorkspace({
  rows,
  boardRows,
  boardTotal,
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
  leadFilters = {},
  onCreate,
  onView,
  onEdit,
  onArchive,
  onImport,
  onCloseEdit,
  onSubmitEdit,
}: {
  rows: Row[];
  boardRows: Row[];
  boardTotal: number;
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
  leadFilters?: LeadFilters;
  onNavigate: (page: number, search: string, status: string) => void;
  onCreate: () => void;
  onView: (id: string) => void;
  onEdit: (row: Row) => void;
  onArchive: (id: string) => void;
  onImport: (file: File) => void;
  onCloseEdit: () => void;
  onSubmitEdit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
  const router = useRouter();
  const [isRefreshingBoard, startBoardRefresh] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const kanbanRef = useRef<HTMLDivElement>(null);
  const kanbanScrollFrame = useRef<number | null>(null);
  const [preferredView, setPreferredView] = useState<"table" | "kanban">(
    "table",
  );
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [filters, setFilters] = useState({
    ownerId: leadFilters.ownerId || "",
    sourceId: leadFilters.sourceId || "",
    priority: leadFilters.priority || "all",
    rating: leadFilters.rating || "all",
    followup: leadFilters.followup || "all",
    qualification: leadFilters.qualification || "all",
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [working, setWorking] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [kanbanPages, setKanbanPages] = useState<Record<string, number>>({});
  const [kanbanStageIndex, setKanbanStageIndex] = useState(0);
  const [dropStage, setDropStage] = useState("");
  const terminalStatus = status === "converted" || status === "archived";
  const view = terminalStatus ? "table" : preferredView;
  const lifecycleStages = useMemo(
    () =>
      (options.leadStages || [])
        .filter((stage) => stage.code)
        .sort(
          (left, right) =>
            Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
        ),
    [options.leadStages],
  );
  const lifecycle = useMemo(
    () => lifecycleStages.map((stage) => String(stage.code)),
    [lifecycleStages],
  );
  const allStatuses = useMemo(
    () => ["all", ...lifecycle, "converted", "archived"],
    [lifecycle],
  );
  const stageLabel = (code: string) =>
    lifecycleStages.find((stage) => stage.code === code)?.name || nice(code);
  const stageIsActive = (code: string) =>
    lifecycleStages.find((stage) => stage.code === code)?.status === "active";
  const moveTargets = (fromCode: string) =>
    lifecycleStages.filter(
      (stage) =>
        stage.code === fromCode ||
        (stage.status === "active" &&
          (stage.allowedFromCodes || []).includes(fromCode)),
    );

  useEffect(() => {
    const saved = window.localStorage.getItem("vercentlabs_crm_leads_view");
    const restoreTimer = window.setTimeout(() => {
      if (saved === "table" || (saved === "kanban" && !terminalStatus)) {
        setPreferredView(saved);
      }
    }, 0);
    void refreshViews();
    return () => window.clearTimeout(restoreTimer);
  }, [terminalStatus]);
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
    if (terminalStatus && next === "kanban") return;
    setPreferredView(next);
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
    if (nextFilters.qualification !== "all")
      query.set("qualification", nextFilters.qualification);
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
    if (!canManage || working || isRefreshingBoard) return;
    const lead = boardRows.find((row) => String(row.id) === id);
    const expectedUpdatedAt = String(lead?.updatedAt || "").trim();
    if (!expectedUpdatedAt) {
      setLocalMessage("Refresh the board before moving this Lead.");
      return;
    }
    setWorking(id);
    setLocalMessage("");
    try {
      const result = await requestJson(`/api/crm/leads/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageCode: nextStatus,
          source: "kanban",
          expectedUpdatedAt,
        }),
      });
      if (!result.ok)
        throw new Error(result.message || "Lead could not be moved.");
      setLocalMessage(result.message || "Lead updated.");
      startBoardRefresh(() => router.refresh());
    } catch (error) {
      setLocalMessage(
        error instanceof Error ? error.message : "Lead could not be moved.",
      );
    } finally {
      setWorking("");
    }
  }
  function dragStart(event: DragEvent, id: string, stage: string) {
    event.dataTransfer.setData("text/vercent-lead-id", id);
    event.dataTransfer.setData("text/vercent-lead-stage", stage);
    event.dataTransfer.effectAllowed = "move";
  }
  function cardDragStart(event: DragEvent, id: string, stage: string) {
    const target = event.target as HTMLElement;
    if (target.closest("button, select, input, textarea, a")) {
      event.preventDefault();
      return;
    }
    dragStart(event, id, stage);
  }
  function drop(event: DragEvent, nextStatus: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/vercent-lead-id");
    const sourceStage = event.dataTransfer.getData("text/vercent-lead-stage");
    setDropStage("");
    if (id && sourceStage !== nextStatus) void moveLead(id, nextStatus);
  }
  async function bulkApply() {
    if (!canManage || !selected.size) return;
    const changes: Record<string, unknown> = {};
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
      qualification: String(value.qualification || "all"),
    };
    const nextSearch = String(value.search || "");
    const nextStatus = String(value.status || "all");
    setSearch(nextSearch);
    setStatus(nextStatus);
    resetKanbanStage();
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
    [boardRows, kanbanPages, lifecycle],
  );
  const displayedGroups = useMemo(
    () =>
      lifecycle.some((stage) => stage === status)
        ? groups.filter((group) => group.stage === status)
        : groups,
    [groups, lifecycle, status],
  );
  const boardIsEmpty = displayedGroups.every((group) => !group.rows.length);

  function syncKanbanStage() {
    if (kanbanScrollFrame.current !== null) return;
    kanbanScrollFrame.current = window.requestAnimationFrame(() => {
      kanbanScrollFrame.current = null;
      const board = kanbanRef.current;
      if (!board) return;
      const columns = Array.from(
        board.querySelectorAll<HTMLElement>(".crm-leads-kanban-column"),
      );
      if (!columns.length) return;
      const maxScroll = board.scrollWidth - board.clientWidth;
      if (board.scrollLeft >= maxScroll - 2) {
        setKanbanStageIndex(columns.length - 1);
        return;
      }
      const boardRect = board.getBoundingClientRect();
      const closest = columns.reduce(
        (best, column, index) => {
          const rect = column.getBoundingClientRect();
          const visibleWidth = Math.max(
            0,
            Math.min(rect.right, boardRect.right) -
              Math.max(rect.left, boardRect.left),
          );
          const ratio = visibleWidth / Math.max(rect.width, 1);
          return ratio > best.ratio ? { index, ratio } : best;
        },
        { index: 0, ratio: -1 },
      );
      setKanbanStageIndex(closest.index);
    });
  }

  function scrollKanbanStage(nextIndex: number) {
    const board = kanbanRef.current;
    if (!board) return;
    const columns = Array.from(
      board.querySelectorAll<HTMLElement>(".crm-leads-kanban-column"),
    );
    const boundedIndex = Math.min(
      Math.max(nextIndex, 0),
      Math.max(columns.length - 1, 0),
    );
    const column = columns[boundedIndex];
    if (!column) return;
    const left =
      column.getBoundingClientRect().left -
      board.getBoundingClientRect().left +
      board.scrollLeft;
    board.scrollTo({
      left,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    setKanbanStageIndex(boundedIndex);
  }

  function resetKanbanStage() {
    setKanbanStageIndex(0);
    kanbanRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }

  function handleKanbanKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const destinations: Record<string, number> = {
      ArrowLeft: kanbanStageIndex - 1,
      ArrowRight: kanbanStageIndex + 1,
      Home: 0,
      End: displayedGroups.length - 1,
    };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    scrollKanbanStage(destinations[event.key]);
  }
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
    filters.qualification !== "all" ? filters.qualification : "",
  ].filter(Boolean).length;

  return (
    <div className="crm-leads-enterprise">
      <main className="crm-leads-enterprise-main">
        <header className="crm-suite-command">
          <div>
            <p className="eyebrow">CRM · Lead command centre</p>
            <h1>Leads</h1>
          </div>
          <div className="crm-suite-command-actions">
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
              <label className="sr-only" htmlFor="crm-lead-search">
                Search leads
              </label>
              <input
                id="crm-lead-search"
                type="search"
                enterKeyHint="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search lead, company, email, phone, code or product interest"
              />
              <button className="secondary-button" type="submit">
                Search
              </button>
            </form>
            <div
              className="crm-leads-view-switch"
              role="group"
              aria-label="Lead presentation"
            >
              <button
                className={view === "table" ? "active" : ""}
                type="button"
                aria-pressed={view === "table"}
                onClick={() => setPresentation("table")}
              >
                Table
              </button>
              <button
                className={view === "kanban" ? "active" : ""}
                type="button"
                aria-pressed={view === "kanban"}
                disabled={terminalStatus}
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
          <button
            className="secondary-button crm-leads-filter-toggle"
            type="button"
            aria-expanded={filtersExpanded}
            aria-controls="crm-leads-advanced-filters"
            onClick={() => setFiltersExpanded((current) => !current)}
          >
            {filtersExpanded ? "Hide filters" : "More filters"}
            {activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <div
            id="crm-leads-advanced-filters"
            className={`crm-leads-filter-grid${filtersExpanded ? " is-expanded" : ""}`}
          >
            <label>
              Owner
              <select
                value={filters.ownerId}
                onChange={(event) =>
                  setFilters({ ...filters, ownerId: event.currentTarget.value })
                }
              >
                <option value="">All owners</option>
                <option value="me">My leads</option>
                <option value="unassigned">Unassigned</option>
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
            <label>
              Qualification
              <select
                value={filters.qualification}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    qualification: event.currentTarget.value,
                  })
                }
              >
                <option value="all">All decisions</option>
                <option value="not_reviewed">Not reviewed</option>
                <option value="qualified">Qualified</option>
                <option value="unqualified">Unqualified</option>
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
                    qualification: "all",
                  };
                  setSearch("");
                  setStatus("all");
                  resetKanbanStage();
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
                  resetKanbanStage();
                  navigate(1, item);
                }}
              >
                {item === "all"
                  ? "All leads"
                  : item === "converted" || item === "archived"
                    ? nice(item)
                    : stageLabel(item)}
              </button>
            ))}
          </nav>
        </section>
        {message || localMessage ? (
          <p className="notice crm-suite-notice" role="status">
            {localMessage || message}
          </p>
        ) : null}
        {canManage && selected.size ? (
          <section className="crm-leads-bulk-bar">
            <strong>{selected.size} selected</strong>
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
                <caption className="sr-only">
                  Leads matching the current search and filters
                </caption>
                <colgroup>
                  {canManage ? <col className="crm-leads-col-select" /> : null}
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
                    {canManage ? (
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
                    ) : null}
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
                        {canManage ? (
                          <td className="select">
                            <input
                              type="checkbox"
                              aria-label={`Select ${leadName(row)}`}
                              checked={selected.has(id)}
                              onChange={() => toggle(id)}
                            />
                          </td>
                        ) : null}
                        <td>
                          <div className="crm-lead-id">
                            <div>
                              <button
                                className="crm-lead-open-link"
                                type="button"
                                onClick={() => onView(id)}
                              >
                                {leadName(row)}
                              </button>
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
                            <strong>{leadOwnerName(row)}</strong>
                            <small>
                              {optionName(
                                options,
                                "allSources",
                                row.sourceId,
                              ) || "No source"}
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
                          <div className="crm-lead-stack">
                            <span
                              className={`crm-lead-status status-${String(row.status || "new")}`}
                            >
                              {nice(row.status || "new")}
                            </span>
                            <span
                              className={`crm-qualification-state state-${String(row.qualificationState || "not_reviewed")}`}
                            >
                              {nice(row.qualificationState || "not_reviewed")}
                            </span>
                          </div>
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
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => onView(id)}
                            >
                              Open
                            </button>
                            {canManage ? (
                              <button
                                className="link-button"
                                type="button"
                                onClick={() => onEdit(row)}
                              >
                                Edit
                              </button>
                            ) : null}
                            {canManage && String(row.recordStatus || "active") === "active" ? (
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
                const mobileTitleId = `crm-mobile-lead-${id}`;
                const mobilePhone = String(row.mobile || row.phone || "");
                const mobileEmail = String(row.email || "");
                return (
                  <article key={id} aria-labelledby={mobileTitleId}>
                    <header>
                      <div className="crm-lead-id">
                        <div>
                          <button
                            id={mobileTitleId}
                            className="crm-lead-open-link"
                            type="button"
                            onClick={() => onView(id)}
                          >
                            {leadName(row)}
                          </button>
                          <small>
                            {[row.code, row.companyName]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                      </div>
                      <div className="crm-lead-stack">
                        <span
                          className={`crm-lead-status status-${String(row.status || "new")}`}
                        >
                          {nice(row.status || "new")}
                        </span>
                        <span
                          className={`crm-qualification-state state-${String(row.qualificationState || "not_reviewed")}`}
                        >
                          {nice(row.qualificationState || "not_reviewed")}
                        </span>
                      </div>
                    </header>
                    <div className="crm-leads-mobile-contact">
                      {mobileEmail ? (
                        <a href={`mailto:${mobileEmail}`}>
                          <AppIcon name="email" size={15} />
                          <span>{mobileEmail}</span>
                        </a>
                      ) : null}
                      {mobilePhone ? (
                        <a href={`tel:${mobilePhone}`}>
                          <AppIcon name="phone" size={15} />
                          <span>{mobilePhone}</span>
                        </a>
                      ) : null}
                      {!mobileEmail && !mobilePhone ? (
                        <span>No contact details</span>
                      ) : null}
                    </div>
                    <div className="crm-leads-mobile-facts">
                      <div>
                        <small>Owner</small>
                        <strong>{leadOwnerName(row)}</strong>
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
                        {optionName(options, "allSources", row.sourceId) ||
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
                    <footer className={canManage ? "" : "is-read-only"}>
                      {canManage ? (
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Select ${leadName(row)}`}
                            checked={selected.has(id)}
                            onChange={() => toggle(id)}
                          />
                          <span>Select</span>
                        </label>
                      ) : null}
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => onView(id)}
                      >
                        Open
                      </button>
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
            {boardTotal > boardRows.length ? (
              <div className="crm-leads-kanban-limit" role="status">
                <span>
                  This board shows the first {boardRows.length} of {boardTotal}{" "}
                  matching leads.
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setPresentation("table")}
                >
                  View the complete table
                </button>
              </div>
            ) : null}
            {displayedGroups.length > 1 &&
            displayedGroups.some((group) => group.rows.length) ? (
              <nav
                className="crm-leads-kanban-navigation"
                aria-label="Kanban stage navigation"
              >
                <button
                  type="button"
                  className="secondary-button"
                  disabled={kanbanStageIndex <= 0}
                  onClick={() => scrollKanbanStage(kanbanStageIndex - 1)}
                >
                  Previous stage
                </button>
                <span aria-live="polite">
                  <strong>
                    {nice(
                      displayedGroups[
                        Math.min(kanbanStageIndex, displayedGroups.length - 1)
                      ]?.stage,
                    )}
                  </strong>
                  <small>
                    {Math.min(kanbanStageIndex + 1, displayedGroups.length)} of{" "}
                    {displayedGroups.length}
                  </small>
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={kanbanStageIndex >= displayedGroups.length - 1}
                  onClick={() => scrollKanbanStage(kanbanStageIndex + 1)}
                >
                  Next stage
                </button>
              </nav>
            ) : null}
            <div
              ref={kanbanRef}
              className={`crm-leads-kanban${displayedGroups.length === 1 ? " is-single-stage" : ""}${boardIsEmpty ? " is-empty" : ""}`}
              role="region"
              aria-label="Lead lifecycle Kanban board"
              tabIndex={0}
              onScroll={syncKanbanStage}
              onKeyDown={handleKanbanKeyDown}
            >
              {boardIsEmpty ? (
                <div className="crm-leads-kanban-empty-board">
                  <strong>No leads match this board</strong>
                  <span>
                    Adjust the search or filters to show lifecycle cards.
                  </span>
                </div>
              ) : null}
              {displayedGroups.some((group) => group.rows.length)
                ? displayedGroups.map(
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
                        className={`crm-leads-kanban-column stage-${stage}${dropStage === stage ? " is-drop-target" : ""}`}
                        aria-labelledby={`crm-kanban-${stage}-title`}
                        onDragEnter={(event) => {
                          const sourceStage = event.dataTransfer.getData(
                            "text/vercent-lead-stage",
                          );
                          if (canManage && stageIsActive(stage) && sourceStage !== stage) {
                            event.preventDefault();
                            setDropStage(stage);
                          }
                        }}
                        onDragOver={(event) => {
                          const sourceStage = event.dataTransfer.getData(
                            "text/vercent-lead-stage",
                          );
                          if (canManage && stageIsActive(stage) && sourceStage !== stage) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node | null,
                            )
                          ) {
                            setDropStage("");
                          }
                        }}
                        onDrop={(event) => {
                          if (stageIsActive(stage)) drop(event, stage);
                        }}
                      >
                        <header>
                          <div>
                            <h2 id={`crm-kanban-${stage}-title`}>
                              {stageLabel(stage)}
                            </h2>
                            <small>
                              {stageRows.length} lead
                              {stageRows.length === 1 ? "" : "s"}
                            </small>
                          </div>
                          {pageCount > 1 ? (
                            <div
                              className="crm-lead-kanban-header-pagination"
                              aria-label={`${stageLabel(stage)} quick pagination`}
                            >
                              <button
                                type="button"
                                aria-label={`Previous ${stageLabel(stage)} page`}
                                disabled={currentPage <= 1}
                                onClick={() =>
                                  changeKanbanPage(stage, currentPage - 1)
                                }
                              >
                                &lsaquo;
                              </button>
                              <span>
                                {currentPage}/{pageCount}
                              </span>
                              <button
                                type="button"
                                aria-label={`Next ${stageLabel(stage)} page`}
                                disabled={currentPage >= pageCount}
                                onClick={() =>
                                  changeKanbanPage(stage, currentPage + 1)
                                }
                              >
                                &rsaquo;
                              </button>
                            </div>
                          ) : (
                            <span>{stageRows.length}</span>
                          )}
                        </header>
                        <div className="crm-leads-kanban-cards">
                          {visibleRows.map((row) => {
                            const id = String(row.id);
                            const name = leadName(row);
                            const followUpState = followState(
                              row.nextFollowUpAt,
                            );
                            const followUpLabel =
                              followUpState === "overdue"
                                ? "Overdue"
                                : followUpState === "today"
                                  ? "Due today"
                                  : followUpState === "scheduled"
                                    ? "Upcoming"
                                    : "Follow-up";
                            return (
                              <article
                                key={id}
                                draggable={
                                  canManage && !working && !isRefreshingBoard
                                }
                                aria-labelledby={`crm-kanban-lead-${id}`}
                                aria-busy={working === id || isRefreshingBoard}
                                onDragStart={(event) =>
                                  cardDragStart(
                                    event,
                                    id,
                                    String(row.status || "new"),
                                  )
                                }
                                onDragEnd={() => {
                                  setDropStage("");
                                }}
                              >
                                <div className="crm-lead-kanban-top">
                                  <span
                                    className="crm-lead-avatar-small"
                                    aria-hidden="true"
                                  >
                                    {initials(row)}
                                  </span>
                                  <div>
                                    <button
                                      id={`crm-kanban-lead-${id}`}
                                      className="crm-lead-open-link"
                                      type="button"
                                      aria-label={`Open ${name}`}
                                      onClick={() => onView(id)}
                                    >
                                      <span>{name}</span>
                                      <small aria-hidden="true">
                                        {String(
                                          row.companyName || row.code || "",
                                        )}
                                      </small>
                                    </button>
                                  </div>
                                  <div className="crm-lead-kanban-signals">
                                    <span>
                                      <small>Score</small>
                                      <b>{Math.round(num(row.score))}</b>
                                    </span>
                                  </div>
                                </div>
                                <div className="crm-lead-kanban-meta">
                                  <span>
                                    <small>Potential</small>
                                    <strong>
                                      {money(
                                        row.estimatedValue,
                                        row.currencyCode,
                                      )}
                                    </strong>
                                  </span>
                                  <span>
                                    <small>Rating</small>
                                    <strong>
                                      {nice(row.rating || "Unrated")}
                                    </strong>
                                  </span>
                                </div>
                                <div
                                  className={`crm-lead-kanban-follow state-${followState(row.nextFollowUpAt)}`}
                                >
                                  <strong>{followUpLabel}</strong>
                                  <span>{dateTime(row.nextFollowUpAt)}</span>
                                </div>
                                <div className="crm-lead-kanban-owner">
                                  <strong>Owner</strong>
                                  <span>{leadOwnerName(row)}</span>
                                </div>
                                <span
                                  className={`crm-qualification-state state-${String(row.qualificationState || "not_reviewed")}`}
                                >
                                  {nice(row.qualificationState || "not_reviewed")}
                                </span>
                                {canManage ? (
                                  <label className="crm-lead-kanban-move">
                                    <span>Move lead</span>
                                    <select
                                      aria-label={`Move ${name} to lifecycle stage`}
                                      value={String(row.status || "new")}
                                      disabled={
                                        Boolean(working) || isRefreshingBoard
                                      }
                                      onChange={(event) =>
                                        void moveLead(
                                          id,
                                          event.currentTarget.value,
                                        )
                                      }
                                    >
                                      {moveTargets(String(row.status || "new")).map((item) => (
                                        <option key={item.code} value={item.code}>
                                          {item.name}
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
                                {canManage
                                  ? "Drag an eligible lead here or update its lifecycle status."
                                  : "No leads currently match this lifecycle stage."}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        {pageCount > 1 ? (
                          <footer
                            className="crm-lead-kanban-pagination"
                            aria-label={`${stageLabel(stage)} column pagination`}
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
                  )
                : null}
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
        <LeadWorkspaceDrawer
          title={`Edit ${leadName(editing)}`}
          description={String(editing.code || "Update lead information")}
          width="form"
          onClose={onCloseEdit}
        >
          <LeadEditPanel
            row={editing}
            fields={fields.filter(
              (field) => !field.structuredKind && field.name !== "ownerUserId",
            )}
            options={options}
            pending={pending}
            onClose={onCloseEdit}
            onSubmit={onSubmitEdit}
          />
        </LeadWorkspaceDrawer>
      ) : null}
    </div>
  );
}
