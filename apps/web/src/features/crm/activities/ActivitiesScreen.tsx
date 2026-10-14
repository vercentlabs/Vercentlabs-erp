"use client";

import Link from "next/link";

import { FollowUpListScreen } from "@/features/crm/follow-ups/screens/FollowUpListScreen";
import { FilesSearchScreen, NotesSearchScreen } from "@/features/crm/notes/screens/NotesFilesScreen";
import { TaskListScreen } from "@/features/crm/tasks/screens/TaskListScreen";

import { ACTIVITY_TABS, type ActivityTab } from "./activity-tabs";

// CRM To-dos: one page — one title, one row of tabs (Tasks · Follow-ups · Notes · Files). Each tab is its own screen (same API clients,
// permissions and actions) that draws the page title with its own primary button (New task, Schedule follow-up, none for notes and files) and
// this tab row under it; only the selected tab is mounted, so nothing else fetches. The tab is in the URL (/crm/activities?tab=tasks).
export function TodoTabs({ current }: { current: ActivityTab }) {
  return (
    <nav aria-label="To-dos" className="-mt-2 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {ACTIVITY_TABS.map((item) => {
          const selected = item.id === current;
          return (
            <li key={item.id}>
              <Link
                href={`/crm/activities?tab=${item.id}`}
                aria-current={selected ? "page" : undefined}
                className={[
                  "-mb-px flex border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                  selected ? "border-brand text-text" : "border-transparent text-text-secondary hover:text-text",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export const TODOS_TITLE = "To-dos";

export function ActivitiesScreen({ tab }: { tab: ActivityTab }) {
  const tabs = <TodoTabs current={tab} />;
  switch (tab) {
    case "follow-ups": return <FollowUpListScreen tabs={tabs} />;
    case "notes": return <NotesSearchScreen tabs={tabs} />;
    case "files": return <FilesSearchScreen tabs={tabs} />;
    default: return <TaskListScreen tabs={tabs} />;
  }
}
