"use client";

// To-dos (CRM audit): a salesperson's tasks and follow-ups in one list, by when they are due — overdue first. Each has a type (Task,
// Call, Visit, Meeting, WhatsApp, Email…) and the record it is about; Done finishes it in place, the row opens it. New tasks and
// follow-ups are added from their own tabs or from any lead, deal, company or contact.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button, EmptyState, EnterpriseListPage, ErrorState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { completeFollowUp } from "@/features/crm/follow-ups/api/follow-ups-api";
import { completeTask } from "@/features/crm/tasks/api/tasks-api";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class TodoApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(TodoApiError, "body");

type Todo = {
  id: string; kind: "task" | "follow_up"; typeCode: string; typeLabel: string; number: string | null; subject: string; dueAt: string | null; dueTimeSet: boolean;
  priority: string | null; overdue: boolean; assigneeName: string | null; updatedAt: string; record: { type: string; id: string; name: string | null; href: string | null } | null; href: string;
};
type TodoPage = { total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; todos: Todo[] };

const PAGE = 50;
const listTodos = (params: { view: string; search: string; offset: number }) =>
  request<TodoPage>(`/api/crm/todos?${new URLSearchParams({ view: params.view, limit: String(PAGE), offset: String(params.offset), ...(params.search ? { search: params.search } : {}) })}`);

export function TodoListScreen({ tabs }: { tabs?: ReactNode }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState("mine");
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [offset, setOffset] = useState(0);
  const key = scopedQueryKey(workspace, "crm", "todos", view, submitted, offset);
  const query = useQuery({ queryKey: key, queryFn: () => listTodos({ view, search: submitted, offset }) });
  const done = useMutation({
    mutationFn: (todo: Todo) => (todo.kind === "task" ? completeTask(todo.id, { expectedUpdatedAt: todo.updatedAt }) : completeFollowUp(todo.id, { expectedUpdatedAt: todo.updatedAt })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "todos") }),
  });
  const views = query.data?.views ?? [{ key: "mine", label: "My to-dos" }];
  const due = (todo: Todo) => (todo.dueAt ? (todo.dueTimeSet ? formatDateTime(todo.dueAt) : formatDate(todo.dueAt)) : "No date");

  return (
    <EnterpriseListPage
      tabs={tabs}
      header={{ title: "To-dos", description: "Tasks and follow-ups together, overdue first. Add a task or follow-up from its tab, or from any lead, deal, company or contact." }}
      actionBar={{
        start: (
          <span className="flex flex-wrap items-center gap-2">
            {views.map((entry) => (
              <Button key={entry.key} size="compact" variant={entry.key === view ? "primary" : "ghost"} onPress={() => { setView(entry.key); setOffset(0); }}>{entry.label}</Button>
            ))}
            <SearchField aria-label="Search to-dos" placeholder="Search to-dos" className="w-full sm:w-64" value={search} onChange={setSearch}
              onSubmit={(value) => { setSubmitted(value.trim()); setOffset(0); }} />
          </span>
        ),
      }}
    >
      {done.isError && <Notice>{done.error instanceof Error ? done.error.message : "That could not be marked done."}</Notice>}
      {query.isLoading ? <LoadingState label="Loading to-dos" rows={5} />
        : query.isError ? <ErrorState title="To-dos could not be loaded" description={query.error instanceof Error ? query.error.message : "Try again."} />
          : !query.data?.todos.length ? <EmptyState title="Nothing to do here" description={view === "mine" ? "No open tasks or follow-ups are assigned to you." : "No open tasks or follow-ups match."} />
            : (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                {query.data.todos.map((todo) => (
                  <li key={todo.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <Button aria-label={`Mark "${todo.subject}" done`} variant="ghost" size="compact" isLoading={done.isPending && done.variables?.id === todo.id} onPress={() => done.mutate(todo)}>
                      <Check className="size-4" aria-hidden="true" />
                    </Button>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link href={todo.href} className="font-medium text-text hover:underline">{todo.subject}</Link>
                      <span className="text-xs text-text-secondary">
                        {[todo.number, todo.record?.name ? `about ${todo.record.name}` : null, todo.assigneeName].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <StatusBadge tone={todo.kind === "task" ? "neutral" : "info"}>{todo.typeLabel}</StatusBadge>
                    <span className={`w-36 text-right text-xs tabular-nums ${todo.overdue ? "font-medium text-danger" : "text-text-secondary"}`}>{todo.overdue ? `Overdue · ${due(todo)}` : due(todo)}</span>
                  </li>
                ))}
              </ul>
            )}
      {query.data && query.data.total > PAGE && (
        <div className="flex items-center justify-between text-sm text-text-secondary">
          <span>{offset + 1}–{Math.min(offset + PAGE, query.data.total)} of {query.data.total}</span>
          <span className="flex gap-2">
            <Button size="compact" variant="secondary" isDisabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
            <Button size="compact" variant="secondary" isDisabled={offset + PAGE >= query.data.total} onPress={() => setOffset(offset + PAGE)}>Next</Button>
          </span>
        </div>
      )}
    </EnterpriseListPage>
  );
}
