// The public surface of the Projects module, every operation under a name that cannot collide with another
// module's (Assets, Quality and Manufacturing also have tasks, work orders and dashboards).
export {
  getProjectSettings, saveProjectSettings, listProjectsDesk, getProjectDesk, createProjectRecord, updateProjectRecord, getCloseBlockers, approveProjectRecord, changeProjectStatus, listProjectTeams, saveProjectMember, removeProjectMember, listProjectOptions,
} from "./setup.js";
export {
  listProjectTasks, getProjectTask, createProjectTaskRecord, updateProjectTaskRecord, changeTaskStatus, setTaskProgress, deleteProjectTask, addTaskDependency as addProjectTaskDependency, removeTaskDependency as removeProjectTaskDependency, listProjectMilestones, saveProjectMilestone, setMilestoneStatus, computeSchedule, getProjectWbs, getGanttData, getKanbanBoard, getProjectCalendar, getProjectProgress, saveStatusReport,
} from "./planning.js";
export {
  listTimeEntries as listProjectTimeEntries, logProjectTime, updateTimeEntryRecord, deleteTimeEntryRecord, listTimesheets, submitTimesheet, recallTimesheet, reviewTimesheet, reopenApprovedTime,
} from "./time.js";
export {
  listProjectComments, addProjectComment, deleteProjectComment, listMyMentions,
} from "./comments.js";
export {
  getProjectsDeskDashboard,
} from "./dashboard.js";
export { projectsContext, ProjectError } from "./common.js";
