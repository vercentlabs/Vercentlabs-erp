"use client";

import { FollowUpListScreen } from "@/features/crm/follow-ups/screens/FollowUpListScreen";
import { FilesSearchScreen, NotesSearchScreen } from "@/features/crm/notes/screens/NotesFilesScreen";
import { TaskListScreen } from "@/features/crm/tasks/screens/TaskListScreen";
import { TodoListScreen } from "@/features/crm/todos/TodoListScreen";
import { RouteTabs } from "@/shared/ui/RouteTabs";

import { ACTIVITY_TABS, type ActivityTab } from "./activity-tabs";

// CRM To-dos: one page — one title, one row of tabs (All to-dos · Tasks · Follow-ups · Notes · Files). Each tab is its own screen (same API clients,
// permissions and actions) that draws the page title with its own primary button (New task, Schedule follow-up, none for notes and files) and
// this tab row under it; only the selected tab is mounted, so nothing else fetches. The tab is in the URL (/crm/activities?tab=tasks).
export function TodoTabs({ current }: { current: ActivityTab }) {
  return <RouteTabs label="To-dos" base="/crm/activities" tabs={ACTIVITY_TABS} current={current} className="-mt-2" />;
}

export const TODOS_TITLE = "To-dos";

export function ActivitiesScreen({ tab }: { tab: ActivityTab }) {
  const tabs = <TodoTabs current={tab} />;
  switch (tab) {
    case "follow-ups": return <FollowUpListScreen tabs={tabs} />;
    case "notes": return <NotesSearchScreen tabs={tabs} />;
    case "files": return <FilesSearchScreen tabs={tabs} />;
    case "tasks": return <TaskListScreen tabs={tabs} />;
    default: return <TodoListScreen tabs={tabs} />;
  }
}
