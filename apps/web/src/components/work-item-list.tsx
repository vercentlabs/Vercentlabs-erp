import Link from "next/link";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import type { WorkItem } from "@/lib/my-work/types";

function formatDue(dueAt?: string) {
  if (!dueAt) return "";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dueAt));
}

const URGENCY_LABEL: Record<WorkItem["urgency"], string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  none: "",
};

export default function WorkItemList({
  items,
  emptyTitle,
  emptyDescription,
  emptyIcon = "check",
}: {
  items: WorkItem[];
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon?: AppIconName;
}) {
  if (!items.length) {
    return (
      <div className="empty-state compact">
        <span className="empty-state-icon" aria-hidden="true">
          <AppIcon name={emptyIcon} size={20} />
        </span>
        <div>
          <strong>{emptyTitle}</strong>
          <p>{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-list timeline-list">
      {items.map((item) => (
        <Link
          href={item.href}
          key={item.id}
          className={`timeline-item-link${item.urgency === "overdue" ? " attention" : ""}`}
        >
          <span className="timeline-dot" aria-hidden="true" />
          <div>
            <strong>{item.title}</strong>
            <span>
              {item.source}
              {item.subtitle ? ` · ${item.subtitle}` : ""}
            </span>
          </div>
          {URGENCY_LABEL[item.urgency] || item.dueAt ? (
            <small>
              {[URGENCY_LABEL[item.urgency], formatDue(item.dueAt)]
                .filter(Boolean)
                .join(" · ")}
            </small>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
