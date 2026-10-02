// Activity predicates shared by the generic record queries, the Tasks
// workspace and CRM analytics. Pure SQL fragments with no dependencies, so
// every capability can use the same definition.

// The ONE canonical "is this overdue" predicate — CRM Home, the Activities
// workspace list, the Task list, the KPI count, the activities report and
// the Timeline must all agree on what "overdue" means, so every one of
// those call sites imports this instead of keeping its own copy.
export function taskOverdueSql(alias = "activity") {
  return `${alias}.due_at<now() AND ${alias}.status NOT IN ('completed','cancelled')`;
}
