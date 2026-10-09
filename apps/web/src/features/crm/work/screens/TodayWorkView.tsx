"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { formatDate } from "@/shared/format/human";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listTasks } from "@/features/crm/tasks/api/tasks-api";
import { listCalls } from "@/features/crm/work/calls/api/calls-api";
import { listMeetings } from "@/features/crm/work/meetings/api/meetings-api";
import { listFollowUps } from "@/features/crm/follow-ups/api/follow-ups-api";

// Today's queue from the existing, permission-scoped activity lists — the
// same endpoints and filters the Tasks/Calls/Meetings/Follow-ups views use,
// each bounded to a few rows with its total, and a link to the full view.
// No new backend, no invented records.
const LIMIT = 8;

type Row = {
  id: string;
  subject: string;
  status: string;
  at: string | null;
};

type Bucket = {
  key: string;
  title: string;
  empty: string;
  detail: (id: string) => string;
  allHref: string;
  load: () => Promise<{ rows: Row[]; total: number }>;
};

const BUCKETS: Bucket[] = [
  {
    key: "tasks-overdue",
    title: "Overdue tasks",
    empty: "No overdue tasks.",
    detail: (id) => `/crm/tasks/${id}`,
    allHref: "/crm/activities?tab=tasks&view=overdue",
    load: async () => {
      const result = await listTasks({ view: "overdue", limit: LIMIT, offset: 0 });
      return {
        rows: result.rows.map((row) => ({
          id: row.id,
          subject: row.title,
          status: row.status,
          at: row.dueAt,
        })),
        total: result.total,
      };
    },
  },
  {
    key: "tasks-today",
    title: "Tasks due today",
    empty: "No tasks due today.",
    detail: (id) => `/crm/tasks/${id}`,
    allHref: "/crm/activities?tab=tasks&view=due_today",
    load: async () => {
      const result = await listTasks({ view: "due_today", limit: LIMIT, offset: 0 });
      return {
        rows: result.rows.map((row) => ({
          id: row.id,
          subject: row.title,
          status: row.status,
          at: row.dueAt,
        })),
        total: result.total,
      };
    },
  },
  {
    key: "calls-today",
    title: "Calls due today",
    empty: "No calls due today.",
    detail: (id) => `/crm/calls/${id}`,
    allHref: "/crm/activities?tab=calls",
    load: async () => {
      const result = await listCalls({ due: "today", limit: LIMIT, offset: 0 });
      return {
        rows: result.rows.map((row) => ({
          id: row.id,
          subject: row.subject,
          status: row.status,
          at: row.dueAt ?? row.startAt,
        })),
        total: result.total,
      };
    },
  },
  {
    key: "meetings-today",
    title: "Today's meetings",
    empty: "No meetings today.",
    detail: (id) => `/crm/meetings/${id}`,
    allHref: "/crm/activities?tab=meetings",
    load: async () => {
      const result = await listMeetings({
        due: "today",
        limit: LIMIT,
        offset: 0,
      });
      return {
        rows: result.rows.map((row) => ({
          id: row.id,
          subject: row.subject,
          status: row.status,
          at: row.startAt,
        })),
        total: result.total,
      };
    },
  },
  {
    key: "follow-ups-due",
    title: "Follow-ups due",
    empty: "No follow-ups due today or overdue.",
    detail: (id) => `/crm/follow-ups/${id}`,
    allHref: "/crm/activities?tab=follow-ups",
    load: async () => {
      const [overdue, today] = await Promise.all([
        listFollowUps({ view: "overdue", limit: LIMIT, offset: 0 }),
        listFollowUps({ view: "due_today", limit: LIMIT, offset: 0 }),
      ]);
      const rows = [...overdue.rows, ...today.rows].slice(0, LIMIT);
      return {
        rows: rows.map((row) => ({
          id: row.id,
          subject: row.subject,
          status: row.status,
          at: row.scheduledAt,
        })),
        total: overdue.total + today.total,
      };
    },
  },
];

function BucketCard({ bucket }: { bucket: Bucket }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "my-work", "today", bucket.key),
    queryFn: bucket.load,
  });
  const headingId = `today-${bucket.key}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-text">
          {bucket.title}
          {query.data ? (
            <span className="ml-2 font-normal text-text-secondary tabular-nums">
              {query.data.total.toLocaleString("en-IN")}
            </span>
          ) : null}
        </h2>
        <Link
          href={bucket.allHref}
          className="text-sm text-brand hover:underline"
        >
          Open all
          <span className="sr-only"> — {bucket.title}</span>
        </Link>
      </div>
      {query.isLoading ? (
        <LoadingState
          label={`Loading ${bucket.title.toLowerCase()}`}
          rows={2}
        />
      ) : query.isError ? (
        <ErrorState
          title={`Could not load ${bucket.title.toLowerCase()}`}
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      ) : !query.data?.rows.length ? (
        <p className="text-sm text-text-secondary">{bucket.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {query.data.rows.map((row) => (
            <li key={row.id}>
              <Link
                href={bucket.detail(row.id)}
                className="flex items-baseline justify-between gap-3 py-2 text-sm hover:text-brand"
              >
                <span className="min-w-0 truncate text-text">
                  {row.subject}
                </span>
                {row.at ? (
                  <span className="shrink-0 text-xs text-text-secondary">
                    {formatDate(row.at)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TodayWorkView() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Today"
        description="What is overdue or due today across your tasks, calls, meetings and follow-ups."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {BUCKETS.map((bucket) => (
          <BucketCard key={bucket.key} bucket={bucket} />
        ))}
      </div>
    </div>
  );
}
