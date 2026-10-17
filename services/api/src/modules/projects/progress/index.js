// Projects — Progress Tracking: a deterministic read layer over the tasks, milestones, lifecycle, assignees and approved time. Task
// completion (done over all but the cancelled), required-milestone acceptance, schedule, health with its reasons and effort used against
// estimate stay separate measures; an append-only history records every move with its cause; a versioned baseline keeps the scope a
// project started from; a reconciliation checks the history against the records. Nothing here completes or changes a record.
export { CALCULATION_VERSION as PROGRESS_CALCULATION_VERSION, PROGRESS_MESSAGES, SCHEDULE_LABEL, taskPercent } from "./progress-rules.js";
export { PROGRESS as PROGRESS_PERMISSION_KEYS, captureProjectProgressBaseline, recordProjectProgressSnapshot } from "./progress-record.js";
export {
  PROGRESS_REPORTS, calculateProgressByAssignee, evaluateProjectProgress, explainProgressChange, exportProjectProgress, getBaselineComparison, getPortfolioProgress, getProgressReport,
  getProgressSettings, getProjectProgressHistory, getProjectProgressSummary, rebuildProjectProgressProjection, saveProgressSettings,
} from "./progress-read.js";
