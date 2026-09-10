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
import { useCrmCommandDialog } from "@/modules/crm/ui/crm-command-dialog-provider";

import AppIcon from "@/shared/components/app-icon";
import PaginationControls from "@/shared/components/pagination-controls";
import { requestJson } from "@/shared/http/client-request";
import type { CrmField } from "@/modules/crm";
import LeadWorkspaceDrawer from "@/modules/crm/prospect-and-relationship-master-data/lead-workspace-drawer";
import {
  EnterpriseDataGrid,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";
import LeadEditPanel from "./lead-edit-panel";
import {
  KANBAN_PAGE_SIZE,
  dateTime,
  followState,
  initials,
  leadName,
  leadOwnerName,
  money,
  nice,
  num,
  optionName,
  qualificationTone,
  statusTone,
  type BulkJob,
  type LeadFilters,
  type Option,
  type Row,
  type SavedView,
} from "./lead-list-model";

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
  canShareSavedViews = false,
  canShareOrganizationViews = false,
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
  canShareSavedViews?: boolean;
  canShareOrganizationViews?: boolean;
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
  const { confirm: confirmAction } = useCrmCommandDialog();
  const [isRefreshingBoard, startBoardRefresh] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const kanbanRef = useRef<HTMLDivElement>(null);
  const kanbanScrollFrame = useRef<number | null>(null);
  const bulkRetryIdentity = useRef<{ fingerprint: string; key: string } | null>(null);
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
  const [selectionMode, setSelectionMode] = useState<"explicit" | "filter">("explicit");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewVisibility, setSavedViewVisibility] = useState<"private" | "team" | "organization">("private");
  const [savedViewTeamId, setSavedViewTeamId] = useState("");
  const [conflictLeadId, setConflictLeadId] = useState("");
  const [working, setWorking] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [bulkRating, setBulkRating] = useState("");
  const [bulkSourceId, setBulkSourceId] = useState("");
  const [bulkFollowUpAt, setBulkFollowUpAt] = useState("");
  const [bulkJob, setBulkJob] = useState<BulkJob | null>(null);
  const [bulkJobActionPending, setBulkJobActionPending] = useState(false);
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
  useEffect(() => {
    if (!bulkJob?.id || ["completed", "dead", "cancelled"].includes(bulkJob.status)) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const result = await requestJson<{ job?: BulkJob }>(
          `/api/crm/leads/operations?jobId=${encodeURIComponent(bulkJob.id)}`,
        );
        if (!stopped && result.ok && result.job) {
          setBulkJob(result.job);
          if (result.job.status === "completed") {
            const progress = result.job.resultManifest || result.job.progress || {};
            setLocalMessage(
              `Bulk job completed: ${Number(progress.applied || 0)} applied, ${Number(progress.conflict || 0)} conflict, ${Number(progress.skipped || 0)} skipped, ${Number(progress.failed || 0)} failed.`,
            );
            startBoardRefresh(() => router.refresh());
          }
          if (result.job.status === "dead") {
            setLocalMessage(result.job.lastError || "Bulk Lead job failed.");
          }
        }
      } catch {
        // A transient polling failure is non-destructive; the durable job keeps running.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [bulkJob?.id, bulkJob?.status, router]);
  async function cancelBulkJob() {
    if (!bulkJob?.id) return;
    setBulkJobActionPending(true);
    try {
      const result = await requestJson<{ job?: BulkJob }>("/api/crm/leads/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel-bulk-job", jobId: bulkJob.id }),
      });
      if (result.ok && result.job) {
        setBulkJob(result.job);
        setLocalMessage("Bulk job cancelled. Leads already processed keep their changes.");
      } else {
        setLocalMessage(result.message || "The bulk job could not be cancelled.");
      }
    } finally {
      setBulkJobActionPending(false);
    }
  }
  async function retryFailedBulkJobItems() {
    if (!bulkJob?.id) return;
    setBulkJobActionPending(true);
    try {
      const result = await requestJson<{ job?: BulkJob }>("/api/crm/leads/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry-bulk-job", jobId: bulkJob.id }),
      });
      if (result.ok && result.job) {
        setBulkJob(result.job);
        setLocalMessage("Retrying the previously failed rows.");
      } else {
        setLocalMessage(result.message || "The failed rows could not be retried.");
      }
    } finally {
      setBulkJobActionPending(false);
    }
  }
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
    if (selectionMode === "filter") {
      setSelectionMode("explicit");
      setSelected(new Set(rows.map((row) => String(row.id)).filter((rowId) => rowId !== id)));
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selectionMode === "filter") {
      setSelectionMode("explicit");
      setSelected(new Set());
      return;
    }
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
      if (!result.ok) {
        const code = String((result as Record<string, unknown>).code || "");
        if (result.status === 409 && (code === "CRM_STALE_WRITE" || code.includes("VERSION") || code.includes("CONFLICT"))) {
          setConflictLeadId(id);
          setLocalMessage("This Lead changed since the board loaded. Review the latest data before retrying.");
          return;
        }
        throw new Error(result.message || "Lead could not be moved.");
      }
      setConflictLeadId("");
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
    const selectedCount = selectionMode === "filter" ? total : selected.size;
    if (!canManage || !selectedCount) return;
    const changes: Record<string, unknown> = {};
    if (bulkPriority) changes.priority = bulkPriority;
    if (bulkRating) changes.rating = bulkRating;
    if (bulkSourceId) changes.sourceId = bulkSourceId;
    if (bulkFollowUpAt) changes.nextFollowUpAt = new Date(bulkFollowUpAt).toISOString();
    if (!Object.keys(changes).length) {
      setLocalMessage("Choose a bulk change first.");
      return;
    }
    setWorking("bulk");
    setLocalMessage("");
    const expectedVersions = Object.fromEntries(
      rows
        .filter((row) => selected.has(String(row.id)))
        .map((row) => [String(row.id), String(row.updatedAt || "")]),
    );
    try {
      const selection =
        selectionMode === "filter"
          ? {
              type: "filter" as const,
              filters: { search, status, ...filters },
            }
          : null;
      const asyncFingerprint = selection
        ? JSON.stringify({ selection, changes })
        : "";
      let idempotencyKey = "";
      if (selection) {
        if (bulkRetryIdentity.current?.fingerprint === asyncFingerprint) {
          idempotencyKey = bulkRetryIdentity.current.key;
        } else {
          idempotencyKey = `lead-bulk:${crypto.randomUUID()}`;
          bulkRetryIdentity.current = { fingerprint: asyncFingerprint, key: idempotencyKey };
        }
      }
      const result = await requestJson<{
        mode?: "synchronous" | "asynchronous";
        updated?: number;
        applied?: number;
        conflict?: number;
        skipped?: number;
        failed?: number;
        items?: Array<{ id: string; status: string }>;
        job?: BulkJob;
      }>("/api/crm/leads/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk-update",
          ...(selection
            ? { selection, idempotencyKey }
            : { ids: [...selected], expectedVersions }),
          changes,
        }),
      });
      if (!result.ok) throw new Error(result.message || "Bulk update failed.");
      if (result.mode === "asynchronous" && result.job) {
        bulkRetryIdentity.current = null;
        setBulkJob(result.job);
        setLocalMessage(
          `Bulk job queued for ${Number(result.job.progress?.requested || selectedCount)} Leads. You can keep working while it runs.`,
        );
        setSelectionMode("explicit");
        setSelected(new Set());
        return;
      }
      const applied = Number(result.applied ?? result.updated ?? 0);
      const conflict = Number(result.conflict || 0);
      const skipped = Number(result.skipped || 0);
      const failed = Number(result.failed || 0);
      setLocalMessage(
        `Bulk update: ${applied} applied, ${conflict} conflict, ${skipped} skipped, ${failed} failed.`,
      );
      const retryIds = (result.items || [])
        .filter((item) => item.status !== "applied")
        .map((item) => item.id);
      setSelected(new Set(retryIds));
      startBoardRefresh(() => router.refresh());
    } catch (error) {
      setLocalMessage(
        error instanceof Error ? error.message : "Bulk update failed.",
      );
    } finally {
      setWorking("");
    }
  }
  async function saveView() {
    const name = savedViewName.trim();
    if (!name) {
      setLocalMessage("Enter a saved-view name.");
      return;
    }
    if (savedViewVisibility !== "private" && search.trim()) {
      setLocalMessage("Shared Lead views cannot contain free-text search because it may contain sensitive data.");
      return;
    }
    if (savedViewVisibility === "team" && !savedViewTeamId) {
      setLocalMessage("Choose a sales team for the shared view.");
      return;
    }
    setWorking("save-view");
    const result = await requestJson("/api/crm/leads/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        name,
        visibility: savedViewVisibility,
        teamId: savedViewVisibility === "team" ? savedViewTeamId : undefined,
        filters: { search, status, ...filters },
      }),
    });
    setWorking("");
    if (result.ok) {
      setLocalMessage("Saved view stored.");
      setSaveViewOpen(false);
      setSavedViewName("");
      setSavedViewVisibility("private");
      setSavedViewTeamId("");
      await refreshViews();
    } else setLocalMessage(result.message || "Saved view could not be stored.");
  }
  async function deleteView(saved: SavedView) {
    if (!(await confirmAction({ title: `Delete saved view “${saved.name}”?`, description: "This removes the saved view configuration, not the CRM records it displays.", confirmLabel: "Delete" }))) return;
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
                onClick={() => setSaveViewOpen((value) => !value)}
              >
                Save view
              </button>
            </div>
          </div>
          {saveViewOpen ? (
            <section className="crm-leads-save-view" aria-label="Save Lead view">
              <label>
                <span>View name</span>
                <input value={savedViewName} onChange={(event) => setSavedViewName(event.currentTarget.value)} maxLength={120} />
              </label>
              {canShareSavedViews ? (
                <label>
                  <span>Visibility</span>
                  <select value={savedViewVisibility} onChange={(event) => {
                    const value = event.currentTarget.value as "private" | "team" | "organization";
                    setSavedViewVisibility(value);
                    if (value !== "team") setSavedViewTeamId("");
                  }}>
                    <option value="private">Private</option>
                    <option value="team">Sales team</option>
                    {canShareOrganizationViews ? <option value="organization">Organization</option> : null}
                  </select>
                </label>
              ) : null}
              {savedViewVisibility === "team" ? (
                <label>
                  <span>Sales team</span>
                  <select value={savedViewTeamId} onChange={(event) => setSavedViewTeamId(event.currentTarget.value)}>
                    <option value="">Choose team</option>
                    {(options.salesTeams || []).filter((team) => team.status !== "inactive").map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {savedViewVisibility !== "private" && search.trim() ? (
                <p className="notice">Clear free-text search before sharing this view.</p>
              ) : null}
              <div className="crm-suite-actions">
                <button type="button" className="primary-button" disabled={working === "save-view"} onClick={() => void saveView()}>
                  {working === "save-view" ? "Saving…" : "Save view"}
                </button>
                <button type="button" className="secondary-button" onClick={() => setSaveViewOpen(false)}>Cancel</button>
              </div>
            </section>
          ) : null}
          {savedViews.length ? (
            <div className="crm-leads-saved-views">
              <span>Saved views</span>
              {savedViews.slice(0, 10).map((saved) => (
                <span className="crm-leads-saved-view" key={saved.id}>
                  <button type="button" onClick={() => applySaved(saved)}>
                    {saved.name}
                    {saved.visibility === "team" ? ` · Team${saved.team_name ? `: ${saved.team_name}` : ""}` : saved.visibility === "organization" ? " · Organization" : " · Private"}
                  </button>
                  {saved.can_delete !== false ? (
                    <button
                      type="button"
                      aria-label={`Delete ${saved.name}`}
                      onClick={() => void deleteView(saved)}
                    >
                      ×
                    </button>
                  ) : null}
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
        {conflictLeadId ? (
          <div className="notice crm-suite-notice" role="alert">
            <strong>Lead changed in another session.</strong>{" "}
            <button type="button" className="link-button" onClick={() => { setConflictLeadId(""); startBoardRefresh(() => router.refresh()); }}>Refresh board</button>
          </div>
        ) : null}
        {message || localMessage ? (
          <p className="notice crm-suite-notice" role="status">
            {localMessage || message}
          </p>
        ) : null}
        {canManage && (selected.size || selectionMode === "filter") ? (
          <section className="crm-leads-bulk-bar">
            <strong>{selectionMode === "filter" ? `${total} matching selected` : `${selected.size} selected`}</strong>
            {selectionMode === "explicit" && selected.size === rows.length && total > rows.length ? (
              <button type="button" className="secondary-button" onClick={() => setSelectionMode("filter")}>
                Select all {total} matching
              </button>
            ) : null}
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
            <label>
              Rating
              <select value={bulkRating} onChange={(event) => setBulkRating(event.currentTarget.value)}>
                <option value="">No rating change</option>
                {[
                  "cold",
                  "warm",
                  "hot",
                ].map((item) => <option key={item} value={item}>{nice(item)}</option>)}
              </select>
            </label>
            <label>
              Source
              <select value={bulkSourceId} onChange={(event) => setBulkSourceId(event.currentTarget.value)}>
                <option value="">No source change</option>
                {(options.sources || []).filter((item) => item.status !== "inactive").map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              Follow-up
              <input type="datetime-local" value={bulkFollowUpAt} onChange={(event) => setBulkFollowUpAt(event.currentTarget.value)} />
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
              onClick={() => { setSelected(new Set()); setSelectionMode("explicit"); }}
            >
              Clear selection
            </button>
          </section>
        ) : null}

        {bulkJob ? (
          <section className="panel crm-leads-bulk-job" aria-live="polite">
            <div className="crm-suite-actions">
              <div>
                <p className="eyebrow">Background bulk job</p>
                <strong>{nice(bulkJob.status)} · {Number(bulkJob.progress?.percent || bulkJob.resultManifest?.percent || 0)}%</strong>
              </div>
              <div className="crm-suite-actions">
                {bulkJob.status === "pending" || bulkJob.status === "processing" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={bulkJobActionPending}
                    onClick={() => void cancelBulkJob()}
                  >
                    {bulkJobActionPending ? "Cancelling…" : "Cancel job"}
                  </button>
                ) : null}
                {(bulkJob.status === "completed" || bulkJob.status === "dead") &&
                Number(bulkJob.progress?.failed || bulkJob.resultManifest?.failed || 0) > 0 ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={bulkJobActionPending}
                    onClick={() => void retryFailedBulkJobItems()}
                  >
                    {bulkJobActionPending ? "Retrying…" : "Retry failed rows"}
                  </button>
                ) : null}
                {["completed", "dead", "cancelled"].includes(bulkJob.status) ? (
                  <button type="button" className="link-button" onClick={() => setBulkJob(null)}>Dismiss</button>
                ) : null}
              </div>
            </div>
            <p>
              {Number(bulkJob.progress?.processed || bulkJob.resultManifest?.processed || 0)} of {Number(bulkJob.progress?.requested || bulkJob.resultManifest?.requested || 0)} processed · {Number(bulkJob.progress?.applied || bulkJob.resultManifest?.applied || 0)} applied · {Number(bulkJob.progress?.conflict || bulkJob.resultManifest?.conflict || 0)} conflicts.
              {bulkJob.status === "cancelled" ? " This job was cancelled; unprocessed Leads were left unchanged." : ""}
            </p>
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
            {(() => {
              const columns: DataGridColumn<Row>[] = [];
              if (canManage) {
                columns.push({
                  id: "select",
                  width: "48px",
                  header: (
                    <input
                      type="checkbox"
                      aria-label="Select visible leads"
                      checked={
                        rows.length > 0 &&
                        (selectionMode === "filter" || selected.size === rows.length)
                      }
                      onChange={toggleAll}
                    />
                  ),
                  cell: (row) => {
                    const id = String(row.id);
                    return (
                      <input
                        type="checkbox"
                        aria-label={`Select ${leadName(row)}`}
                        checked={selected.has(id)}
                        onChange={() => toggle(id)}
                      />
                    );
                  },
                });
              }
              columns.push(
                {
                  id: "lead",
                  header: "Lead",
                  width: "330px",
                  cell: (row) => (
                    <div className="crm-lead-id">
                      <div>
                        <button
                          className="crm-lead-open-link"
                          type="button"
                          onClick={() => onView(String(row.id))}
                        >
                          {leadName(row)}
                        </button>
                        <small>
                          {[row.code, row.companyName].filter(Boolean).join(" · ")}
                        </small>
                        <em>
                          {[row.email, row.mobile].filter(Boolean).join(" · ") ||
                            "No contact channel"}
                        </em>
                        {row.doNotContact ? <b>Do not contact</b> : null}
                      </div>
                    </div>
                  ),
                },
                {
                  id: "owner",
                  header: "Owner / source",
                  width: "170px",
                  cell: (row) => (
                    <div className="crm-lead-stack">
                      <strong>{leadOwnerName(row)}</strong>
                      <small>
                        {optionName(options, "allSources", row.sourceId) || "No source"}
                      </small>
                      <em>
                        {[row.priority, row.rating].filter(Boolean).map(nice).join(" · ")}
                      </em>
                    </div>
                  ),
                },
                {
                  id: "status",
                  header: "Status",
                  width: "115px",
                  cell: (row) => (
                    <div className="crm-lead-stack">
                      <StatusBadge tone={statusTone(row.status)}>
                        {nice(row.status || "new")}
                      </StatusBadge>
                      <StatusBadge tone={qualificationTone(row.qualificationState)}>
                        {nice(row.qualificationState || "not_reviewed")}
                      </StatusBadge>
                    </div>
                  ),
                },
                {
                  id: "score",
                  header: "Score",
                  width: "100px",
                  cell: (row) => (
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
                  ),
                },
                {
                  id: "potential",
                  header: "Potential",
                  width: "175px",
                  cell: (row) => (
                    <div className="crm-lead-stack">
                      <strong>{money(row.estimatedValue, row.currencyCode)}</strong>
                      <small>{nice(row.industry || "Not classified")}</small>
                    </div>
                  ),
                },
                {
                  id: "followup",
                  header: "Follow-up",
                  width: "170px",
                  cell: (row) => {
                    const followup = followState(row.nextFollowUpAt);
                    return (
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
                    );
                  },
                },
                {
                  id: "actions",
                  header: <span className="sr-only">Actions</span>,
                  width: "240px",
                  cell: (row) => {
                    const id = String(row.id);
                    return (
                      <div className="crm-lead-row-buttons">
                        <button className="secondary-button" type="button" onClick={() => onView(id)}>
                          Open
                        </button>
                        {canManage ? (
                          <button className="link-button" type="button" onClick={() => onEdit(row)}>
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
                    );
                  },
                },
              );
              return (
                <EnterpriseDataGrid
                  caption="Leads matching the current search and filters"
                  className="crm-leads-table-scroll"
                  fixedLayout
                  rows={rows}
                  rowKey={(row) => String(row.id)}
                  columns={columns}
                  emptyState={
                    <div className="crm-suite-empty">
                      <strong>No matching leads</strong>
                      <p>Change the search or filters, or create a new lead.</p>
                      {canManage ? (
                        <button className="primary-button" type="button" onClick={onCreate}>
                          Create lead
                        </button>
                      ) : null}
                    </div>
                  }
                  renderMobileCard={(row) => {
                    const id = String(row.id);
                    const followup = followState(row.nextFollowUpAt);
                    const mobileTitleId = `crm-mobile-lead-${id}`;
                    const mobilePhone = String(row.mobile || row.phone || "");
                    const mobileEmail = String(row.email || "");
                    return (
                      <article aria-labelledby={mobileTitleId}>
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
                                {[row.code, row.companyName].filter(Boolean).join(" · ")}
                              </small>
                            </div>
                          </div>
                          <div className="crm-lead-stack">
                            <StatusBadge tone={statusTone(row.status)}>
                              {nice(row.status || "new")}
                            </StatusBadge>
                            <StatusBadge tone={qualificationTone(row.qualificationState)}>
                              {nice(row.qualificationState || "not_reviewed")}
                            </StatusBadge>
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
                          {!mobileEmail && !mobilePhone ? <span>No contact details</span> : null}
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
                            <strong>{money(row.estimatedValue, row.currencyCode)}</strong>
                          </div>
                          <div className={`state-${followup}`}>
                            <small>Follow-up</small>
                            <strong>{dateTime(row.nextFollowUpAt)}</strong>
                          </div>
                        </div>
                        <div className="crm-leads-mobile-meta">
                          <span>
                            {optionName(options, "allSources", row.sourceId) || "No source"}
                          </span>
                          <span>
                            {[row.priority, row.rating].filter(Boolean).map(nice).join(" · ") ||
                              "No priority signals"}
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
                          <button className="secondary-button" type="button" onClick={() => onView(id)}>
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
                  }}
                />
              );
            })()}
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
                                <StatusBadge tone={qualificationTone(row.qualificationState)}>
                                  {nice(row.qualificationState || "not_reviewed")}
                                </StatusBadge>
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
