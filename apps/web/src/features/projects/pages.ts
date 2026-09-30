// Plain data (no components) so a Server Component page can read it.
export const PROJECTS_PAGES: Record<string, { title: string }> = {
  all: { title: "All projects" },
  tasks: { title: "Tasks" },
  milestones: { title: "Milestones" },
  workspace: { title: "Project workspace" },
  team: { title: "Project team" },
  time: { title: "Time entries" },
  timesheets: { title: "Timesheets" },
  settings: { title: "Project settings" },
};
