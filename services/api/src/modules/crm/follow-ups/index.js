// CRM Follow-ups: when to contact a customer or revisit a deal again, by whom
// and how. One follow-up entity for leads, accounts, contacts and
// opportunities, with its reminder in the shared reminder mechanism
// (../reminders). Each action is one operation taking (client, context, …)
// and running inside the caller's transaction.
//
// A follow-up answers "when do we re-engage?"; a task answers "what work
// must somebody do?" (../tasks). Completing one can schedule the other.
export * from "./constants.js";
export { canViewAllFollowUps, followUpCan, followUpCapabilities, followUpScopeSql } from "./access.js";
export { deleteFollowUp, getFollowUp, getFollowUpOptions, getFollowUpSummary, listFollowUps, scheduleFollowUp, updateFollowUp } from "./records.js";
export {
  bulkUpdateFollowUps, cancelFollowUp, completeFollowUp, listFollowUpHistory, reassignFollowUp, rescheduleFollowUp, settleOpenFollowUps, snoozeFollowUpReminder,
  transferOpenFollowUps,
} from "./lifecycle.js";
export { exportFollowUps } from "./export.js";

import { scheduleFollowUp } from "./records.js";
// After an outcome, the next contact on the same record: scheduleFollowUp with
// the record of the follow-up just completed (see completeFollowUp's nextFollowUp).
export const scheduleNextFollowUp = scheduleFollowUp;
