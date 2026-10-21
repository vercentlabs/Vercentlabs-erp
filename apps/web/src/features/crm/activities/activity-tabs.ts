// The CRM To-dos tabs — plain data shared by the server page (which validates ?tab=) and the client screen (which renders the tab bar). Kept
// out of the "use client" module: a server component cannot call a function exported from a client module.
export const ACTIVITY_TABS = [
  // Tasks and follow-ups in one list (CRM audit): the default.
  { id: "all", label: "All to-dos" },
  { id: "tasks", label: "Tasks" },
  { id: "follow-ups", label: "Follow-ups" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
] as const;

export type ActivityTab = (typeof ACTIVITY_TABS)[number]["id"];

export function isActivityTab(value: unknown): value is ActivityTab {
  return ACTIVITY_TABS.some((tab) => tab.id === value);
}

// The former single "Notes & Files" tab opens Notes.
export function activityTabOf(value: unknown): ActivityTab {
  if (value === "notes-files") return "notes";
  return isActivityTab(value) ? value : "all";
}
