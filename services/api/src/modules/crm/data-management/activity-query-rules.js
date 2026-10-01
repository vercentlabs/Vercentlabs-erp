// Activity predicates shared by the generic record queries, the Tasks
// workspace and CRM analytics. Pure SQL fragments with no dependencies, so
// every capability can use the same definition.

// F015 closeout: the ONE canonical "is this overdue" predicate — CRM Home,
// the Activities workspace list, the Task list and the Timeline must all
// agree on what "overdue" means (dossier: "one canonical, centrally-
// defined overdue formula reused everywhere"). A prior audit found this
// predicate duplicated near-identically across task-operations.js, the
// generic activities list, the KPI count and the activities report — all
// textually independent copies that could silently drift. This is now the
// single source of truth every one of those call sites imports.
export function taskOverdueSql(alias = "activity") {
  return `${alias}.due_at<now() AND ${alias}.status NOT IN ('completed','cancelled')`;
}
