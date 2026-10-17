// Projects — Project Status: one authoritative lifecycle state machine on the project (Draft, Planned, In progress, On hold, Completed,
// Cancelled), with hold blockers, completion reviews, controlled reopening, the shared execution guard and the status reports.
export {
  CANCEL_REASONS, HOLD_REASONS, HOLD_SEVERITIES, PROJECT_STATUSES, REOPEN_REASONS, TRANSITIONS, availableActions, executionState, transitionRefusal,
} from "./status-rules.js";
export {
  activateProject, addProjectHoldReason, cancelProject, completeProject, decideProjectActivation, placeProjectOnHold, reopenProject, resolveProjectHoldReason, resumeProject,
  startProject,
} from "./status-commands.js";
export {
  STATUS_REPORTS, activationProblems, activationReadiness, cancellationReview, completionReadiness, getAvailableProjectActions, getProjectCancellationReview,
  getProjectCompletionReadiness, getProjectHold, getProjectReopenReview, getProjectResumeReadiness, getProjectStatus, getProjectStatusHistory, getProjectStatusReport,
  getTransitionOutcome, holdOf, validateProjectActivation,
} from "./status-read.js";
export { validateProjectExecutionAllowed } from "./status-guard.js";
