// Projects (0125, Customer Association 0126): the project master and its lifecycle — identity, scope, an accountable manager and team, typed links to other modules'
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
export {
  CONTACT_ROLES as PROJECT_CONTACT_ROLES, CUSTOMER_REPORTS as PROJECT_CUSTOMER_REPORTS, addProjectCustomerContact, addProjectSite, applyProjectContactMerge, applyProjectCustomerMerge,
  assignProjectCustomer, clearProjectCustomerReview, decideProjectCustomerChange, exportProjectCustomers, getCustomerAssociationHistory, getCustomerProjects, getProjectCustomer,
  getProjectCustomerReport, listEligibleProjectContacts, listProjectCustomerContactsOnProject, listProjectSites, noteSalesOrderChangeForProjects, previewProjectCustomerChange,
  removeProjectCustomerContact, removeProjectSite, replaceProjectCustomerContact, requestProjectCustomerChange, resolveProjectCustomerMapping, searchProjectEligibleCustomers,
  setProjectPrimaryContact, updateProjectCustomerContact, updateProjectSite, withdrawProjectCustomerChange,
} from "./project-customer.js";
// Milestones (0128): planned checkpoints with deliverables, tasks, prerequisites, blockers, submissions, internal approval and customer
// acceptance evidence, completion, and the billing handoff to Sales.
export {
  MILESTONE_REPORTS, getMilestoneActivity, getMilestoneDetails, getMilestoneNotes, getMilestoneReport, getProjectMilestones, exportMilestones, evaluateMilestoneDeadlines,
  listMilestoneQueue, searchMilestoneTasks,
} from "./project-milestone-read.js";
export { MILESTONE_STATUS_LABEL, registerMilestoneTaskSource } from "./project-milestone-rules.js";
export {
  acknowledgeMilestoneBilling, addMilestoneCriterion, addMilestoneDependency, addMilestoneNote, applyProjectMilestonePlan, assignMilestoneOwner, cancelProjectMilestone,
  completeMilestoneCriterion, completeProjectMilestone, createProjectMilestone, linkMilestoneTask, listMilestoneFiles, raiseMilestoneBlocker, readMilestoneFile, recordCustomerAcceptanceEvidence,
  recordMilestoneApproval, removeMilestoneCriterion, removeMilestoneDependency, removeMilestoneFile, reopenMilestoneCriterion, reopenProjectMilestone, reorderMilestoneCriteria,
  requestMilestoneBilling, resolveMilestoneBlocker, setMilestoneBillingStage, startProjectMilestone, submitProjectMilestone, updateMilestoneCriterion, updateMilestoneTaskLink,
  updateProjectMilestone, uploadMilestoneFile, waiveMilestoneCriterion, waiveMilestoneForProjectCompletion, withdrawMilestoneBilling, withdrawMilestoneSubmission,
} from "./project-milestones.js";
// Tasks (0129): the accountable work items of a project — lifecycle, checklist, dependencies, blockers, review, comments, files, queues, board,
// bulk changes, reports — feeding project progress and the milestones' task links.
export {
  TASK_REPORTS, PROJECT_TASK_VIEWS, evaluateTaskDeadlines, exportProjectTasks, getProjectTasks, getTaskActivity, getTaskComments, getTaskDetails, getTaskProgressHistory, getTaskReport, listTaskQueue,
  listTaskViews,
} from "./project-task-read.js";
export { TASK_STATUS_LABEL, registerTaskRecordSource } from "./project-task-rules.js";
export {
  addTaskComment, approveTaskReview, archiveProjectTask, assignProjectTask, blockProjectTask, bulkUpdateProjectTasks, cancelProjectTask, completeProjectTask, createProjectTask, decideTaskReview,
  listTaskFiles, manageTaskChecklist, manageTaskDependency, readTaskFile, recordTaskEvidence, removeTaskComment, removeTaskFile, removeTaskView, reopenProjectTask, requestTaskChanges,
  resolveTaskBlocker, saveTaskView, startProjectTask, submitTaskForReview, transitionProjectTask, updateProjectTask, uploadTaskFile, withdrawTaskReview,
} from "./project-tasks.js";
