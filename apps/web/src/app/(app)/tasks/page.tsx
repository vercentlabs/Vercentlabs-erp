import Link from "next/link";

import WorkItemList from "@/shared/components/work-item-list";
import { requireWorkspace } from "@/core/auth";
import { listMyTasks } from "@/orchestration/work/tasks";
import type { WorkItem, WorkItemUrgency } from "@/shared/work/types";

export const metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

type ViewKey = "all" | "overdue" | "today" | "upcoming";

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "all", label: "My tasks" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
];

const URGENCY_FOR_VIEW: Partial<Record<ViewKey, WorkItemUrgency>> = {
  overdue: "overdue",
  today: "due_today",
  upcoming: "upcoming",
};

function resolveView(value: string | undefined): ViewKey {
  return VIEWS.some((view) => view.key === value) ? (value as ViewKey) : "all";
}

function filterByView(items: WorkItem[], view: ViewKey): WorkItem[] {
  const urgency = URGENCY_FOR_VIEW[view];
  if (!urgency) return items;
  return items.filter((item) => item.urgency === urgency);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireWorkspace();
  const { view: rawView } = await searchParams;
  const view = resolveView(rawView);
  const tasks = await listMyTasks(session, 50);
  const visible = filterByView(tasks, view);

  const counts = {
    all: tasks.length,
    overdue: tasks.filter((item) => item.urgency === "overdue").length,
    today: tasks.filter((item) => item.urgency === "due_today").length,
    upcoming: tasks.filter((item) => item.urgency === "upcoming").length,
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Work</p>
          <h1>Tasks</h1>
          <p>
            Work assigned to you across CRM and Projects, in one read-only
            list. Access to each item still follows that module&apos;s own
            rules — this view adds nothing new.
          </p>
        </div>
      </section>

      <nav className="tab-strip" aria-label="Task views">
        {VIEWS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/tasks" : `/tasks?view=${item.key}`}
            className={`tab-strip-item${view === item.key ? " active" : ""}`}
          >
            {item.label}
            <span className="tab-strip-count">{counts[item.key]}</span>
          </Link>
        ))}
      </nav>

      <section className="panel activity-panel">
        <WorkItemList
          items={visible}
          emptyTitle="Nothing here"
          emptyDescription="No tasks match this view right now."
        />
      </section>
    </>
  );
}
