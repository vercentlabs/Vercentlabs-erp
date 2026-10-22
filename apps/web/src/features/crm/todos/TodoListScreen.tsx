"use client";

// CRM To-dos › All to-dos: tasks and follow-ups in one list, laid out like the Tasks and Follow-ups tabs beside it. Whose to-dos (Mine /
// Everyone) is a switch in the toolbar; when they are due is a row of counted queues (Overdue · Due today · Upcoming · All open). Columns
// read When · What · Type · About · Assigned to; each open row starts with the same round Complete button as a task or follow-up row,
// and the row opens its own task or follow-up. New tasks and follow-ups open their own tab's form.
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, ChevronDown, Plus, SquareCheck } from "lucide-react";
import {
  Badge, Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, Menu, MenuItem, MenuTrigger, NoResultsState, SearchField, Select, buttonVariants,
} from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SavedViews } from "@/features/crm/shared/ui/SavedViews";
import { QueueCards, ScopeSwitch, type QueueCard, type WorkScope } from "@/features/crm/shared/ui/WorkQueues";
import { WorkRowActions } from "@/features/crm/shared/ui/WorkRowActions";
import { RELATED_LABELS } from "@/features/crm/tasks/task-format";
import { displayTimeZone } from "@/shared/format/display-time-zone";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class TodoApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(TodoApiError, "body");

type Scope = Extract<WorkScope, "mine" | "everyone">;
type Queue = "overdue" | "today" | "upcoming" | "open";
type Todo = {
  id: string; kind: "task" | "follow_up"; typeCode: string; typeLabel: string; number: string | null; subject: string; dueAt: string | null; dueTimeSet: boolean;
  priority: string | null; overdue: boolean; dueToday: boolean; assigneeName: string | null; updatedAt: string;
  record: { type: string; id: string; name: string | null; href: string | null } | null; href: string;
};
type TodoPage = {
  total: number; limit: number; offset: number; counts: Record<Queue, number>;
  capabilities: { tasks: boolean; followUps: boolean; createTask: boolean; createFollowUp: boolean }; todos: Todo[];
};

const PAGE_SIZE = 50;
const SCOPES: Scope[] = ["mine", "everyone"];
const QUEUES: Array<Omit<QueueCard<Queue>, "count">> = [
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "today", label: "Due today", tone: "warning" },
  { key: "upcoming", label: "Upcoming", tone: "info" },
  { key: "open", label: "All open", tone: "brand" },
];
const ANY = "any";
const TYPES = [
  { value: ANY, label: "Any type" }, { value: "task", label: "Task" }, { value: "call", label: "Call" }, { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" }, { value: "demo", label: "Demo" }, { value: "visit", label: "Visit" }, { value: "whatsapp", label: "WhatsApp" },
  { value: "other", label: "Other follow-up" },
];

// Links and saved views from before Mine / Everyone and the queues were split (?view=overdue…) still open the same list.
const LEGACY_VIEWS: Record<string, { scope: Scope; queue: Queue }> = {
  mine: { scope: "mine", queue: "open" }, overdue: { scope: "everyone", queue: "overdue" }, today: { scope: "everyone", queue: "today" },
  upcoming: { scope: "everyone", queue: "upcoming" }, all: { scope: "everyone", queue: "open" },
};
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

const listTodos = (params: { scope: Scope; queue: Queue; type: string; search: string; offset: number }) =>
  request<TodoPage>(`/api/crm/todos?${new URLSearchParams({
    scope: params.scope, queue: params.queue, limit: String(PAGE_SIZE), offset: String(params.offset),
    ...(params.type !== ANY ? { type: params.type } : {}), ...(params.search ? { search: params.search } : {}),
  })}`);

export function TodoListScreen({ tabs }: { tabs?: ReactNode }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  // A saved view (or a shared link) opens with its own scope, queue, type and search.
  const params = useSearchParams();
  const legacy = LEGACY_VIEWS[params.get("view") ?? ""];
  const [scope, setScopeState] = useState<Scope>(pick(params.get("scope"), SCOPES, legacy?.scope ?? "mine"));
  const [queue, setQueueState] = useState<Queue>(pick(params.get("queue"), QUEUES.map((entry) => entry.key), legacy?.queue ?? "open"));
  const [type, setTypeState] = useState(params.get("type") ?? ANY);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(params.get("search") ?? "");
  const [pageIndex, setPageIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const setScope = (next: WorkScope) => { setScopeState(next as Scope); setPageIndex(0); };
  const setQueue = (next: Queue) => { setQueueState(next); setPageIndex(0); };
  const setType = (next: string) => { setTypeState(next); setPageIndex(0); };

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "todos", scope, queue, type, submittedSearch, pageIndex),
    queryFn: () => listTodos({ scope, queue, type, search: submittedSearch, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.todos ?? [];
  const total = query.data?.total ?? 0;
  const can = query.data?.capabilities;
  const hasCriteria = Boolean(submittedSearch) || type !== ANY;

  const columns = useMemo<ColumnDef<Todo, unknown>[]>(() => [
    {
      id: "done", header: () => <span className="sr-only">Complete</span>, enableSorting: false, enableHiding: false,
      cell: ({ row }) => <WorkRowActions kind={row.original.kind} id={row.original.id} layout="check" onMessage={setNotice} />,
    },
    { id: "when", header: "When", enableSorting: false, cell: ({ row }) => <TodoDue todo={row.original} /> },
    {
      id: "what", header: "What", enableSorting: false, enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-56 flex-col">
          <span className="flex items-center gap-2 font-medium text-text">
            {row.original.subject}
            {row.original.priority === "high" && <Badge tone="danger">High</Badge>}
          </span>
          {row.original.number && <span className="text-xs text-text-muted">{row.original.number}</span>}
        </span>
      ),
    },
    { id: "type", header: "Type", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.typeLabel}</span> },
    { id: "about", header: "About", enableSorting: false, cell: ({ row }) => <TodoAbout todo={row.original} /> },
    { id: "assignee", header: "Assigned to", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.assigneeName ?? "Unassigned"}</span> },
  ], []);

  // One primary + New: a task or a follow-up, each opening its own tab's form (just the one button when only one may be created).
  const creatable = [
    ...(can?.createTask ? [{ id: "task", label: "Task", href: "/crm/activities?tab=tasks&new=1" }] : []),
    ...(can?.createFollowUp ? [{ id: "follow-up", label: "Follow-up", href: "/crm/activities?tab=follow-ups&new=1" }] : []),
  ];
  const newAction = creatable.length > 1 ? (
    <MenuTrigger>
      <Button variant="primary"><Plus className="size-4" aria-hidden="true" />New<ChevronDown className="size-4" aria-hidden="true" /></Button>
      <Menu onAction={(key) => { const entry = creatable.find((item) => item.id === String(key)); if (entry) router.push(entry.href); }}>
        <MenuItem id="task"><span className="flex items-center gap-2"><SquareCheck className="size-4" aria-hidden="true" />Task</span></MenuItem>
        <MenuItem id="follow-up"><span className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden="true" />Follow-up</span></MenuItem>
      </Menu>
    </MenuTrigger>
  ) : creatable[0] ? (
    <Link href={creatable[0].href} className={buttonVariants({ variant: "primary" })}><Plus className="size-4" aria-hidden="true" />New {creatable[0].label.toLowerCase()}</Link>
  ) : undefined;

  return (
    <EnterpriseListPage
      tabs={tabs}
      header={{
        title: "To-dos",
        description: "Tasks and follow-ups together, overdue first.",
        primaryAction: newAction,
      }}
      actionBar={{
        leading: <ScopeSwitch label="Whose to-dos" scopes={SCOPES} value={scope} onChange={setScope} />,
        start: (
          <>
            <SearchField aria-label="Search to-dos" placeholder="Search to-dos" className="w-full sm:w-72" value={search} onChange={setSearch}
              onSubmit={(value) => { setSubmittedSearch(value.trim()); setPageIndex(0); }} />
            {/* The one filter, so it sits in the row — one tap, not a Filters panel holding a single field. */}
            <Select aria-label="Type" className="min-w-0 max-sm:flex-1 sm:w-44" selectedKey={type} onSelectionChange={(key) => setType(String(key))} options={TYPES} />
            {/* The list's saved views, in the same group as its search and filter, so on a narrow screen they wrap together. */}
            <SavedViews size="standard" screen="todos" basePath="/crm/activities" filters={{ scope, queue, type: type !== ANY ? type : undefined, search: submittedSearch || undefined }} />
          </>
        ),
        collapseFilters: false,
      }}
    >
      <div className="flex flex-col gap-4">
        {notice && <p role="status" className="self-start rounded-[var(--radius-control)] bg-success-soft px-3 py-1.5 text-sm text-success">{notice}</p>}
        <QueueCards<Queue> label="To-do queues" cards={QUEUES.map((entry) => ({ ...entry, count: query.data?.counts[entry.key] }))} value={queue} onChange={setQueue} />
        <EnterpriseDataGrid<Todo>
          aria-label="To-dos"
          columns={columns}
          data={rows}
          getRowId={(row) => `${row.kind}:${row.id}`}
          columnVisibility={{ assignee: scope !== "mine" }}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (hasCriteria || queue !== "open" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading to-dos" rows={8} onRetry={() => void query.refetch()} />}
          errorContent={<ErrorState title="Could not load to-dos" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="Nothing to do" description={scope === "mine"
            ? "No open tasks or follow-ups are assigned to you. Add one here, or from a lead, company, contact or deal."
            : "No one has an open task or follow-up."} />}
          noResultsContent={queue === "overdue" && !hasCriteria
            ? <NoResultsState title="Nothing overdue" description="You are on top of things. Pick another queue to see what is next." />
            : <NoResultsState title="No to-dos here" description="Try another queue, type or search." />}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          onRowClick={(row) => router.push(row.href)}
          renderMobileCard={(row) => (
            // Read top to bottom: when, what to do, about what and for whom, then the action.
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><TodoDue todo={row} /><span className="text-text-secondary">{row.typeLabel}</span></div>
              <span className="text-sm font-semibold text-text">{row.subject}</span>
              <span className="text-xs text-text-secondary">
                {[row.record?.name ? `${row.record.name} · ${RELATED_LABELS[row.record.type] ?? ""}` : "Personal", scope !== "mine" ? row.assigneeName ?? "Unassigned" : null].filter(Boolean).join(" · ")}
              </span>
              <div className="border-t border-border pt-2"><WorkRowActions kind={row.kind} id={row.id} layout="check" labelled onMessage={setNotice} /></div>
            </div>
          )}
        />
      </div>
    </EnterpriseListPage>
  );
}

// When, read the way a task's due date reads: "Today, 3:30 pm", "24 Oct 2026", overdue in red with its badge.
function TodoDue({ todo }: { todo: Todo }) {
  if (!todo.dueAt) return <span className="text-text-muted">No due date</span>;
  const time = todo.dueTimeSet ? new Date(todo.dueAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: displayTimeZone() }) : null;
  const when = `${todo.dueToday ? "Today" : formatDate(todo.dueAt)}${time ? `, ${time}` : ""}`;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap ${todo.overdue ? "font-medium text-danger" : todo.dueToday ? "font-medium" : ""}`}>
      {when}
      {todo.overdue && <Badge tone="danger">Overdue</Badge>}
    </span>
  );
}

// About: the record's name over its kind; the name opens the record without opening the row.
function TodoAbout({ todo }: { todo: Todo }) {
  if (!todo.record) return <span className="text-text-muted">Personal</span>;
  const label = RELATED_LABELS[todo.record.type] ?? todo.record.type;
  const name = todo.record.name ?? label;
  return (
    <span className="flex min-w-36 flex-col text-sm">
      {todo.record.href
        ? <Link href={todo.record.href} onClick={(event) => event.stopPropagation()} className="text-text hover:text-brand hover:underline">{name}</Link>
        : <span>{name}</span>}
      <span className="text-xs text-text-muted">{label}</span>
    </span>
  );
}
