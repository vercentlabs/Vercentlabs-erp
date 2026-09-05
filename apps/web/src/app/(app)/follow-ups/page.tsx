import { ListWorkQueueArchetype } from "@/shared/design";
import Link from "next/link";

import WorkItemList from "@/shared/components/work-item-list";
import { requireWorkspace } from "@/core/auth";
import { listMyFollowUps } from "@/orchestration/work/follow-ups";
import type { WorkItem, WorkItemUrgency } from "@/shared/work/types";

export const metadata = { title: "Follow-ups & reminders" };
export const dynamic = "force-dynamic";

type ViewKey = "all" | "overdue" | "today" | "upcoming";

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "all", label: "All follow-ups" },
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

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireWorkspace();
  const { view: rawView } = await searchParams;
  const view = resolveView(rawView);
  const followUps = await listMyFollowUps(session, 50);
  const visible = filterByView(followUps, view);

  const counts = {
    all: followUps.length,
    overdue: followUps.filter((item) => item.urgency === "overdue").length,
    today: followUps.filter((item) => item.urgency === "due_today").length,
    upcoming: followUps.filter((item) => item.urgency === "upcoming").length,
  };

  return (
    <ListWorkQueueArchetype aria-label="Work queue">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Work</p>
          <h1>Follow-ups &amp; reminders</h1>
          <p>
            CRM leads you own with a scheduled follow-up date. Access follows
            the same lead-ownership rules CRM already enforces.
          </p>
        </div>
      </section>

      <nav className="tab-strip" aria-label="Follow-up views">
        {VIEWS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/follow-ups" : `/follow-ups?view=${item.key}`}
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
          emptyDescription="No follow-ups match this view right now."
        />
      </section>
    </ListWorkQueueArchetype>
  );
}
