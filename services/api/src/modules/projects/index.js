// Projects (0125): the project master and its lifecycle — identity, scope, an accountable manager and team, typed links to other modules'
// records, derived progress and explainable health, holds, completion checks, cancellation review, archive, notes, files, activity, saved
// views, import/export, overview reports, notifications and automation events. Tasks, milestones, time, budgets and billing are later
// features that plug into it (registerProjectWorkSource).
export { PROJECT as PROJECT_PERMISSION_KEYS, STATUS_LABEL as PROJECT_STATUS_LABEL, ProjectError, projectsContext } from "./project-core.js";
export {
  activateProject, addProjectMember, addProjectNote, archiveProject, cancelProject, completeProject, createProjectDraft, createProjectFromSalesOrder, decideProjectActivation,
  deleteDraftProject, editProjectNote, flagProjectRisk, getProjectSettings, importProjects, linkProjectRecord, listProjectFiles, listProjectViews, noteProjectHealth,
  placeProjectOnHold, prepareProjectFileUpload, readProjectFile, removeProjectFile, removeProjectMember, removeProjectNote, removeProjectView, reopenProject, restoreProject,
  resumeProject, saveProjectSettings, saveProjectType, saveProjectView, startProject, unlinkProjectRecord, updateProject, updateProjectMemberRole, uploadProjectFile,
  validateProjectActivation,
} from "./project-service.js";
export {
  PROJECT_REPORTS, exportProjects, getProject, getProjectActivity, getProjectCancellationReview, getProjectCompletionCheck, getProjectLinks, getProjectMembers, getProjectNotes,
  getProjectOptions, getProjectReport, getProjectStatusHistory, getProjectSummary, getProjectsOverview, listMyProjects, listProjectCustomerContacts, listProjects,
  notifyProjectAlerts, searchLinkableRecords, searchProjectCustomers,
} from "./project-read.js";
export { registerProjectWorkSource } from "./project-summary.js";
