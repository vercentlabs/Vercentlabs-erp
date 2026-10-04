// Won / Lost Reasons: the configurable reasons a deal is won or lost for,
// and win / loss reporting. Closing itself is the opportunity's Mark won /
// Mark lost operation, which requires one of these reasons.
export { CLOSE_REASON_CATEGORIES, CLOSE_REASON_PERMISSIONS, CLOSE_REPORT_GROUPS, DEFAULT_CLOSE_REASONS } from "./constants.js";
export {
  createCloseReason, deleteCloseReason, ensureDefaultCloseReasons, listCloseReasons, reorderCloseReasons, setCloseReasonActive, updateCloseReason,
} from "./records.js";
export { getWinLossReport } from "./reports.js";
